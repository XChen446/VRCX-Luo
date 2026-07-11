/**
 * Abstract base class for database engine adapters.
 *
 * Defines the interface that every engine adapter must implement.
 * Subclasses must implement all `@abstract` methods;
 * `daysAgoISO()` has a default JS-based implementation and may be overridden.
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

    /**
     * Execute an async function with a temporary prefix override
     * for userTable(). Nested calls are supported.
     * @param {string} prefix
     * @param {() => Promise<T>} fn
     * @returns {Promise<T>}
     * @template T
     */
    async withPrefix(prefix, fn) {
        const prev = this._prefixOverride;
        this._prefixOverride = prefix;
        try {
            return await fn();
        } finally {
            this._prefixOverride = prev;
        }
    }

    // ── Raw execution ────────────────────────────────────────────────

    /** @abstract */
    execute(_callback, _sql, _args) {
        throw new Error('abstract');
    }

    /** @abstract */
    executeNonQuery(_sql, _args) {
        throw new Error('abstract');
    }

    /** @abstract */
    executeReadOnly(_path, _sql, _args) {
        throw new Error('abstract');
    }

    // ── CRUD ─────────────────────────────────────────────────────────

    /** @abstract */
    insert(_table, _data, _conflict) {
        throw new Error('abstract');
    }

    /** @abstract */
    bulkInsert(_table, _rows, _conflict) {
        throw new Error('abstract');
    }

    /** @abstract */
    update(_table, _data, _where) {
        throw new Error('abstract');
    }

    /** @abstract */
    delete(_table, _where) {
        throw new Error('abstract');
    }

    /** @abstract */
    increment(_table, _column, _amount, _where) {
        throw new Error('abstract');
    }

    /** @abstract */
    upsertPartial(_table, _insertData, _updateData, _conflictColumn) {
        throw new Error('abstract');
    }

    // ── SELECT ───────────────────────────────────────────────────────

    /** @abstract */
    selectOne(_table, _columns, _where) {
        throw new Error('abstract');
    }

    /** @abstract */
    select(_table, _columns, _where, _options) {
        throw new Error('abstract');
    }

    /** @abstract */
    selectWhere(_table, _columns, _whereClause, _params, _options) {
        throw new Error('abstract');
    }

    /** @abstract */
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

    // ── COUNT ────────────────────────────────────────────────────────

    /** @abstract */
    count(_table, _where) {
        throw new Error('abstract');
    }

    /** @abstract */
    countWhere(_table, _whereClause, _params) {
        throw new Error('abstract');
    }

    // ── DDL ──────────────────────────────────────────────────────────

    /** @abstract */
    createTable(_tableName, _columns) {
        throw new Error('abstract');
    }

    /** @abstract */
    createIndex(_indexName, _table, _columns, _unique) {
        throw new Error('abstract');
    }

    /** @abstract */
    alterTableAddColumn(_table, _columnDef) {
        throw new Error('abstract');
    }

    /** @abstract */
    alterTableDropColumn(_table, _column) {
        throw new Error('abstract');
    }

    /** @abstract */
    alterTableRename(_table, _newName) {
        throw new Error('abstract');
    }

    // ── Transaction ──────────────────────────────────────────────────

    /** @abstract */
    begin() {
        throw new Error('abstract');
    }

    /** @abstract */
    commit() {
        throw new Error('abstract');
    }

    /** @abstract */
    rollback() {
        throw new Error('abstract');
    }

    // ── Maintenance ──────────────────────────────────────────────────

    /** @abstract */
    vacuum() {
        throw new Error('abstract');
    }

    /** @abstract */
    optimize() {
        throw new Error('abstract');
    }

    // ── Schema ───────────────────────────────────────────────────────

    /** @abstract */
    initUserSchema(_prefix) {
        throw new Error('abstract');
    }

    /** @abstract */
    initGlobalSchema() {
        throw new Error('abstract');
    }

    // ── Metadata ─────────────────────────────────────────────────────

    /** @abstract */
    listTables(_likePattern) {
        throw new Error('abstract');
    }

    /** @abstract */
    getTableColumns(_table, _path) {
        throw new Error('abstract');
    }

    // ── Naming ───────────────────────────────────────────────────────

    /** @abstract */
    userTable(_prefix, _name) {
        throw new Error('abstract');
    }

    // ── SQL fragments (engine-specific syntax) ───────────────────────

    /** @abstract */
    sqlToUnixMs(_column) {
        throw new Error('abstract');
    }

    /** @abstract */
    sqlExtractWorldId(_column) {
        throw new Error('abstract');
    }

    /** @abstract */
    sqlHasInstanceId(_column) {
        throw new Error('abstract');
    }

    /** @abstract */
    sqlDate(_column) {
        throw new Error('abstract');
    }

    /** @abstract */
    sqlEnterTime(_tsColumn, _msColumn) {
        throw new Error('abstract');
    }

    // ── JS utilities ─────────────────────────────────────────────────

    /**
     * Compute ISO date string for N days ago.
     * Default implementation uses JS Date.now(). May be overridden.
     */
    daysAgoISO(_days) {
        return new Date(Date.now() - _days * 86400000).toISOString();
    }
}

export { EngineAdapter };
