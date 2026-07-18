import { EngineAdapter } from './EngineAdapter.js';

/**
 * MySQL / MariaDB dialect adapter.
 *
 * Mirrors SQLiteAdapter's structure but routes execution through the C#
 * MySQL backend (Dotnet/MySQL.cs) instead of SQLite. Parameter style is
 * `@param` (same as SQLite) — see architecture note below.
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

    /**
     * @param {object} [config]
     * @param {string} [config.connection] - mysql:// URI 或原始连接字符串
     * @param {...object} [config.params] - 额外连接参数（覆盖默认）
     */
    constructor({ connection, ...params } = {}) {
        super();
        if (connection) {
            this.connectionString = this._buildConnectionString(connection, params);
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
        try {
            if (this.connectionString) {
                if (LINUX && args) {
                    args = new Map(Object.entries(args));
                }
                const json = await MySQL.ExecuteJson(this.connectionString, sql, args);
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
                const json = await MySQL.ExecuteJson(sql, args);
                const items = JSON.parse(json);
                items.forEach((item) => {
                    callback(item);
                });
                return;
            }
            const data = await MySQL.Execute(sql, args);
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
        try {
            if (this.connectionString) {
                if (LINUX && args) {
                    args = new Map(Object.entries(args));
                }
                return await MySQL.ExecuteNonQuery(this.connectionString, sql, args);
            }
            if (LINUX && args) {
                args = new Map(Object.entries(args));
            }
            return await MySQL.ExecuteNonQuery(sql, args);
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
            return `SELECT * FROM (${sql})`;
        });
        const outerSchema = schema
            ? Array.isArray(schema)
                ? schema.join(', ')
                : schema
            : '*';
        let finalSql = `SELECT ${outerSchema} FROM (${parts.join(' UNION ALL ')})`;
        if (order) finalSql += ` ORDER BY ${order}`;
        if (limit) finalSql += ` LIMIT ${limit}`;
        const rows = [];
        await this.execute(
            (row) => rows.push(row),
            finalSql,
            allParams
        );
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

    /** @override */
    begin() {
        return this.executeNonQuery('BEGIN');
    }

    /** @override */
    commit() {
        return this.executeNonQuery('COMMIT');
    }

    /** @override */
    rollback() {
        return this.executeNonQuery('ROLLBACK');
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
            if (constraints && constraints.toUpperCase().includes('PRIMARY KEY')) {
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
}

export { MySQLAdapter };
