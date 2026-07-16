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
}

export { MemorySQLiteAdapter };
