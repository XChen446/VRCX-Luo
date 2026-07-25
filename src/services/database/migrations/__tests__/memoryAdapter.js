// @ts-check
import { SQLiteAdapter } from '../../adapter/SQLiteAdapter.js';

/**
 * In-memory SQLite adapter backed by the Node built-in `node:sqlite`
 * DatabaseSync. Used only by the migration equivalence tests.
 *
 * Extends SQLiteAdapter to reuse every dialect SQL-builder (insert,
 * deleteWhere, createIndex, alterTable*, listTables, begin/commit/
 * rollback, vacuum, optimize). Only the two raw-execution methods are
 * overridden to route to DatabaseSync instead of the CefSharp SQLite.
 *
 * Production contract preserved:
 *  - execute()'s callback receives POSITIONAL arrays (row[0], row[1], ...).
 *  - executeNonQuery() returns rows-affected (changes) for parameterized
 *    DML; returns 0 for DDL / BEGIN / COMMIT / ROLLBACK / VACUUM / PRAGMA.
 *
 * node:sqlite accepts both `@x` prefixed and `x` unprefixed named-param
 * keys (verified), so the inherited SQLiteAdapter._normalizeArgs (which
 * prefixes keys with `@`) works unchanged.
 *
 * @see {https://nodejs.org/api/sqlite.html} DatabaseSync
 */
class MemorySQLiteAdapter extends SQLiteAdapter {
    /**
     * @param {import('node:sqlite').DatabaseSync} db
     */
    constructor(db) {
        super();
        this._db = db;
        this._memConnId = 0;
    }

    /** @override */
    async execute(callback, sql, args) {
        const norm = this._normalizeArgs(args);
        const stmt = this._db.prepare(sql);
        const rows = norm ? stmt.all(norm) : stmt.all();
        for (const row of rows) {
            // Object.values yields a positional array in SELECT column order,
            // matching the production SQLite.Execute row shape.
            callback(Object.values(row));
        }
    }

    /** @override */
    async executeNonQuery(sql, args) {
        const norm = this._normalizeArgs(args);
        if (norm) {
            const info = this._db.prepare(sql).run(norm);
            return info.changes;
        }
        // No params: DDL / BEGIN / COMMIT / ROLLBACK / VACUUM / PRAGMA —
        // prepare() rejects some of these (e.g. VACUUM, txn control), so
        // route them through exec() which accepts multi-statement / control
        // SQL. The runner ignores the return value for these statements.
        this._db.exec(sql);
        return 0;
    }

    // ── Transaction overrides (node:sqlite in-memory mode) ────────────
    // MemorySQLiteAdapter 测试环境没有 C# SQLite 全局实例,override
    // _doBegin/_doCommit/_doRollback 回退到 SQL 语句模式(通过
    // executeNonQuery 发 BEGIN/COMMIT/ROLLBACK),返回递增 connId
    // 占位(无 C# sliding Timer,但 withTransaction 的栈管理仍生效)。

    /** @override @protected */
    async _doBegin() {
        await this.executeNonQuery('BEGIN');
        return ++this._memConnId;
    }

    /** @override @protected */
    async _doCommit(_connId) {
        await this.executeNonQuery('COMMIT');
    }

    /** @override @protected */
    async _doRollback(_connId) {
        try {
            await this.executeNonQuery('ROLLBACK');
        } catch (e) {
            if (!String(e?.message || '').match(/no transaction/i)) {
                throw e;
            }
        }
    }

    /** @override @protected — no-op(无 C# sliding Timer) */
    async _doKeepAlive(_connId) {
        // MemorySQLiteAdapter 测试环境没有 C# Timer,keepAlive 无需操作
    }
}

export { MemorySQLiteAdapter };
