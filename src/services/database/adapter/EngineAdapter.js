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
 *
 * 2026-07-25 破例:事务接口 begin()/commit()/rollback() 改名为
 * beginTransaction()/commit(connId)/rollback(connId),并新增
 * withTransaction(fn) 默认实现 + _txStack 实例字段。原因是
 * PostgreSQL.cs 的池化设计导致跨调用事务断裂,修复需要在 JS
 * 层维护事务上下文栈,以让 withTransaction 体内的所有
 * execute/executeNonQuery/bulkInsert 等自动走 pinned 连接。
 * 22 个数据方法签名不变(栈顶在 execute/executeNonQuery 内部读)。
 *
 * 2026-07-25 补充:beginTransaction/commit/rollback 三个低级方法
 * 标为 @private —— 生产代码应使用 withTransaction(fn),手动调用
 * 这三个方法只在测试中验证栈契约时出现。@private 触发 IDE 高亮
 * 但不触发 lint 失败(eslint-plugin-jsdoc 未在 eslint.config.mjs
 * 启用),WebStorm 仍会对外部调用显示警告,达到引导效果。
 * 详见 docs/TRANSACTION_DESIGN.md。
 *
 * The `engineType` getter below is metadata, not part of the 42+3
 * method interface — it carries no SQL semantics and exists solely so
 * the migration runner can detect the active engine without importing
 * adapter classes (added 2026-07-19 to align with the MySQL branch).
 */

class EngineAdapter {
    /** @type {string|null} */
    _prefixOverride = null;

    /**
     * 事务 connId 栈,withTransaction 自动 push/pop。
     * execute/executeNonQuery 实现里读 `this._txStack.at(-1)` 决定走
     * pinned 连接(事务中)还是默认池(事务外)。
     * 实例属性,每个 adapter 实例独立,srcAdapter/dstAdapter 天然隔离。
     * @type {number[]}
     * @protected
     */
    _txStack = [];

    constructor() {
        if (new.target === EngineAdapter) {
            throw new TypeError(
                'EngineAdapter is abstract — instantiate a subclass'
            );
        }
    }

    // ── Optional overrides ──────────────────────────────────────────

    /**
     * Engine type identifier for runtime engine detection.
     *
     * Subclasses override this to return their engine name
     * (e.g. 'sqlite', 'mysql', 'postgresql'). Used by the migration
     * runner's `getDatabaseEngine()` without importing adapter classes —
     * the migration runner reads `adapter.engineType` off the singleton
     * instead of re-reading `VRCXStorage`, so engine detection stays in
     * sync with whichever adapter `initAdapter(mode)` actually
     * constructed.
     *
     * Default `'unknown'` ensures that a base-class-only instance (which
     * cannot exist in production — `EngineAdapter` is abstract) or an
     * adapter that forgot the override surfaces loudly in migration
     * compatibility checks rather than silently masquerading as sqlite.
     *
     * @type {string}
     */
    get engineType() {
        return 'unknown';
    }

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
     * 引擎级事务开启钩子。子类实现:
     * - PgSQLAdapter:调 C# `PostgreSQL.BeginTransaction()` 返回真实 connId
     * - SQLiteAdapter/MySQLAdapter:发 `BEGIN` SQL,返回 0(单连接无需 pin)
     *
     * @abstract
     * @returns {Promise<number>} connId(0 表示单连接引擎无需 pin)
     * @protected
     */
    _doBegin() {
        throw new Error('abstract');
    }

    /**
     * 引擎级事务提交钩子。子类实现:
     * - PgSQLAdapter:调 C# `PostgreSQL.CommitTransaction(connId)`
     * - SQLiteAdapter/MySQLAdapter:发 `COMMIT` SQL(connId 忽略)
     *
     * @abstract
     * @param {number} _connId
     * @returns {Promise<void>}
     * @protected
     */
    _doCommit(_connId) {
        throw new Error('abstract');
    }

    /**
     * 引擎级事务回滚钩子。子类实现:
     * - PgSQLAdapter:调 C# `PostgreSQL.RollbackTransaction(connId)`
     * - SQLiteAdapter/MySQLAdapter:发 `ROLLBACK` SQL(connId 忽略)
     *
     * @abstract
     * @param {number} _connId
     * @returns {Promise<void>}
     * @protected
     */
    _doRollback(_connId) {
        throw new Error('abstract');
    }

    /**
     * 引擎级事务心跳钩子。子类实现:
     * - PgSQLAdapter:调 C# `PostgreSQL.KeepAliveTransaction(connId)`
     * - SQLiteAdapter/MySQLAdapter:同上,调对应 C# 方法
     * - MemorySQLiteAdapter:返回 true(无 C# Timer,事务永不过期)
     *
     * 返回 `true` 表示 timer 已重置(续命成功);`false` 表示 connId
     * 已超时回滚(C# 侧 TryGetValue 失败)。调用方可在 await 用户
     * 交互后通过返回值判断事务是否仍然存活,决定是否提前退出。
     *
     * @abstract
     * @param {number} _connId
     * @returns {Promise<boolean>} true=续命成功,false=已超时回滚
     * @protected
     */
    _doKeepAlive(_connId) {
        throw new Error('abstract');
    }

    /**
     * 开启一个事务,返回 connId 并 push 到 `_txStack`。
     * execute/executeNonQuery 读栈顶决定走 pinned 连接还是默认池。
     * 必须配对调用 commit(connId) 或 rollback(connId) 以 pop 栈。
     *
     * 不支持嵌套:栈非空时抛错(与 SQLite 现有 nested begin throws 一致)。
     * 生产代码请使用 withTransaction(fn) 自动管理栈,而非手动调用
     * 本方法——手动调用仅在测试中用于验证栈契约。
     *
     * @private
     * @returns {Promise<number>} connId
     */
    async beginTransaction() {
        if (this._txStack.length > 0) {
            throw new Error(
                'beginTransaction: 不支持嵌套事务(当前已在事务中)'
            );
        }
        const connId = await this._doBegin();
        this._txStack.push(connId);
        return connId;
    }

    /**
     * 提交当前事务并 pop `_txStack`。
     *
     * 仅由 withTransaction(fn) 内部调用;手动调用仅在测试中用于验证
     * 栈契约。生产代码请使用 withTransaction(fn)。
     *
     * @private
     * @param {number} connId - beginTransaction 返回的 connId
     * @returns {Promise<void>}
     */
    async commit(connId) {
        try {
            await this._doCommit(connId);
        } finally {
            this._txStack.pop();
        }
    }

    /**
     * 回滚当前事务并 pop `_txStack`。已超时/不存在的 connId 静默
     * no-op,不抛错(withTransaction 的 catch 可无条件调用)。
     *
     * 仅由 withTransaction(fn) 内部调用;手动调用仅在测试中用于验证
     * 栈契约。生产代码请使用 withTransaction(fn)。
     *
     * @private
     * @param {number} connId - beginTransaction 返回的 connId
     * @returns {Promise<void>}
     */
    async rollback(connId) {
        try {
            await this._doRollback(connId);
        } finally {
            this._txStack.pop();
        }
    }

    /**
     * 重置当前事务的 sliding idle timer,不执行任何 SQL。
     *
     * 用于 withTransaction 体内 await 长时间非 DB 操作(如用户确认
     * 对话框、输入框等待)时,防止 60s idle 超时自动回滚。调用后
     * Timer 重新从 TX_IDLE_MS 开始计时。
     *
     * @returns {Promise<boolean>} `true` 表示续命成功(事务仍存活,
     *   timer 已重置);`false` 表示事务已超时回滚或当前不在事务中
     *   (调用方应提前退出事务体,避免后续 SQL 抛 "connId 已超时
     *   回滚" 的延迟错误)。注意:即使返回 `false`,withTransaction
     *   的 catch 仍会在后续 SQL 调用失败时 rollback + 重新抛出,
     *   keepAlive 返回 `false` 只是让调用方有机会提前干净退出。
     *
     * 推荐用法 — 在每段可能超过 60s 的非 DB await 前调用,
     * 并检查返回值:
     * ```
     * await adapter.withTransaction(async () => {
     *     await adapter.insert(...);
     *     if (!await adapter.keepAlive()) return; // 事务已死,提前退出
     *     const ok = await dialog.confirm(...);    // 用户慢慢想
     *     if (!ok) throw new Error('用户取消');
     *     if (!await adapter.keepAlive()) return; // 事务已死,提前退出
     *     await adapter.update(...);
     * });
     * ```
     *
     * ⚠️ 注意:keepAlive 是逃生舱,不是鼓励在事务内做长交互。
     * 事务应尽可能短——长时间持有事务锁会阻塞其他操作。能拆到
     * 事务外确认的,优先拆出去(乐观锁模式)。
     */
    async keepAlive() {
        const connId = this._txStack.at(-1);
        if (connId === undefined) return false;
        try {
            return await this._doKeepAlive(connId);
        } catch {
            // C# 桥异常或 binding 缺失,视为事务已死
            return false;
        }
    }

    /**
     * 在事务中执行 `fn`。自动管理 connId 的获取/提交/回滚 + `_txStack`
     * 的 push/pop。业务代码在 `fn` 内部调用的 execute/insert/bulkInsert
     * 等方法会自动走 pinned 连接(读栈顶 connId),无需显式传 connId。
     *
     * - 成功:commit + pop 栈
     * - 抛错:rollback + pop 栈 + 重新抛出
     * - 嵌套:栈非空时抛错(不支持嵌套事务)
     *
     * ⚠️ 事务内禁止 await 用户交互(对话框、输入框等)。C# 侧有
     * 60 秒 idle 超时自动回滚,用户不在电脑前会导致事务被静默
     * 回滚,后续 SQL 抛 "connId 已超时回滚" 错误。如必须在事务
     * 内等待用户,需在每段可能超时的 await 前调用 `keepAlive()`
     * 续命;但更推荐将用户交互拆到事务外(乐观锁模式):
     * ```
     * // ✅ 推荐:事务外确认
     * const data = await adapter.select(...);
     * const ok = await dialog.confirm(data);
     * if (!ok) return;
     * await adapter.withTransaction(async () => {
     *     await adapter.update(...);
     * });
     * ```
     *
     * @optional
     * @template T
     * @param {() => Promise<T>} fn
     * @returns {Promise<T>}
     */
    async withTransaction(fn) {
        if (this._txStack.length > 0) {
            throw new Error(
                'withTransaction: 不支持嵌套事务(当前已在事务中)'
            );
        }
        const connId = await this.beginTransaction();
        try {
            const result = await fn();
            await this.commit(connId);
            return result;
        } catch (err) {
            try {
                await this.rollback(connId);
            } catch (rollbackErr) {
                // 不掩盖原始业务错误,但记录 rollback 失败供诊断
                // (连接断、SQLite 损坏等,否则完全无日志)
                console.error(
                    '[adapter] withTransaction rollback 失败:',
                    rollbackErr
                );
            }
            throw err;
        }
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
