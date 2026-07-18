import { SQLiteAdapter } from './SQLiteAdapter.js';
import { MySQLAdapter } from './MySQLAdapter.js';

/**
 * Current adapter singleton.
 *
 * Auto-initialized to SQLiteAdapter for backward compatibility (tests,
 * any code path that doesn't call initAdapter explicitly). Call
 * initAdapter(mode) after VRCXStorage is bound to switch engines at
 * runtime based on VRCX_Database.mode.
 *
 * ESM live binding: reassigning this variable is visible to all
 * importers — they get the updated adapter without re-importing.
 */
/** @type {import('./EngineAdapter.js').EngineAdapter} */
let adapter = new SQLiteAdapter();

/**
 * Initialize (or reinitialize) the adapter singleton for the given engine.
 *
 * Called from interopApi.js after VRCXStorage is bound, passing the
 * VRCX_Database.mode value. Safe to call multiple times — only acts
 * if the engine changes.
 *
 * @param {string} [mode='sqlite'] - database engine: 'sqlite' | 'mysql'
 * @returns {object} the active adapter instance
 */
function initAdapter(mode = 'sqlite') {
    switch (mode) {
        case 'sqlite':
            if (!(adapter instanceof SQLiteAdapter)) {
                adapter = new SQLiteAdapter();
            }
            break;
        case 'mysql':
        case 'mariadb':
            if (!(adapter instanceof MySQLAdapter)) {
                adapter = new MySQLAdapter();
            }
            break;
        default:
            throw new Error(`Unsupported database engine: ${mode}`);
    }
    return adapter;
}

/**
 * Create a new adapter instance for a given connection URI.
 *
 * @param {object} config
 * @param {string} config.connection - 连接 URI，如 sqlite:///C:/path.db 或 mysql://host/db
 * @param {...object} [config.params] - 额外连接参数（覆盖默认）
 * @returns {import('./EngineAdapter.js').EngineAdapter}
 */
function createAdapter(config) {
    const { connection } = config;
    if (!connection || typeof connection !== 'string') {
        throw new Error('createAdapter requires a connection URI (e.g. sqlite:///path)');
    }
    const scheme = connection.split('://')[0];
    if (scheme === 'sqlite') {
        const rest = connection.slice('sqlite://'.length);
        if (!rest || /^\/+$/.test(rest) || !rest.trim()) {
            throw new Error('createAdapter: connection URI has empty path');
        }
        return new SQLiteAdapter(config);
    }
    if (scheme === 'mysql') {
        return new MySQLAdapter(config);
    }
    throw new Error(`Unsupported connection scheme: ${scheme} (expected sqlite:// or mysql://)`);
}

export { adapter, SQLiteAdapter, MySQLAdapter, initAdapter, createAdapter };
