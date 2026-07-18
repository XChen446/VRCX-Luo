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
}

export { MySQLAdapter };
