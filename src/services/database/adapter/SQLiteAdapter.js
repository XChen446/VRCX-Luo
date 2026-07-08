import sqliteService from '../../sqlite.js';

/**
 * SQLite dialect adapter.
 *
 * Wraps sqliteService with structured methods that encapsulate SQLite-specific
 * syntax (INSERT OR IGNORE/REPLACE, @-params, IF NOT EXISTS, etc.).
 * All SQLite dialect keywords are centralized here — when switching engines,
 * replace this adapter's implementation (param style, conflict clause, DDL syntax).
 *
 * Business logic modules (feed.js, gameLog.js, etc.) call these methods with
 * structured parameters and never construct SQL strings directly.
 */
class SQLiteAdapter {
    /** Execute raw SQL with row callback. For complex queries (UNION ALL, subqueries). */
    execute(callback, sql, args) {
        return sqliteService.execute(callback, sql, args);
    }

    /** Execute raw SQL without row callback. */
    executeNonQuery(sql, args) {
        return sqliteService.executeNonQuery(sql, args);
    }

    /** Execute read-only SQL on a separate SQLite connection. */
    executeReadOnly(path, sql, args) {
        return sqliteService.executeReadOnly(path, sql, args);
    }

    /** @private Map 'ignore'|'replace' to OR IGNORE|OR REPLACE clause. */
    _insertClause(conflict) {
        return conflict === 'ignore' ? 'OR IGNORE' : conflict === 'replace' ? 'OR REPLACE' : '';
    }

    /**
     * Single-row INSERT with optional conflict handling.
     * @param {string} table - target table name (with prefix if applicable)
     * @param {object} data - column:value mapping (snake_case keys)
     * @param {string} [conflict] - 'ignore' → INSERT OR IGNORE, 'replace' → INSERT OR REPLACE
     */
    insert(table, data, conflict) {
        const clause = this._insertClause(conflict);
        const columns = Object.keys(data);
        const params = {};
        const values = columns.map((col) => {
            params[`@${col}`] = data[col];
            return `@${col}`;
        });
        return sqliteService.executeNonQuery(
            `INSERT ${clause} INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')})`,
            params
        );
    }

    /**
     * Bulk multi-row INSERT with optional conflict handling.
     * @param {string} table - target table name
     * @param {object[]} rows - array of column:value objects (all must share the same keys)
     * @param {string} [conflict] - 'ignore' → INSERT OR IGNORE, 'replace' → INSERT OR REPLACE
     */
    async bulkInsert(table, rows, conflict) {
        if (rows.length === 0) return;
        const clause = this._insertClause(conflict);
        const columns = Object.keys(rows[0]);
        const params = {};
        const values = rows.map((row, i) => {
            return '(' + columns.map((col) => {
                params[`@${col}_${i}`] = row[col];
                return `@${col}_${i}`;
            }).join(', ') + ')';
        });
        return sqliteService.executeNonQuery(
            `INSERT ${clause} INTO ${table} (${columns.join(', ')}) VALUES ${values.join(', ')}`,
            params
        );
    }

    /**
     * UPDATE with equality conditions.
     * @param {string} table - target table name
     * @param {object} data - columns to SET (key:value)
     * @param {object} where - equality conditions (AND-ed)
     */
    update(table, data, where) {
        const params = {};
        const setClauses = Object.keys(data).map((col) => {
            params[`@set_${col}`] = data[col];
            return `${col} = @set_${col}`;
        });
        const whereClauses = Object.keys(where).map((col) => {
            params[`@where_${col}`] = where[col];
            return `${col} = @where_${col}`;
        });
        return sqliteService.executeNonQuery(
            `UPDATE ${table} SET ${setClauses.join(', ')} WHERE ${whereClauses.join(' AND ')}`,
            params
        );
    }

    /**
     * DELETE with equality conditions.
     * @param {string} table - target table name
     * @param {object} where - equality conditions (AND-ed)
     */
    delete(table, where) {
        const params = {};
        const clauses = Object.keys(where).map((col) => {
            params[`@${col}`] = where[col];
            return `${col} = @${col}`;
        });
        return sqliteService.executeNonQuery(
            `DELETE FROM ${table} WHERE ${clauses.join(' AND ')}`,
            params
        );
    }

    /**
     * SELECT one row with equality WHERE and LIMIT 1.
     * @returns {Array|null} row as array, or null if not found
     */
    async selectOne(table, columns, where) {
        const params = {};
        const clauses = Object.keys(where).map((col) => {
            params[`@${col}`] = where[col];
            return `${col} = @${col}`;
        });
        const colStr = Array.isArray(columns) ? columns.join(', ') : columns;
        let result = null;
        await sqliteService.execute(
            (row) => { result = row; },
            `SELECT ${colStr} FROM ${table} WHERE ${clauses.join(' AND ')} LIMIT 1`,
            params
        );
        return result;
    }

    /**
     * SELECT rows with equality conditions.
     * @param {object} [options] - { order, limit, distinct }
     * @returns {Array<Array>} array of row arrays
     */
    async select(table, columns, where, options = {}) {
        const { order, limit, distinct } = options;
        const params = {};
        const clauses = Object.keys(where).map((col) => {
            params[`@${col}`] = where[col];
            return `${col} = @${col}`;
        });
        const colStr = Array.isArray(columns) ? columns.join(', ') : columns;
        const distinctStr = distinct ? 'DISTINCT ' : '';
        let sql = `SELECT ${distinctStr}${colStr} FROM ${table} WHERE ${clauses.join(' AND ')}`;
        if (order) sql += ` ORDER BY ${order}`;
        if (limit) sql += ` LIMIT ${limit}`;
        const rows = [];
        await sqliteService.execute((row) => rows.push(row), sql, params);
        return rows;
    }

    /**
     * SELECT with raw WHERE clause string (for complex filters, LIKE, date ranges).
     * @param {string} [whereClause] - raw WHERE content (without the WHERE keyword), null to skip
     * @param {object} [params] - named parameters for the WHERE clause
     * @param {object} [options] - { order, limit, distinct }
     * @returns {Array<Array>} array of row arrays
     */
    async selectWhere(table, columns, whereClause, params, options = {}) {
        const { order, limit, distinct } = options;
        const colStr = Array.isArray(columns) ? columns.join(', ') : columns;
        const distinctStr = distinct ? 'DISTINCT ' : '';
        let sql = `SELECT ${distinctStr}${colStr} FROM ${table}`;
        if (whereClause) sql += ` WHERE ${whereClause}`;
        if (order) sql += ` ORDER BY ${order}`;
        if (limit) sql += ` LIMIT ${limit}`;
        const rows = [];
        await sqliteService.execute((row) => rows.push(row), sql, params);
        return rows;
    }

    /**
     * SELECT with WHERE col IN (...) + optional extra conditions.
     * Builds named params for the IN list to avoid SQL injection.
     * @param {string} inColumn - column name for IN clause
     * @param {*[]} inValues - values for IN list
     * @param {string} [extraWhere] - additional AND conditions (raw SQL fragment)
     * @param {object} [extraParams] - named params for extraWhere
     * @param {object} [options] - { order, limit }
     * @returns {Array<Array>} array of row arrays
     */
    async selectWhereIn(table, columns, inColumn, inValues, extraWhere, extraParams, options = {}) {
        if (!inValues || inValues.length === 0) return [];
        const { order, limit } = options;
        const params = { ...(extraParams || {}) };
        const placeholders = inValues.map((v, i) => {
            params[`@in_${i}`] = v;
            return `@in_${i}`;
        });
        const colStr = Array.isArray(columns) ? columns.join(', ') : columns;
        let sql = `SELECT ${colStr} FROM ${table} WHERE ${inColumn} IN (${placeholders.join(', ')})`;
        if (extraWhere) sql += ` AND ${extraWhere}`;
        if (order) sql += ` ORDER BY ${order}`;
        if (limit) sql += ` LIMIT ${limit}`;
        const rows = [];
        await sqliteService.execute((row) => rows.push(row), sql, params);
        return rows;
    }

    /**
     * Enumerate table names matching a LIKE pattern.
     * Wraps sqlite_schema query — dialect-specific, engine-dependent.
     * @param {string} likePattern - e.g. '%_feed_gps'
     * @returns {string[]} matching table names
     */
    async listTables(likePattern) {
        const tables = [];
        await sqliteService.execute(
            (row) => tables.push(row[0]),
            `SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE @pattern`,
            { '@pattern': likePattern }
        );
        return tables;
    }

    /** COUNT with equality conditions. */
    async count(table, where) {
        const params = {};
        const clauses = Object.keys(where).map((col) => {
            params[`@${col}`] = where[col];
            return `${col} = @${col}`;
        });
        let result = 0;
        await sqliteService.execute(
            (row) => { result = row[0]; },
            `SELECT COUNT(*) FROM ${table} WHERE ${clauses.join(' AND ')}`,
            params
        );
        return result;
    }

    /** COUNT with raw WHERE clause. Omit whereClause to COUNT all rows. */
    async countWhere(table, whereClause, params) {
        let result = 0;
        await sqliteService.execute(
            (row) => { result = row[0]; },
            `SELECT COUNT(*) FROM ${table}${whereClause ? ` WHERE ${whereClause}` : ''}`,
            params
        );
        return result;
    }

    /**
     * CREATE TABLE IF NOT EXISTS from structured column definitions.
     * @param {object[]} columns - [{ name, type, constraints? }] or raw string for simple defs
     */
    createTable(tableName, columns) {
        const colDefs = columns.map((col) => {
            if (typeof col === 'string') return col;
            const constraints = col.constraints ? ` ${col.constraints}` : '';
            return `${col.name} ${col.type}${constraints}`;
        });
        return sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${tableName} (${colDefs.join(', ')})`
        );
    }

    /** CREATE TABLE IF NOT EXISTS from raw SQL string. */
    createTableRaw(sql) {
        return sqliteService.executeNonQuery(sql);
    }

    /** CREATE INDEX IF NOT EXISTS. */
    createIndex(indexName, table, columns, unique = false) {
        const uniqueStr = unique ? 'UNIQUE ' : '';
        const colStr = Array.isArray(columns) ? columns.join(', ') : columns;
        return sqliteService.executeNonQuery(
            `CREATE ${uniqueStr}INDEX IF NOT EXISTS ${indexName} ON ${table} (${colStr})`
        );
    }

    /** ALTER TABLE ADD COLUMN. */
    alterTableAddColumn(table, columnDef) {
        return sqliteService.executeNonQuery(
            `ALTER TABLE ${table} ADD COLUMN ${columnDef}`
        );
    }

    /** ALTER TABLE DROP COLUMN. */
    alterTableDropColumn(table, column) {
        return sqliteService.executeNonQuery(
            `ALTER TABLE ${table} DROP COLUMN ${column}`
        );
    }

    /** ALTER TABLE RENAME TO. */
    alterTableRename(table, newName) {
        return sqliteService.executeNonQuery(
            `ALTER TABLE ${table} RENAME TO ${newName}`
        );
    }

    /**
     * Compute ISO date string for N days ago.
     * Replaces SQLite datetime('now', '-N days') in SQL with a pre-computed JS value.
     * @param {number} days - number of days to go back
     * @returns {string} ISO date string
     */
    daysAgoISO(days) {
        return new Date(Date.now() - days * 86400000).toISOString();
    }

    /**
     * SQL expression: convert ISO datetime column to Unix milliseconds.
     * SQLite: (strftime('%s', column) * 1000)
     * @param {string} column - column name containing ISO datetime
     * @returns {string} SQL expression
     */
    sqlToUnixMs(column) {
        return `(strftime('%s', ${column}) * 1000)`;
    }

    /**
     * SQL expression: extract world ID from a location string (e.g. "wrld_xxx:12345" → "wrld_xxx").
     * SQLite: SUBSTR(location, 1, INSTR(location, ':') - 1)
     * @param {string} column - column name containing full location string
     * @returns {string} SQL expression
     */
    sqlExtractWorldId(column) {
        return `SUBSTR(${column}, 1, INSTR(${column}, ':') - 1)`;
    }

    /**
     * SQL expression: check if a location string has an instance ID (contains ':').
     * SQLite: INSTR(column, ':') > 0
     * PostgreSQL: POSITION(':' IN column) > 0 or strpos(column, ':') > 0
     * @param {string} column - column name containing location
     * @returns {string} SQL expression
     */
    sqlHasInstanceId(column) {
        return `INSTR(${column}, ':') > 0`;
    }

    /**
     * SQL expression: extract date part from an ISO datetime column.
     * SQLite/PostgreSQL: date(column)
     * @param {string} column - column name containing ISO datetime
     * @returns {string} SQL expression
     */
    sqlDate(column) {
        return `date(${column})`;
    }

    /**
     * SQL expression: compute the "enter time" from a leave event record.
     *
     * ── 2026-07-08 后代开发者吐槽 ──
     * 这个方法的出现是因为 gamelog_join_leave 表只记录了"离开事件"（created_at）
     * 和"停留时长"（time, 毫秒），没有记录"进入时间"。
     * 为了做两人是否同时在线的时间重叠检测，不得不用离开时间减去时长来推算进入时间。
     *
     * 如果当年设计表的时候就加一列 entered_at，这整个方法都不需要存在。
     * 现在加列需要改表结构 + migration + 数据回填，成本远大于保留这个函数。
     * 所以它就在这里了——一个推算函数，不是翻译器。
     *
     * 协议：input 是 ISO 时间戳列名 + 毫秒数列名，
     *       output 是和 ISO 时间戳字符串可比较的表达式。
     * ──────────────────────────────────
     *
     * gamelog_join_leave stores OnPlayerLeft events with:
     *   created_at — ISO timestamp when the player left
     *   time       — duration spent in the instance (milliseconds)
     *
     * The actual enter time is: created_at - time (in ms).
     *
     * @param {string} tsColumn  - column name of the ISO leave timestamp
     * @param {string} msColumn  - column name of the duration in milliseconds
     * @returns {string} SQL expression that evaluates to the enter timestamp
     */
    sqlEnterTime(tsColumn, msColumn) {
        return `strftime('%Y-%m-%dT%H:%M:%SZ', ${tsColumn}, '-' || (${msColumn} * 1.0 / 1000) || ' seconds')`;
    }

    /**
     * UPDATE with arithmetic expression: SET col = col + @amount WHERE conditions.
     * @param {string} table - target table name
     * @param {string} column - column to increment
     * @param {number} amount - value to add
     * @param {object} where - equality conditions (AND-ed)
     */
    increment(table, column, amount, where) {
        const params = { '@amount': amount };
        const whereClauses = Object.keys(where).map((col) => {
            params[`@where_${col}`] = where[col];
            return `${col} = @where_${col}`;
        });
        return sqliteService.executeNonQuery(
            `UPDATE ${table} SET ${column} = ${column} + @amount WHERE ${whereClauses.join(' AND ')}`,
            params
        );
    }

    /**
     * Resolve user-specific table name for the current engine.
     *
     * SQLite/MySQL:  prefix_name
     * PostgreSQL:    account_prefix.name
     *
     * @param {string} prefix - user prefix (e.g. "usr123")
     * @param {string} name   - table base name (e.g. "feed_gps")
     * @returns {string} engine-specific full table name
     */
    userTable(prefix, name) {
        return `${prefix}_${name}`;
    }

    /**
     * INSERT with partial ON CONFLICT UPDATE.
     *
     * Writes insertData on fresh row; on conflict only updates the columns
     * listed in updateData (leaving other existing columns unchanged).
     *
     * SQLite/PgSQL:  INSERT ... ON CONFLICT(col) DO UPDATE SET ...
     * MySQL:         INSERT ... ON DUPLICATE KEY UPDATE ...
     *
     * @param {string} table          - target table name
     * @param {object} insertData     - all columns for INSERT
     * @param {object} updateData     - subset of columns for UPDATE on conflict
     * @param {string} conflictColumn - column to detect conflict on
     */
    upsertPartial(table, insertData, updateData, conflictColumn) {
        const columns = Object.keys(insertData);
        const params = {};
        const values = columns.map((col) => {
            params[`@${col}`] = insertData[col];
            return `@${col}`;
        });
        const updateClauses = Object.keys(updateData).map((col) => {
            params[`@up_${col}`] = updateData[col];
            return `${col} = @up_${col}`;
        });
        const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')}) ON CONFLICT(${conflictColumn}) DO UPDATE SET ${updateClauses.join(', ')}`;
        return sqliteService.executeNonQuery(sql, params);
    }

    /** BEGIN transaction. */
    begin() {
        return sqliteService.executeNonQuery('BEGIN');
    }

    /** COMMIT transaction. */
    commit() {
        return sqliteService.executeNonQuery('COMMIT');
    }

    /** ROLLBACK transaction. */
    rollback() {
        return sqliteService.executeNonQuery('ROLLBACK');
    }

    /** VACUUM — reclaim storage. */
    vacuum() {
        return sqliteService.executeNonQuery('VACUUM');
    }

    /** PRAGMA optimize — maintenance hint. SQLite-specific; replace with ANALYZE on other engines. */
    optimize() {
        return sqliteService.executeNonQuery('PRAGMA optimize');
    }
}

export { SQLiteAdapter };
