/**
 * Abstract base class for database engine adapters.
 *
 * Defines the interface that every engine adapter must implement.
 * Subclasses must implement all `@abstract` methods;
 * `@optional` methods have default implementations and may be overridden.
 *
 * Tag conventions:
 *   @abstract         — subclass MUST implement; base throws 'abstract'
 *   @optional         — base provides a default; subclass MAY override
 *   @engine-specific  — produces engine-dependent SQL syntax (SQLite/PgSQL/MySQL differ)
 *
 * Interface frozen at 42 abstract + 3 optional methods (2026-07-16).
 */

class EngineAdapter {
    /** @type {string|null} */
    _prefixOverride = null;

    constructor() {
        if (new.target === EngineAdapter) {
            throw new TypeError(
                'EngineAdapter is abstract — instantiate a subclass'
            );
        }
    }

    // ── Optional overrides ──────────────────────────────────────────

    /**
     * Normalize parameter objects for the dialect's binding style.
     *
     * SQLite uses named `@param` keys; PG uses positional `$N`; MySQL uses `?`.
     * Override in subclasses to transform `{ key: val }` into the dialect's
     * required form. Default identity pass-through.
     *
     * @optional
     * @param {object|Array|null} _args - raw parameter object from caller
     * @returns {object|Array|null} dialect-adjusted parameter object
     * @protected
     */
    _normalizeArgs(_args) {
        return _args;
    }

    /**
     * Execute an async function with a temporary prefix override
     * for userTable(). Nested calls are supported.
     *
     * @optional
     * @param {string} _prefix - user table prefix to apply within fn
     * @param {() => Promise<T>} _fn - async callback to run under the override
     * @returns {Promise<T>}
     * @template T
     */
    async withPrefix(_prefix, _fn) {
        const prev = this._prefixOverride;
        this._prefixOverride = _prefix;
        try {
            return await _fn();
        } finally {
            this._prefixOverride = prev;
        }
    }

    // ── Raw execution ────────────────────────────────────────────────

    /**
     * Execute raw SQL with a per-row callback.
     *
     * @abstract
     * @param {(row: Array) => void} _callback - called once per result row (positional array)
     * @param {string} _sql - SQL statement (SELECT / PRAGMA)
     * @param {object|Array|null} [_args] - named or positional parameters
     * @returns {Promise<void>}
     */
    execute(_callback, _sql, _args) {
        throw new Error('abstract');
    }

    /**
     * Execute raw SQL without row callback (INSERT/UPDATE/DELETE/DDL).
     *
     * @abstract
     * @param {string} _sql - SQL statement
     * @param {object|Array|null} [_args] - named or positional parameters
     * @returns {Promise<number>} rows affected
     */
    executeNonQuery(_sql, _args) {
        throw new Error('abstract');
    }

    // ── CRUD ─────────────────────────────────────────────────────────

    /**
     * Single-row INSERT with optional conflict handling.
     *
     * @abstract
     * @engine-specific — SQLite: `INSERT OR IGNORE`/`INSERT OR REPLACE`; PostgreSQL: `ON CONFLICT DO NOTHING`/`ON CONFLICT DO UPDATE`; MySQL: `INSERT IGNORE`/`REPLACE INTO`
     * @param {string} _table - target table name (with prefix if applicable)
     * @param {object} _data - column:value mapping
     * @param {string} [_conflict] - 'ignore' → INSERT OR IGNORE, 'replace' → INSERT OR REPLACE
     * @returns {Promise<number>} rows affected
     */
    insert(_table, _data, _conflict) {
        throw new Error('abstract');
    }

    /**
     * Bulk multi-row INSERT with optional conflict handling.
     *
     * @abstract
     * @engine-specific — SQLite: `INSERT OR IGNORE`/`INSERT OR REPLACE`; PostgreSQL: `ON CONFLICT DO NOTHING`/`ON CONFLICT DO UPDATE`; MySQL: `INSERT IGNORE`/`REPLACE INTO`
     * @param {string} _table - target table name
     * @param {object[]} _rows - array of column:value objects (all must share the same keys)
     * @param {string} [_conflict] - 'ignore' | 'replace'
     * @returns {Promise<number>} rows affected
     */
    bulkInsert(_table, _rows, _conflict) {
        throw new Error('abstract');
    }

    /**
     * UPDATE with equality conditions.
     *
     * @abstract
     * @param {string} _table - target table name
     * @param {object} _data - columns to SET (key:value)
     * @param {object} _where - equality conditions (key:value → col = @key)
     * @returns {Promise<number>} rows affected
     */
    update(_table, _data, _where) {
        throw new Error('abstract');
    }

    /**
     * UPDATE with raw WHERE clause (non-equality conditions).
     *
     * @abstract
     * @param {string} _table - target table name
     * @param {object} _data - columns to SET (key:value)
     * @param {string} _whereClause - raw WHERE content (without the WHERE keyword)
     * @param {object} [_params] - named parameters for the WHERE clause
     * @returns {Promise<number>} rows affected
     */
    updateWhere(_table, _data, _whereClause, _params) {
        throw new Error('abstract');
    }

    /**
     * DELETE with equality conditions.
     *
     * @abstract
     * @param {string} _table - target table name
     * @param {object} _where - equality conditions (key:value)
     * @returns {Promise<number>} rows affected
     */
    delete(_table, _where) {
        throw new Error('abstract');
    }

    /**
     * DELETE all rows from a table.
     *
     * @abstract
     * @param {string} _table - target table name
     * @returns {Promise<number>} rows affected
     */
    deleteAll(_table) {
        throw new Error('abstract');
    }

    /**
     * DELETE with raw WHERE clause (non-equality conditions).
     *
     * @abstract
     * @param {string} _table - target table name
     * @param {string} _whereClause - raw WHERE content (without the WHERE keyword)
     * @param {object} [_params] - named parameters for the WHERE clause
     * @returns {Promise<number>} rows affected
     */
    deleteWhere(_table, _whereClause, _params) {
        throw new Error('abstract');
    }

    /**
     * Increment a numeric column by a given amount with equality conditions.
     *
     * @abstract
     * @param {string} _table - target table name
     * @param {string} _column - column to increment
     * @param {number} _amount - increment amount
     * @param {object} _where - equality conditions (key:value)
     * @returns {Promise<number>} rows affected
     */
    increment(_table, _column, _amount, _where) {
        throw new Error('abstract');
    }

    /**
     * UPSERT: insert if not exists, update on conflict.
     *
     * @abstract
     * @engine-specific — SQLite/PostgreSQL: `ON CONFLICT(col) DO UPDATE SET ...`; MySQL: `ON DUPLICATE KEY UPDATE ...`
     * @param {string} _table - target table name
     * @param {object} _insertData - columns to insert (key:value)
     * @param {object} _updateData - columns to update on conflict (key:value)
     * @param {string} _conflictColumn - column name that triggers conflict
     * @returns {Promise<number>} rows affected
     */
    upsertPartial(_table, _insertData, _updateData, _conflictColumn) {
        throw new Error('abstract');
    }

    // ── SELECT ───────────────────────────────────────────────────────

    /**
     * SELECT a single row with equality conditions.
     *
     * @abstract
     * @param {string} _table - source table name
     * @param {string[]} _columns - column names to select
     * @param {object} _where - equality conditions (key:value)
     * @returns {Promise<Array|null>} single row as positional array, or null
     */
    selectOne(_table, _columns, _where) {
        throw new Error('abstract');
    }

    /**
     * SELECT rows with equality conditions. Omit `where` to select all rows.
     *
     * @abstract
     * @param {string} _table - source table name
     * @param {string[]} _columns - column names to select
     * @param {object} [_where] - equality conditions (key:value); omit for all rows
     * @param {object} [_options] - { order?, limit?, distinct? }
     * @returns {Promise<Array<Array>>} rows as positional arrays
     */
    select(_table, _columns, _where, _options) {
        throw new Error('abstract');
    }

    /**
     * SELECT rows with raw WHERE clause (non-equality conditions).
     *
     * @abstract
     * @param {string} _table - source table name
     * @param {string[]} _columns - column names to select
     * @param {string} [_whereClause] - raw WHERE content (without the WHERE keyword); omit/null to skip WHERE
     * @param {object} [_params] - named parameters for the WHERE clause
     * @param {object} [_options] - { order?, limit?, distinct? }
     * @returns {Promise<Array<Array>>} rows as positional arrays
     */
    selectWhere(_table, _columns, _whereClause, _params, _options) {
        throw new Error('abstract');
    }

    /**
     * SELECT with JOIN(s), raw WHERE, ORDER BY, LIMIT.
     *
     * @abstract
     * @param {object} _spec - { from, alias?, joins?, columns, where?, params?, order?, limit? }
     *   joins: [{ type, table, alias?, on }]
     * @returns {Promise<Array<Array>>} rows as positional arrays
     */
    selectJoin(_spec) {
        throw new Error('abstract');
    }

    /**
     * SELECT rows WHERE column IN (values), with optional extra conditions.
     *
     * @abstract
     * @param {string} _table - source table name
     * @param {string[]} _columns - column names to select
     * @param {string} _inColumn - column name for IN clause
     * @param {Array} _inValues - values for IN clause
     * @param {string} [_extraWhere] - additional raw WHERE content (AND'd with IN)
     * @param {object} [_extraParams] - named parameters for extra WHERE
     * @param {object} [_options] - { order?, limit? }
     * @returns {Promise<Array<Array>>} rows as positional arrays
     */
    selectWhereIn(
        _table,
        _columns,
        _inColumn,
        _inValues,
        _extraWhere,
        _extraParams,
        _options
    ) {
        throw new Error('abstract');
    }

    /**
     * UNION ALL across multiple sources with optional outer ORDER BY + LIMIT.
     *
     * @abstract
     * @param {object[]} _sources - each: { table, columns?, nulls?, where?, params?, order?, limit? }
     * @param {object} [_options] - { schema?, order?, limit? }
     * @returns {Promise<Array<Array>>} rows as positional arrays
     */
    selectUnion(_sources, _options) {
        throw new Error('abstract');
    }

    /**
     * SELECT with GROUP BY and aggregate expressions.
     *
     * @abstract
     * @param {string} _table - source table name
     * @param {object} _spec - { columns?, aggregates?, groupBy?, where?, params?, order?, limit?, having? }
     *   aggregates: [{ expr: 'COUNT(*)', alias: 'cnt' }]
     * @returns {Promise<Array<Array>>} rows as positional arrays
     */
    selectGroupBy(_table, _spec) {
        throw new Error('abstract');
    }

    // ── COUNT ────────────────────────────────────────────────────────

    /**
     * COUNT rows with equality conditions.
     *
     * @abstract
     * @param {string} _table - source table name
     * @param {object} _where - equality conditions (key:value)
     * @returns {Promise<number>} row count
     */
    count(_table, _where) {
        throw new Error('abstract');
    }

    /**
     * COUNT rows with raw WHERE clause.
     *
     * @abstract
     * @param {string} _table - source table name
     * @param {string} [_whereClause] - raw WHERE content (without the WHERE keyword); omit/null to COUNT all rows
     * @param {object} [_params] - named parameters for the WHERE clause
     * @returns {Promise<number>} row count
     */
    countWhere(_table, _whereClause, _params) {
        throw new Error('abstract');
    }

    // ── DDL ──────────────────────────────────────────────────────────

    /**
     * CREATE TABLE IF NOT EXISTS.
     *
     * @abstract
     * @param {string} _tableName - table name to create
     * @param {object[]} _columns - [{ name, type, constraints? }] or raw string for simple defs
     * @returns {Promise<number>} rows affected (0 for DDL)
     */
    createTable(_tableName, _columns) {
        throw new Error('abstract');
    }

    /**
     * CREATE INDEX IF NOT EXISTS.
     *
     * @abstract
     * @param {string} _indexName - index name
     * @param {string} _table - target table name
     * @param {string[]|string} _columns - column(s) to index
     * @param {boolean} [_unique] - create UNIQUE index
     * @returns {Promise<number>} rows affected (0 for DDL)
     */
    createIndex(_indexName, _table, _columns, _unique) {
        throw new Error('abstract');
    }

    /**
     * ALTER TABLE ADD COLUMN.
     *
     * @abstract
     * @param {string} _table - target table name
     * @param {string} _columnDef - full column definition (e.g. 'name TEXT NOT NULL DEFAULT ""')
     * @returns {Promise<number>} rows affected (0 for DDL)
     */
    alterTableAddColumn(_table, _columnDef) {
        throw new Error('abstract');
    }

    /**
     * ALTER TABLE DROP COLUMN.
     *
     * @abstract
     * @param {string} _table - target table name
     * @param {string} _column - column name to drop
     * @returns {Promise<number>} rows affected (0 for DDL)
     */
    alterTableDropColumn(_table, _column) {
        throw new Error('abstract');
    }

    /**
     * ALTER TABLE RENAME TO.
     *
     * @abstract
     * @param {string} _table - current table name
     * @param {string} _newName - new table name
     * @returns {Promise<number>} rows affected (0 for DDL)
     */
    alterTableRename(_table, _newName) {
        throw new Error('abstract');
    }

    /**
     * DROP TABLE IF EXISTS.
     *
     * @abstract
     * @param {string} _table - table name to drop
     * @returns {Promise<number>} rows affected (0 for DDL)
     */
    dropTable(_table) {
        throw new Error('abstract');
    }

    // ── Transaction ──────────────────────────────────────────────────

    /**
     * BEGIN transaction.
     *
     * @abstract
     * @returns {Promise<number>} rows affected (0 for transaction control)
     */
    begin() {
        throw new Error('abstract');
    }

    /**
     * COMMIT transaction.
     *
     * @abstract
     * @returns {Promise<number>} rows affected (0 for transaction control)
     */
    commit() {
        throw new Error('abstract');
    }

    /**
     * ROLLBACK transaction.
     *
     * @abstract
     * @returns {Promise<number>} rows affected (0 for transaction control)
     */
    rollback() {
        throw new Error('abstract');
    }

    // ── Maintenance ──────────────────────────────────────────────────

    /**
     * VACUUM — reclaim storage.
     *
     * @abstract
     * @engine-specific — SQLite: VACUUM; PostgreSQL: VACUUM ANALYZE; MySQL: OPTIMIZE TABLE
     * @returns {Promise<number>} rows affected (0 for maintenance)
     */
    vacuum() {
        throw new Error('abstract');
    }

    /**
     * PRAGMA optimize / ANALYZE — maintenance hint.
     *
     * @abstract
     * @engine-specific — SQLite: PRAGMA optimize; PostgreSQL: ANALYZE; MySQL: ANALYZE TABLE
     * @returns {Promise<number>} rows affected (0 for maintenance)
     */
    optimize() {
        throw new Error('abstract');
    }

    // ── Schema ───────────────────────────────────────────────────────

    /**
     * Initialize user-prefixed schema (tables for a specific account).
     *
     * @abstract
     * @param {string} _prefix - user table prefix (account hash)
     * @returns {Promise<void>}
     */
    initUserSchema(_prefix) {
        throw new Error('abstract');
    }

    /**
     * Initialize global schema (shared tables across all accounts).
     *
     * @abstract
     * @returns {Promise<void>}
     */
    initGlobalSchema() {
        throw new Error('abstract');
    }

    // ── Metadata ─────────────────────────────────────────────────────

    /**
     * List user tables matching a LIKE pattern.
     *
     * @abstract
     * @engine-specific — SQLite: sqlite_schema; MySQL: SHOW TABLES LIKE; PostgreSQL: pg_catalog.pg_tables
     * @param {string} _likePattern - SQL LIKE pattern for filtering table names
     * @returns {Promise<Array<string>>} table names
     */
    listTables(_likePattern) {
        throw new Error('abstract');
    }

    /**
     * Get column metadata for a table.
     *
     * @abstract
     * @engine-specific — SQLite: PRAGMA table_xinfo; MySQL: SHOW COLUMNS FROM; PostgreSQL: information_schema.columns
     * @param {string} _table - table name
     * @returns {Promise<Array<Array>>} rows as positional arrays (dialect-specific column metadata)
     */
    getTableColumns(_table) {
        throw new Error('abstract');
    }

    /**
     * Enumerate all user tables with their column metadata.
     *
     * Combines table enumeration with per-table column metadata.
     * Returns structured objects instead of positional arrays.
     *
     * @abstract
     * @returns {Promise<Array<{tableName: string, columns: Array<{name: string, type: string, notNull: boolean, defaultValue: *, isPK: boolean, isHidden: boolean}>}>>}
     */
    listTablesTypes() {
        throw new Error('abstract');
    }

    // ── Naming ───────────────────────────────────────────────────────

    /**
     * Resolve a user table name with prefix applied.
     *
     * @abstract
     * @engine-specific — SQLite/MySQL: `{prefix}_{name}`; PostgreSQL: `account_{prefix}.{name}` (schema isolation)
     * @param {string} _prefix - user table prefix (account hash)
     * @param {string} _name - base table name
     * @returns {string} fully-qualified table name
     */
    userTable(_prefix, _name) {
        throw new Error('abstract');
    }

    // ── SQL fragments (engine-specific syntax) ───────────────────────

    /**
     * SQL expression: convert ISO datetime column to Unix milliseconds.
     *
     * @abstract
     * @engine-specific — SQLite: `strftime('%s', col) * 1000`; PostgreSQL: `EXTRACT(EPOCH FROM col) * 1000`; MySQL: `UNIX_TIMESTAMP(col) * 1000`
     * @param {string} _column - column name containing ISO datetime
     * @returns {string} SQL expression
     */
    sqlToUnixMs(_column) {
        throw new Error('abstract');
    }

    /**
     * SQL expression: extract world ID from a location string (e.g. "wrld_xxx:12345" → "wrld_xxx").
     *
     * @abstract
     * @engine-specific — SQLite: `SUBSTR(col, 1, INSTR(col, ':') - 1)`; PostgreSQL: `SUBSTRING(col FROM 1 FOR POSITION(':' IN col) - 1)`; MySQL: `SUBSTRING_INDEX(col, ':', 1)`
     * @param {string} _column - column name containing full location string
     * @returns {string} SQL expression
     */
    sqlExtractWorldId(_column) {
        throw new Error('abstract');
    }

    /**
     * SQL expression: check if a location string has an instance ID (contains ':').
     *
     * @abstract
     * @engine-specific — SQLite: `INSTR(col, ':') > 0`; PostgreSQL: `POSITION(':' IN col) > 0`; MySQL: `LOCATE(':', col) > 0`
     * @param {string} _column - column name containing location
     * @returns {string} SQL expression (boolean)
     */
    sqlHasInstanceId(_column) {
        throw new Error('abstract');
    }

    /**
     * SQL expression: extract date part from an ISO datetime column.
     *
     * @abstract
     * @engine-specific — SQLite: `date(col)`; PostgreSQL: `col::date`; MySQL: `DATE(col)`
     * @param {string} _column - column name containing ISO datetime
     * @returns {string} SQL expression
     */
    sqlDate(_column) {
        throw new Error('abstract');
    }

    /**
     * SQL expression: compute the "enter time" from a leave event record.
     *
     * gamelog_join_leave records only leave events (created_at = leave time, time = duration).
     * Enter time = leave time - duration. This fragment produces a SQL expression
     * that computes the enter timestamp for BETWEEN comparisons.
     *
     * @abstract
     * @engine-specific — SQLite: `strftime('%Y-%m-%dT%H:%M:%SZ', created_at, '-' || (time * 1.0 / 1000) || ' seconds')`; PostgreSQL: `created_at - (time / 1000) * INTERVAL '1 second'`; MySQL: `created_at - INTERVAL (time / 1000) SECOND`
     * @param {string} _tsColumn - timestamp column name (e.g. 'created_at')
     * @param {string} _msColumn - duration-in-milliseconds column name (e.g. 'time')
     * @returns {string} SQL expression producing an ISO timestamp
     */
    sqlEnterTime(_tsColumn, _msColumn) {
        throw new Error('abstract');
    }

    // ── JS utilities ─────────────────────────────────────────────────

    /**
     * Compute ISO date string for N days ago.
     *
     * @optional
     * @param {number} _days - number of days ago
     * @returns {string} ISO 8601 datetime string
     */
    daysAgoISO(_days) {
        return new Date(Date.now() - _days * 86400000).toISOString();
    }
}

export { EngineAdapter };
