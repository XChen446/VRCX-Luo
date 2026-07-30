import { EngineAdapter } from './EngineAdapter.js';

/**
 * MySQL / MariaDB dialect adapter.
 *
 * Mirrors SQLiteAdapter's structure but routes execution through the C#
 * MySQL backend (Dotnet/MySQL.cs) instead of SQLite. Parameter style is
 * `@param` (same as SQLite) — see architecture note below.
 *
 * ── MariaDB compatibility ──
 * MySqlConnector natively supports MariaDB (protocol-compatible). Both
 * 'mysql' and 'mariadb' modes route to this adapter. The DDL, SQL
 * fragments, and error handling are compatible with both engines:
 *   - AUTO_INCREMENT, INSERT IGNORE, REPLACE INTO, ON DUPLICATE KEY
 *     UPDATE — identical syntax in MySQL and MariaDB
 *   - INFORMATION_SCHEMA.TABLES/COLUMNS — identical schema
 *   - Error 1061 "Duplicate key name" — identical in both engines
 *   - UNIX_TIMESTAMP, SUBSTRING_INDEX, LOCATE, DATE, DATE_SUB — identical
 *   - LONGTEXT for JSON columns — MariaDB treats JSON as LONGTEXT alias
 *
 * ── Architecture note: why @param instead of ?param ──
 * Issue 8.4 lists MySQL's parameter style as `?`, but the migration runner
 * (migrations/index.js buildSetClause) generates raw SQL with `@key`
 * placeholders, and .map migration files also use `@param` style. Switching
 * to `?param` would break this upstream data contract without also rewriting
 * the migration runner (explicitly Phase 9.12's scope). MySqlConnector
 * natively supports `@param` with AllowUserVariables=false (no ambiguity),
 * so `@param` is the minimal-invasion choice that preserves compatibility.
 *
 * Business logic modules call these methods with structured parameters and
 * never construct SQL strings directly — same contract as SQLiteAdapter.
 */
class MySQLAdapter extends EngineAdapter {
    /** @type {string|null} */
    connectionString = null;

    /** @override */
    get engineType() {
        return 'mysql';
    }

    /**
     * @param {object} [config]
     * @param {string} [config.connection] - mysql:// URI 或原始连接字符串
     * @param {object} [config.params] - 额外连接参数（覆盖默认）
     */
    constructor({ connection, ...params } = {}) {
        super();
        if (connection) {
            this.connectionString = this._buildConnectionString(
                connection,
                params
            );
        }
    }

    /**
     * Normalize parameter objects for MySQL's @param binding style.
     * Identical to SQLiteAdapter._normalizeArgs — bare keys get `@` prefix.
     * @override
     * @param {object|Array|null} args - raw parameter object from caller
     * @returns {object|Array|null} dialect-adjusted parameter object
     * @protected
     */
    _normalizeArgs(args) {
        if (args && typeof args === 'object' && !Array.isArray(args)) {
            const prefixed = {};
            for (const [k, v] of Object.entries(args)) {
                prefixed[k.startsWith('@') ? k : `@${k}`] = v;
            }
            return prefixed;
        }
        return args;
    }

    /**
     * @private Build MySQL connection string from mysql:// URI + custom params.
     *
     * URI forms accepted:
     *   mysql://user:pass@host:port/database
     *   mysql://host:port/database
     *   mysql://host/database
     *
     * If the input is not a mysql:// URI (already a connection string with
     * key=value pairs), it is returned as-is.
     */
    _buildConnectionString(uri, params = {}) {
        if (!uri.startsWith('mysql://')) {
            return uri;
        }

        const rest = uri.slice('mysql://'.length);

        let auth = '';
        let hostPortDb = rest;

        const atIdx = rest.indexOf('@');
        if (atIdx !== -1) {
            auth = rest.slice(0, atIdx);
            hostPortDb = rest.slice(atIdx + 1);
        }

        let host = hostPortDb;
        let port = '3306';
        let database = '';

        const slashIdx = hostPortDb.indexOf('/');
        const colonIdx = hostPortDb.indexOf(':');

        if (colonIdx !== -1 && (slashIdx === -1 || colonIdx < slashIdx)) {
            host = hostPortDb.slice(0, colonIdx);
            const portEnd = slashIdx !== -1 ? slashIdx : hostPortDb.length;
            port = hostPortDb.slice(colonIdx + 1, portEnd);
        } else if (slashIdx !== -1) {
            host = hostPortDb.slice(0, slashIdx);
        }

        if (slashIdx !== -1) {
            database = hostPortDb.slice(slashIdx + 1);
        }

        const parts = [`Server=${host}`, `Port=${port}`];
        if (database) parts.push(`Database=${database}`);

        if (auth) {
            const passIdx = auth.indexOf(':');
            if (passIdx !== -1) {
                parts.push(`User ID=${auth.slice(0, passIdx)}`);
                parts.push(`Password=${auth.slice(passIdx + 1)}`);
            } else {
                parts.push(`User ID=${auth}`);
            }
        }

        for (const [k, v] of Object.entries(params)) {
            parts.push(`${k}=${v}`);
        }

        return parts.join(';');
    }

    /**
     * @private Handle MySQL-specific errors.
     *
     * Currently a pass-through that rethrows. Connection-level error
     * handling (deadlock, connection lost, access denied) will be added
     * in a later step once the adapter is functional end-to-end.
     */
    async handleMySqlError(e) {
        throw e;
    }

    /**
     * Execute raw SQL with row callback. Normalizes named-param keys.
     * @override
     * @param {(row: Array) => void} callback - called once per result row
     * @param {string} sql - SQL statement
     * @param {object|Array|null} [args] - named parameters
     * @returns {Promise<void>}
     */
    async execute(callback, sql, args) {
        args = this._normalizeArgs(args);
        const connId = this._txStack.at(-1);
        try {
            if (this.connectionString) {
                if (LINUX && args) {
                    args = new Map(Object.entries(args));
                }
                const json = await MySQL.ExecuteJsonOnConnection(
                    this.connectionString,
                    sql,
                    args
                );
                const items = JSON.parse(json);
                items.forEach((item) => {
                    callback(item);
                });
                return;
            }
            if (LINUX) {
                if (args) {
                    args = new Map(Object.entries(args));
                }
                const json = await MySQL.ExecuteJson(sql, args, connId);
                const items = JSON.parse(json);
                items.forEach((item) => {
                    callback(item);
                });
                return;
            }
            const data = await MySQL.Execute(sql, args, connId);
            data.forEach((row) => {
                callback(row);
            });
        } catch (e) {
            await this.handleMySqlError(e);
        }
    }

    /**
     * Execute raw SQL without row callback. Normalizes named-param keys.
     * @override
     * @param {string} sql - SQL statement
     * @param {object|Array|null} [args] - named parameters
     * @returns {Promise<number>}
     */
    async executeNonQuery(sql, args) {
        args = this._normalizeArgs(args);
        const connId = this._txStack.at(-1);
        try {
            if (this.connectionString) {
                if (LINUX && args) {
                    args = new Map(Object.entries(args));
                }
                return await MySQL.ExecuteNonQueryOnConnection(
                    this.connectionString,
                    sql,
                    args
                );
            }
            if (LINUX && args) {
                args = new Map(Object.entries(args));
            }
            return await MySQL.ExecuteNonQuery(sql, args, connId);
        } catch (e) {
            await this.handleMySqlError(e);
        }
    }

    // ── INSERT with conflict handling ────────────────────────────────

    /**
     * Map 'ignore'|'replace' to MySQL conflict clause.
     *
     * Unlike SQLite's `INSERT OR IGNORE` / `INSERT OR REPLACE`, MySQL uses:
     *   - ignore  → `INSERT IGNORE INTO`
     *   - replace → `REPLACE INTO` (standalone statement, not INSERT variant)
     *
     * Returns the full keyword prefix so the SQL template uses `${clause} INTO`.
     *
     * @private
     * @param {string} [conflict] - 'ignore' | 'replace' | undefined
     * @returns {string} 'INSERT IGNORE' | 'REPLACE' | 'INSERT'
     */
    _insertClause(conflict) {
        if (conflict === 'ignore') return 'INSERT IGNORE';
        if (conflict === 'replace') return 'REPLACE';
        return 'INSERT';
    }

    /**
     * Single-row INSERT with optional conflict handling.
     * @override
     * @param {string} table - target table name (with prefix if applicable)
     * @param {object} data - column:value mapping
     * @param {string} [conflict] - 'ignore' → INSERT IGNORE, 'replace' → REPLACE INTO
     * @returns {Promise<number>}
     */
    insert(table, data, conflict) {
        const clause = this._insertClause(conflict);
        const columns = Object.keys(data);
        const params = {};
        const values = columns.map((col) => {
            params[col] = data[col];
            return `@${col}`;
        });
        return this.executeNonQuery(
            `${clause} INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')})`,
            params
        );
    }

    /**
     * Bulk multi-row INSERT with optional conflict handling.
     * @override
     * @param {string} table - target table name
     * @param {object[]} rows - array of column:value objects (all must share the same keys)
     * @param {string} [conflict] - 'ignore' → INSERT IGNORE, 'replace' → REPLACE INTO
     * @returns {Promise<number>}
     */
    async bulkInsert(table, rows, conflict) {
        if (rows.length === 0) return;
        const clause = this._insertClause(conflict);
        const columns = Object.keys(rows[0]);
        const params = {};
        const values = rows.map((row, i) => {
            return (
                '(' +
                columns
                    .map((col) => {
                        params[`${col}_${i}`] = row[col];
                        return `@${col}_${i}`;
                    })
                    .join(', ') +
                ')'
            );
        });
        return this.executeNonQuery(
            `${clause} INTO ${table} (${columns.join(', ')}) VALUES ${values.join(', ')}`,
            params
        );
    }

    // ── UPDATE / DELETE ──────────────────────────────────────────────

    /** @override */
    update(table, data, where) {
        const params = {};
        const setClauses = Object.keys(data).map((col) => {
            params[`set_${col}`] = data[col];
            return `${col} = @set_${col}`;
        });
        const whereClauses = Object.keys(where).map((col) => {
            params[`where_${col}`] = where[col];
            return `${col} = @where_${col}`;
        });
        return this.executeNonQuery(
            `UPDATE ${table} SET ${setClauses.join(', ')} WHERE ${whereClauses.join(' AND ')}`,
            params
        );
    }

    /** @override */
    updateWhere(table, data, whereClause, params = {}) {
        const setClauses = Object.keys(data).map((col) => {
            params[`set_${col}`] = data[col];
            return `${col} = @set_${col}`;
        });
        return this.executeNonQuery(
            `UPDATE ${table} SET ${setClauses.join(', ')} WHERE ${whereClause}`,
            params
        );
    }

    /** @override */
    delete(table, where) {
        const params = {};
        const clauses = Object.keys(where).map((col) => {
            params[col] = where[col];
            return `${col} = @${col}`;
        });
        return this.executeNonQuery(
            `DELETE FROM ${table} WHERE ${clauses.join(' AND ')}`,
            params
        );
    }

    /** @override */
    deleteAll(table) {
        return this.executeNonQuery(`DELETE FROM ${table}`);
    }

    /** @override */
    deleteWhere(table, whereClause, params = {}) {
        return this.executeNonQuery(
            `DELETE FROM ${table} WHERE ${whereClause}`,
            params
        );
    }

    /** @override */
    dropTable(table) {
        return this.executeNonQuery(`DROP TABLE IF EXISTS ${table}`);
    }

    // ── SELECT ───────────────────────────────────────────────────────

    /** @override */
    async selectOne(table, columns, where) {
        const params = {};
        const clauses = Object.keys(where).map((col) => {
            params[col] = where[col];
            return `${col} = @${col}`;
        });
        const colStr = Array.isArray(columns) ? columns.join(', ') : columns;
        let result = null;
        await this.execute(
            (row) => {
                result = row;
            },
            `SELECT ${colStr} FROM ${table} WHERE ${clauses.join(' AND ')} LIMIT 1`,
            params
        );
        return result;
    }

    /** @override */
    async select(table, columns, where, options = {}) {
        const { order, limit, distinct } = options;
        const colStr = Array.isArray(columns) ? columns.join(', ') : columns;
        const distinctStr = distinct ? 'DISTINCT ' : '';
        let sql = `SELECT ${distinctStr}${colStr} FROM ${table}`;
        const params = {};
        if (where && Object.keys(where).length > 0) {
            const clauses = Object.keys(where).map((col) => {
                params[col] = where[col];
                return `${col} = @${col}`;
            });
            sql += ` WHERE ${clauses.join(' AND ')}`;
        }
        if (order) sql += ` ORDER BY ${order}`;
        if (limit) sql += ` LIMIT ${limit}`;
        const rows = [];
        await this.execute((row) => rows.push(row), sql, params);
        return rows;
    }

    /** @override */
    async selectWhere(table, columns, whereClause, params, options = {}) {
        const { order, limit, distinct } = options;
        const colStr = Array.isArray(columns) ? columns.join(', ') : columns;
        const distinctStr = distinct ? 'DISTINCT ' : '';
        let sql = `SELECT ${distinctStr}${colStr} FROM ${table}`;
        if (whereClause) sql += ` WHERE ${whereClause}`;
        if (order) sql += ` ORDER BY ${order}`;
        if (limit) sql += ` LIMIT ${limit}`;
        const rows = [];
        await this.execute((row) => rows.push(row), sql, params);
        return rows;
    }

    /** @override */
    async selectJoin(spec) {
        const { from, alias, joins, columns, where, params, order, limit } =
            spec;
        let sql = `SELECT ${Array.isArray(columns) ? columns.join(', ') : columns} FROM ${from}`;
        if (alias) sql += ` ${alias}`;
        if (joins) {
            for (const j of joins) {
                sql += ` ${j.type} JOIN ${j.table}`;
                if (j.alias) sql += ` ${j.alias}`;
                sql += ` ON ${j.on}`;
            }
        }
        if (where) sql += ` WHERE ${where}`;
        if (order) sql += ` ORDER BY ${order}`;
        if (limit) sql += ` LIMIT ${limit}`;
        const rows = [];
        await this.execute((row) => rows.push(row), sql, params);
        return rows;
    }

    /** @override */
    async selectWhereIn(
        table,
        columns,
        inColumn,
        inValues,
        extraWhere,
        extraParams,
        options = {}
    ) {
        if (!inValues || inValues.length === 0) return [];
        const { order, limit } = options;
        const params = { ...(extraParams || {}) };
        const placeholders = inValues.map((v, i) => {
            params[`in_${i}`] = v;
            return `@in_${i}`;
        });
        const colStr = Array.isArray(columns) ? columns.join(', ') : columns;
        let sql = `SELECT ${colStr} FROM ${table} WHERE ${inColumn} IN (${placeholders.join(', ')})`;
        if (extraWhere) sql += ` AND ${extraWhere}`;
        if (order) sql += ` ORDER BY ${order}`;
        if (limit) sql += ` LIMIT ${limit}`;
        const rows = [];
        await this.execute((row) => rows.push(row), sql, params);
        return rows;
    }

    /**
     * UNION ALL across multiple sources with optional outer ORDER BY + LIMIT.
     *
     * MySQL 8.0+ supports derived tables without aliases, so the
     * `SELECT * FROM (...)` wrapper from SQLiteAdapter works unchanged.
     *
     * @override
     */
    async selectUnion(sources, options = {}) {
        if (!sources || sources.length === 0) return [];
        const { schema, order, limit } = options;
        const allParams = {};
        const parts = sources.map((source) => {
            const {
                table,
                columns,
                nulls,
                where,
                params,
                order: srcOrder,
                limit: srcLimit
            } = source;
            if (params) Object.assign(allParams, params);
            let colStr = Array.isArray(columns)
                ? columns.join(', ')
                : columns || '*';
            if (nulls && nulls.length > 0) {
                colStr +=
                    ', ' + nulls.map((col) => `NULL AS ${col}`).join(', ');
            }
            let sql = `SELECT ${colStr} FROM ${table}`;
            if (where) sql += ` WHERE ${where}`;
            if (srcOrder) sql += ` ORDER BY ${srcOrder}`;
            if (srcLimit) sql += ` LIMIT ${srcLimit}`;
            return `SELECT * FROM (${sql}) AS u`;
        });
        const outerSchema = schema
            ? Array.isArray(schema)
                ? schema.join(', ')
                : schema
            : '*';
        let finalSql = `SELECT ${outerSchema} FROM (${parts.join(' UNION ALL ')}) AS outer_union`;
        if (order) finalSql += ` ORDER BY ${order}`;
        if (limit) finalSql += ` LIMIT ${limit}`;
        const rows = [];
        await this.execute((row) => rows.push(row), finalSql, allParams);
        return rows;
    }

    /** @override */
    async selectGroupBy(table, spec) {
        const {
            columns,
            aggregates,
            groupBy,
            where,
            params,
            order,
            limit,
            having
        } = spec;
        const colParts = [];
        if (columns) {
            colParts.push(
                Array.isArray(columns) ? columns.join(', ') : columns
            );
        }
        if (aggregates) {
            for (const agg of aggregates) {
                colParts.push(`${agg.expr} AS ${agg.alias}`);
            }
        }
        let sql = `SELECT ${colParts.join(', ')} FROM ${table}`;
        if (where) sql += ` WHERE ${where}`;
        if (groupBy) {
            sql += ` GROUP BY ${Array.isArray(groupBy) ? groupBy.join(', ') : groupBy}`;
        }
        if (having) sql += ` HAVING ${having}`;
        if (order) sql += ` ORDER BY ${order}`;
        if (limit) sql += ` LIMIT ${limit}`;
        const rows = [];
        await this.execute((row) => rows.push(row), sql, params);
        return rows;
    }

    // ── COUNT ────────────────────────────────────────────────────────

    /** @override */
    async count(table, where) {
        const params = {};
        const clauses = Object.keys(where).map((col) => {
            params[col] = where[col];
            return `${col} = @${col}`;
        });
        let result = 0;
        await this.execute(
            (row) => {
                result = row[0];
            },
            `SELECT COUNT(*) FROM ${table} WHERE ${clauses.join(' AND ')}`,
            params
        );
        return result;
    }

    /** @override */
    async countWhere(table, whereClause, params) {
        let result = 0;
        await this.execute(
            (row) => {
                result = row[0];
            },
            `SELECT COUNT(*) FROM ${table}${whereClause ? ` WHERE ${whereClause}` : ''}`,
            params
        );
        return result;
    }

    // ── ALTER TABLE ──────────────────────────────────────────────────

    /** @override */
    alterTableAddColumn(table, columnDef) {
        return this.executeNonQuery(
            `ALTER TABLE ${table} ADD COLUMN ${columnDef}`
        );
    }

    /** @override */
    alterTableDropColumn(table, column) {
        return this.executeNonQuery(
            `ALTER TABLE ${table} DROP COLUMN ${column}`
        );
    }

    /** @override */
    alterTableRename(table, newName) {
        return this.executeNonQuery(
            `ALTER TABLE ${table} RENAME TO ${newName}`
        );
    }

    // ── Increment ────────────────────────────────────────────────────

    /** @override */
    increment(table, column, amount, where) {
        const params = { amount };
        const whereClauses = Object.keys(where).map((col) => {
            params[`where_${col}`] = where[col];
            return `${col} = @where_${col}`;
        });
        return this.executeNonQuery(
            `UPDATE ${table} SET ${column} = ${column} + @amount WHERE ${whereClauses.join(' AND ')}`,
            params
        );
    }

    // ── Transaction ──────────────────────────────────────────────────
    // MySQL 单连接模式(同 SQLite):BEGIN/COMMIT/ROLLBACK 通过 C# 的
    // BeginTransaction/CommitTransaction/RollbackTransaction 管理,
    // C# 侧 _pinnedConnId 单槽 + sliding Timer 防泄漏。

    /**
     * @override
     * @returns {Promise<number>} C# 返回的真实 connId
     * @protected
     */
    async _doBegin() {
        return MySQL.BeginTransaction();
    }

    /**
     * @override
     * @param {number} connId
     * @protected
     */
    async _doCommit(connId) {
        MySQL.CommitTransaction(connId);
    }

    /**
     * @override
     * @param {number} connId
     * @protected
     */
    async _doRollback(connId) {
        try {
            MySQL.RollbackTransaction(connId);
        } catch (e) {
            if (!String(e?.message || '').includes('已超时')) {
                throw e;
            }
        }
    }

    /**
     * @override
     * @param {number} connId
     * @returns {Promise<boolean>} C# KeepAliveTransaction 返回值
     * @protected
     */
    async _doKeepAlive(connId) {
        return MySQL.KeepAliveTransaction(connId);
    }

    // ── SQL fragments (engine-specific syntax) ───────────────────────

    /**
     * SQL expression: convert ISO datetime column to Unix milliseconds.
     * MySQL: UNIX_TIMESTAMP(col) * 1000
     * @override
     * @param {string} column - column name containing ISO datetime
     * @returns {string}
     */
    sqlToUnixMs(column) {
        return `(UNIX_TIMESTAMP(${column}) * 1000)`;
    }

    /**
     * SQL expression: extract world ID from a location string.
     * MySQL: SUBSTRING_INDEX(col, ':', 1)
     * @override
     * @param {string} column - column name containing full location string
     * @returns {string}
     */
    sqlExtractWorldId(column) {
        return `SUBSTRING_INDEX(${column}, ':', 1)`;
    }

    /**
     * SQL expression: check if a location string has an instance ID.
     * MySQL: LOCATE(':', col) > 0
     * @override
     * @param {string} column - column name containing location
     * @returns {string}
     */
    sqlHasInstanceId(column) {
        return `LOCATE(':', ${column}) > 0`;
    }

    /**
     * SQL expression: extract date part from an ISO datetime column.
     * MySQL: DATE(col)
     * @override
     * @param {string} column - column name containing ISO datetime
     * @returns {string}
     */
    sqlDate(column) {
        return `DATE(${column})`;
    }

    /**
     * SQL expression: compute the "enter time" from a leave event record.
     *
     * gamelog_join_leave records only leave events (created_at = leave time,
     * time = duration in ms). Enter time = leave time - duration.
     *
     * MySQL: DATE_SUB(tsCol, INTERVAL (msCol / 1000) SECOND)
     * @override
     * @param {string} tsColumn - column name of the ISO leave timestamp
     * @param {string} msColumn - column name of the duration in milliseconds
     * @returns {string}
     */
    sqlEnterTime(tsColumn, msColumn) {
        return `DATE_SUB(${tsColumn}, INTERVAL (${msColumn} / 1000) SECOND)`;
    }

    // ── UPSERT ───────────────────────────────────────────────────────

    /**
     * INSERT with partial ON DUPLICATE KEY UPDATE.
     *
     * MySQL uses `ON DUPLICATE KEY UPDATE` instead of SQLite's
     * `ON CONFLICT(col) DO UPDATE SET`. MySQL automatically detects
     * conflicts based on any unique key / primary key, so the
     * `conflictColumn` parameter is not embedded in the SQL — but it's
     * kept in the signature for interface compatibility with EngineAdapter.
     *
     * @override
     * @param {string} table - target table name
     * @param {object} insertData - all columns for INSERT
     * @param {object} updateData - subset of columns for UPDATE on conflict
     * @param {string} _conflictColumn - unused in MySQL SQL (auto-detected by unique key)
     * @returns {Promise<number>}
     */
    upsertPartial(table, insertData, updateData, _conflictColumn) {
        const columns = Object.keys(insertData);
        const params = {};
        const values = columns.map((col) => {
            params[col] = insertData[col];
            return `@${col}`;
        });
        const updateClauses = Object.keys(updateData).map((col) => {
            params[`up_${col}`] = updateData[col];
            return `${col} = @up_${col}`;
        });
        const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')}) ON DUPLICATE KEY UPDATE ${updateClauses.join(', ')}`;
        return this.executeNonQuery(sql, params);
    }

    // ── DDL ──────────────────────────────────────────────────────────

    /**
     * Map SQLite column types to MySQL-compatible types.
     *
     * Key differences:
     *   - INTEGER → INT
     *   - TEXT with PRIMARY KEY → VARCHAR(255) (MySQL doesn't allow TEXT
     *     as a primary key without a prefix length)
     *
     * @private
     * @param {string} type - SQLite column type
     * @param {string} [constraints] - column constraints
     * @returns {string} MySQL-compatible type
     */
    _mapColumnType(type, constraints) {
        const upper = type.toUpperCase();
        if (upper === 'INTEGER') return 'INT';
        if (upper === 'TEXT') {
            if (
                constraints &&
                constraints.toUpperCase().includes('PRIMARY KEY')
            ) {
                return 'VARCHAR(255)';
            }
            return 'TEXT';
        }
        return type;
    }

    /**
     * CREATE TABLE IF NOT EXISTS with MySQL type mapping.
     * @override
     * @param {string} tableName - table name to create
     * @param {object[]} columns - [{ name, type, constraints? }] or raw string
     * @returns {Promise<number>}
     */
    createTable(tableName, columns) {
        const colDefs = columns.map((col) => {
            if (typeof col === 'string') return col;
            const mappedType = this._mapColumnType(col.type, col.constraints);
            const constraints = col.constraints ? ` ${col.constraints}` : '';
            return `${col.name} ${mappedType}${constraints}`;
        });
        return this.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${tableName} (${colDefs.join(', ')})`
        );
    }

    /**
     * CREATE INDEX with idempotent error handling.
     *
     * MySQL does NOT support `CREATE INDEX IF NOT EXISTS` (MariaDB does).
     * For MySQL, we attempt `CREATE INDEX` and catch error 1061
     * ("Duplicate key name") to achieve idempotency — mirroring the
     * migration runner's error-swallowing pattern for duplicate indexes.
     *
     * @override
     * @param {string} indexName - index name
     * @param {string} table - target table name
     * @param {string[]|string} columns - column(s) to index
     * @param {boolean} [unique] - create UNIQUE index
     * @returns {Promise<number>}
     */
    async createIndex(indexName, table, columns, unique = false) {
        const uniqueStr = unique ? 'UNIQUE ' : '';
        const colStr = Array.isArray(columns) ? columns.join(', ') : columns;
        try {
            return await this.executeNonQuery(
                `CREATE ${uniqueStr}INDEX ${indexName} ON ${table} (${colStr})`
            );
        } catch (e) {
            if (e && e.message && e.message.includes('Duplicate key name')) {
                return 0;
            }
            throw e;
        }
    }

    // ── Maintenance ──────────────────────────────────────────────────

    /**
     * VACUUM equivalent — MySQL InnoDB manages space reclamation
     * automatically via its background processes. No-op to avoid
     * per-table OPTIMIZE TABLE complexity (the migration runner
     * treats maintenance failures as non-critical).
     * @override
     * @returns {Promise<number>}
     */
    vacuum() {
        return Promise.resolve(0);
    }

    /**
     * ANALYZE equivalent — MySQL InnoDB maintains index statistics
     * automatically. No-op for now; can be enhanced to run
     * ANALYZE TABLE on all tables if performance testing warrants it.
     * @override
     * @returns {Promise<number>}
     */
    optimize() {
        return Promise.resolve(0);
    }

    // ── Schema initialization ────────────────────────────────────────

    /**
     * Create all user-specific tables for the given prefix.
     *
     * MySQL DDL differences from SQLite:
     *   - INTEGER PRIMARY KEY → INT AUTO_INCREMENT PRIMARY KEY
     *   - TEXT PRIMARY KEY → VARCHAR(255) PRIMARY KEY (MySQL disallows TEXT as PK)
     *   - Composite PK on TEXT columns → VARCHAR(255) (index prefix requirement)
     *   - Indexed TEXT columns → VARCHAR(255) (MySQL requires key length for TEXT)
     *   - CREATE INDEX IF NOT EXISTS → this.createIndex() (idempotent via error catch)
     *
     * @override
     * @param {string} prefix - user table prefix
     * @returns {Promise<void>}
     */
    async initUserSchema(prefix) {
        await this.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${this.userTable(prefix, 'feed_gps')} (id INT AUTO_INCREMENT PRIMARY KEY, created_at VARCHAR(255), user_id VARCHAR(255), display_name VARCHAR(255), location TEXT, world_name TEXT, previous_location TEXT, time INT, group_name TEXT)`
        );
        await this.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${this.userTable(prefix, 'feed_status')} (id INT AUTO_INCREMENT PRIMARY KEY, created_at VARCHAR(255), user_id VARCHAR(255), display_name VARCHAR(255), status TEXT, status_description TEXT, previous_status TEXT, previous_status_description TEXT)`
        );
        await this.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${this.userTable(prefix, 'feed_bio')} (id INT AUTO_INCREMENT PRIMARY KEY, created_at VARCHAR(255), user_id VARCHAR(255), display_name VARCHAR(255), bio TEXT, previous_bio TEXT)`
        );
        await this.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${this.userTable(prefix, 'feed_avatar')} (id INT AUTO_INCREMENT PRIMARY KEY, created_at VARCHAR(255), user_id VARCHAR(255), display_name VARCHAR(255), owner_id VARCHAR(255), avatar_name TEXT, current_avatar_image_url TEXT, current_avatar_thumbnail_image_url TEXT, previous_current_avatar_image_url TEXT, previous_current_avatar_thumbnail_image_url TEXT)`
        );
        await this.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${this.userTable(prefix, 'feed_online_offline')} (id INT AUTO_INCREMENT PRIMARY KEY, created_at VARCHAR(255), user_id VARCHAR(255), display_name VARCHAR(255), type VARCHAR(255), location TEXT, world_name TEXT, time INT, group_name TEXT)`
        );
        await this.createIndex(
            'idx_user_created',
            this.userTable(prefix, 'feed_online_offline'),
            ['user_id', 'created_at']
        );
        await this.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${this.userTable(prefix, 'activity_sync_state_v2')} (user_id VARCHAR(255) PRIMARY KEY, updated_at VARCHAR(255) NOT NULL DEFAULT '', is_self INT NOT NULL DEFAULT 0, source_last_created_at VARCHAR(255) NOT NULL DEFAULT '', pending_session_start_at INT, cached_range_days INT NOT NULL DEFAULT 0)`
        );
        await this.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${this.userTable(prefix, 'activity_sessions_v2')} (session_id INT AUTO_INCREMENT PRIMARY KEY, user_id VARCHAR(255) NOT NULL, start_at INT NOT NULL, end_at INT NOT NULL, is_open_tail INT NOT NULL DEFAULT 0, source_revision VARCHAR(255) NOT NULL DEFAULT '')`
        );
        await this.createIndex(
            'idx_user_start',
            this.userTable(prefix, 'activity_sessions_v2'),
            ['user_id', 'start_at']
        );
        await this.createIndex(
            'idx_user_end',
            this.userTable(prefix, 'activity_sessions_v2'),
            ['user_id', 'end_at']
        );
        await this.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${this.userTable(prefix, 'activity_bucket_cache_v2')} (user_id VARCHAR(255) CHARACTER SET ascii NOT NULL, target_user_id VARCHAR(255) CHARACTER SET ascii NOT NULL DEFAULT '', range_days INT NOT NULL, view_kind VARCHAR(255) CHARACTER SET ascii NOT NULL, exclude_key VARCHAR(255) CHARACTER SET ascii NOT NULL DEFAULT '', bucket_version INT NOT NULL DEFAULT 1, raw_buckets_json LONGTEXT NOT NULL, normalized_buckets_json LONGTEXT NOT NULL, built_from_cursor VARCHAR(255) NOT NULL DEFAULT '', summary_json LONGTEXT NOT NULL, built_at VARCHAR(255) NOT NULL DEFAULT '', PRIMARY KEY (user_id, target_user_id, range_days, view_kind, exclude_key))`
        );
        await this.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${this.userTable(prefix, 'friend_log_current')} (user_id VARCHAR(255) PRIMARY KEY, display_name VARCHAR(255), trust_level VARCHAR(255), friend_number INT)`
        );
        await this.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${this.userTable(prefix, 'friend_log_history')} (id INT AUTO_INCREMENT PRIMARY KEY, created_at VARCHAR(255), type VARCHAR(255), user_id VARCHAR(255), display_name VARCHAR(255), previous_display_name VARCHAR(255), trust_level VARCHAR(255), previous_trust_level VARCHAR(255), friend_number INT)`
        );
        await this.createIndex(
            'idx_user_id',
            this.userTable(prefix, 'friend_log_history'),
            ['user_id']
        );
        await this.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${this.userTable(prefix, 'notifications')} (id VARCHAR(255) PRIMARY KEY, created_at VARCHAR(255), type VARCHAR(255), sender_user_id VARCHAR(255), sender_username VARCHAR(255), receiver_user_id VARCHAR(255), message TEXT, world_id VARCHAR(255), world_name TEXT, image_url TEXT, invite_message TEXT, request_message TEXT, response_message TEXT, expired INT)`
        );
        await this.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${this.userTable(prefix, 'notifications_v2')} (id VARCHAR(255) PRIMARY KEY, created_at VARCHAR(255), updated_at VARCHAR(255), expires_at VARCHAR(255), type VARCHAR(255), link TEXT, link_text TEXT, message TEXT, title TEXT, image_url TEXT, seen INT, sender_user_id VARCHAR(255), sender_username VARCHAR(255), data LONGTEXT, responses LONGTEXT, details LONGTEXT)`
        );
        await this.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${this.userTable(prefix, 'moderation')} (user_id VARCHAR(255) PRIMARY KEY, updated_at VARCHAR(255), display_name VARCHAR(255), block INT, mute INT)`
        );
        await this.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${this.userTable(prefix, 'avatar_history')} (avatar_id VARCHAR(255) PRIMARY KEY, created_at VARCHAR(255), time INT)`
        );
        await this.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${this.userTable(prefix, 'notes')} (user_id VARCHAR(255) PRIMARY KEY, display_name VARCHAR(255), note TEXT, created_at VARCHAR(255))`
        );
        await this.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${this.userTable(prefix, 'mutual_graph_friends')} (friend_id VARCHAR(255) PRIMARY KEY)`
        );
        await this.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${this.userTable(prefix, 'mutual_graph_links')} (friend_id VARCHAR(255) NOT NULL, mutual_id VARCHAR(255) NOT NULL, PRIMARY KEY(friend_id, mutual_id))`
        );
        await this.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${this.userTable(prefix, 'mutual_graph_links_old')} (friend_id VARCHAR(255) NOT NULL, mutual_id VARCHAR(255) NOT NULL, date VARCHAR(255) NOT NULL, PRIMARY KEY(friend_id, mutual_id))`
        );
        await this.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${this.userTable(prefix, 'mutual_graph_friends_old')} (friend_id VARCHAR(255) PRIMARY KEY, last_updated VARCHAR(255) NOT NULL)`
        );
        await this.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${this.userTable(prefix, 'mutual_graph_meta')} (friend_id VARCHAR(255) PRIMARY KEY, last_fetched_at VARCHAR(255), opted_out INT DEFAULT 0)`
        );
        await this.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${this.userTable(prefix, 'tracked_nonfriends')} (user_id VARCHAR(255) PRIMARY KEY, display_name VARCHAR(255), added_at VARCHAR(255))`
        );
        await this.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${this.userTable(prefix, 'manual_relations_MANUEL')} (user_id_a VARCHAR(255) NOT NULL, user_id_b VARCHAR(255) NOT NULL, relation_type VARCHAR(255) NOT NULL DEFAULT 'friend', added_at VARCHAR(255), PRIMARY KEY(user_id_a, user_id_b))`
        );
    }

    /**
     * Create all global shared tables.
     *
     * Same MySQL DDL conversion rules as initUserSchema, plus:
     *   - UNIQUE constraints on TEXT columns use prefix length (e.g.
     *     UNIQUE(data(255))) since MySQL requires a key length for TEXT
     *     in unique indexes. This is a pragmatic dedup adaptation — the
     *     primary uniqueness comes from created_at (timestamp).
     *
     * @override
     * @returns {Promise<void>}
     */
    async initGlobalSchema() {
        await this.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS gamelog_location (id INT AUTO_INCREMENT PRIMARY KEY, created_at VARCHAR(255), location VARCHAR(512), world_id VARCHAR(255), world_name TEXT, time INT, group_name TEXT, UNIQUE(created_at, location))`
        );
        await this.createIndex(
            'gamelog_location_created_at_idx',
            'gamelog_location',
            ['created_at']
        );
        await this.createIndex(
            'idx_gamelog_location_world_created',
            'gamelog_location',
            ['world_id', 'created_at']
        );
        await this.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS gamelog_join_leave (id INT AUTO_INCREMENT PRIMARY KEY, created_at VARCHAR(255), type VARCHAR(255), display_name VARCHAR(255), location VARCHAR(512), user_id VARCHAR(255), time INT, UNIQUE(created_at, type, display_name))`
        );
        await this.createIndex(
            'idx_gamelog_jl_location',
            'gamelog_join_leave',
            ['location']
        );
        await this.createIndex(
            'idx_gamelog_jl_user_created',
            'gamelog_join_leave',
            ['user_id', 'created_at']
        );
        await this.createIndex(
            'idx_gamelog_jl_display_created',
            'gamelog_join_leave',
            ['display_name', 'created_at']
        );
        await this.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS gamelog_portal_spawn (id INT AUTO_INCREMENT PRIMARY KEY, created_at VARCHAR(255), display_name VARCHAR(255), location VARCHAR(512), user_id VARCHAR(255), instance_id VARCHAR(255), world_name TEXT, UNIQUE(created_at, display_name))`
        );
        await this.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS gamelog_video_play (id INT AUTO_INCREMENT PRIMARY KEY, created_at VARCHAR(255), video_url VARCHAR(512), video_name TEXT, video_id VARCHAR(255), location VARCHAR(512), display_name VARCHAR(255), user_id VARCHAR(255), UNIQUE(created_at, video_url))`
        );
        await this.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS gamelog_resource_load (id INT AUTO_INCREMENT PRIMARY KEY, created_at VARCHAR(255), resource_url VARCHAR(512), resource_type VARCHAR(255), location VARCHAR(512), UNIQUE(created_at, resource_url))`
        );
        await this.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS gamelog_event (id INT AUTO_INCREMENT PRIMARY KEY, created_at VARCHAR(255), data TEXT, UNIQUE(created_at, data(255)))`
        );
        await this.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS gamelog_external (id INT AUTO_INCREMENT PRIMARY KEY, created_at VARCHAR(255), message TEXT, display_name VARCHAR(255), user_id VARCHAR(255), location VARCHAR(512), UNIQUE(created_at, message(255)))`
        );
        await this.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS cache_avatar (id VARCHAR(255) PRIMARY KEY, added_at VARCHAR(255), author_id VARCHAR(255), author_name VARCHAR(255), created_at VARCHAR(255), description TEXT, image_url TEXT, name VARCHAR(255), release_status VARCHAR(255), thumbnail_image_url TEXT, updated_at VARCHAR(255), version INT)`
        );
        await this.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS cache_world (id VARCHAR(255) PRIMARY KEY, added_at VARCHAR(255), author_id VARCHAR(255), author_name VARCHAR(255), created_at VARCHAR(255), description TEXT, image_url TEXT, name VARCHAR(255), release_status VARCHAR(255), thumbnail_image_url TEXT, updated_at VARCHAR(255), version INT)`
        );
        await this.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS favorite_world (id INT AUTO_INCREMENT PRIMARY KEY, created_at VARCHAR(255), world_id VARCHAR(255), group_name VARCHAR(255))`
        );
        await this.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS favorite_avatar (id INT AUTO_INCREMENT PRIMARY KEY, created_at VARCHAR(255), avatar_id VARCHAR(255), group_name VARCHAR(255))`
        );
        await this.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS favorite_friend (id INT AUTO_INCREMENT PRIMARY KEY, created_at VARCHAR(255), user_id VARCHAR(255), group_name VARCHAR(255))`
        );
        await this.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS memos (user_id VARCHAR(255) PRIMARY KEY, edited_at VARCHAR(255), memo TEXT)`
        );
        await this.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS world_memos (world_id VARCHAR(255) PRIMARY KEY, edited_at VARCHAR(255), memo TEXT)`
        );
        await this.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS avatar_memos (avatar_id VARCHAR(255) PRIMARY KEY, edited_at VARCHAR(255), memo TEXT)`
        );
        await this.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS avatar_tags (avatar_id VARCHAR(255) NOT NULL, tag VARCHAR(255) NOT NULL, color VARCHAR(255), PRIMARY KEY (avatar_id, tag))`
        );
        // cookies 表纳入 GLOBAL_TABLES 走 global 主动迁移路径,与 IAuthStore
        // C# 侧 EnsureCookiesTable DDL 同步。MySQL 不允许 TEXT 作 PK,故
        // `key` 用 VARCHAR(255);value 用 LONGTEXT 容纳序列化 CookieCollection,
        // 与 SQLite/PG 语义对齐(value 列无界定大)。
        await this.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS cookies (\`key\` VARCHAR(255) PRIMARY KEY, \`value\` LONGTEXT)`
        );
    }

    // ── Metadata ─────────────────────────────────────────────────────

    /**
     * List user tables matching a LIKE pattern.
     *
     * Uses INFORMATION_SCHEMA.TABLES with a parameterized LIKE clause
     * instead of `SHOW TABLES LIKE` — SHOW TABLES doesn't support
     * prepared-statement parameters, and the adapter contract requires
     * @param binding for injection safety.
     *
     * @override
     * @param {string} likePattern - SQL LIKE pattern (e.g. '%_feed_gps')
     * @returns {Promise<string[]>}
     */
    async listTables(likePattern) {
        const tables = [];
        await this.execute(
            (row) => tables.push(row[0]),
            `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE @pattern`,
            { pattern: likePattern }
        );
        return tables;
    }

    /**
     * Get column metadata for a table.
     *
     * Returns positional arrays matching SQLite PRAGMA table_xinfo column
     * order: [cid, name, type, notnull, dflt_value, pk, hidden].
     * MySQL has no hidden columns, so the last field is always 0.
     *
     * @override
     * @param {string} table - table name
     * @returns {Promise<Array<Array>>}
     */
    async getTableColumns(table) {
        const rows = [];
        await this.execute(
            (row) => rows.push(row),
            `SELECT ORDINAL_POSITION, COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY, 0 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @table ORDER BY ORDINAL_POSITION`,
            { table }
        );
        return rows;
    }

    /**
     * Enumerate all user tables with their column metadata.
     *
     * Returns the same structured format as SQLiteAdapter.listTablesTypes
     * so that copyTableData (vrcx.js) works unchanged across engines:
     *   { tableName, columns: [{ name, type, notNull, defaultValue, isPK, isHidden }] }
     *
     * @override
     * @returns {Promise<Array<{tableName: string, columns: Array}>>}
     */
    async listTablesTypes() {
        const tableRows = [];
        await this.execute(
            (r) => tableRows.push(r),
            `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`
        );

        const result = [];
        for (const [tableName] of tableRows) {
            const colRows = [];
            await this.execute(
                (r) => colRows.push(r),
                `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @table ORDER BY ORDINAL_POSITION`,
                { table: tableName }
            );
            result.push({
                tableName,
                columns: colRows.map((c) => ({
                    name: c[0],
                    type: c[1],
                    notNull: c[2] === 'NO',
                    defaultValue: c[3],
                    isPK: c[4] === 'PRI',
                    isHidden: false
                }))
            });
        }
        return result;
    }

    // ── Naming ───────────────────────────────────────────────────────

    /**
     * Resolve a user table name with prefix applied.
     *
     * MySQL/SQLite both use `{prefix}_{name}` (no schema isolation,
     * unlike PostgreSQL's `account_{prefix}.{name}`). Respects
     * _prefixOverride set by withPrefix() for cross-account queries.
     *
     * @override
     * @param {string} prefix - user table prefix (account hash)
     * @param {string} name - base table name
     * @returns {string}
     */
    userTable(prefix, name) {
        const p = this._prefixOverride ?? prefix;
        return `${p}_${name}`;
    }

    /**
     * Async liveness probe backed by C# `MySQL.Ping()`.
     *
     * Symmetric to `PgSQLAdapter.isConnected()`. `Ping` executes
     * `SELECT 1` against the pooled MySQL/MariaDB connection, confirming
     * the backend is actually reachable — unlike `IsConnected`, which only
     * reports initialisation state. Worst-case latency when the server is
     * unreachable is bounded by `ConnectionTimeout` (default 15s); in the
     * common connected case it is sub-millisecond.
     *
     * Used by `pullEngine`/`pushEngine` as a fail-fast guard before
     * attempting a long copy operation, so a disconnected backend produces
     * a clear "backend is not connected" error rather than a delayed,
     * mid-copy SQL failure.
     *
     * Declared `async` and `await`s the C# bridge so the result is
     * correct on both runtimes: on CefSharp `Ping()` returns a plain
     * `boolean` (awaiting it is a no-op); on Electron `Ping()` returns
     * a `Promise<boolean>` via the InteropApi Proxy, and `Boolean(Promise)`
     * would otherwise always be `true`. The `typeof` guard short-circuits
     * both the undeclared-binding case and the `undefined` value case,
     * returning `false` without touching the bridge.
     *
     * @returns {Promise<boolean>}
     */
    async isConnected() {
        if (typeof MySQL === 'undefined' || !MySQL?.Ping) return false;
        return Boolean(await MySQL.Ping());
    }

    /**
     * Health probe backed by C# `MySQL.GetHealth()`.
     *
     * @returns {Promise<{ connected: boolean, latencyMs?: number, lastHealthCheck?: string|null }>}
     */
    async getHealth() {
        const json = await MySQL.GetHealth();
        return json ? JSON.parse(json) : { connected: false };
    }

    async getPoolStats() {
        const json = await MySQL.GetPoolStats();
        return json
            ? JSON.parse(json)
            : {
                  active: 0,
                  pinnedIdle: 0,
                  availableCapacity: 0,
                  max: 0,
                  totalOpen: 0,
                  idleInPool: 0
              };
    }

    async clearIdleConnections() {
        await MySQL.ClearIdleConnections();
    }
}

export { MySQLAdapter };
