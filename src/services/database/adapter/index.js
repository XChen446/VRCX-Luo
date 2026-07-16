import { SQLiteAdapter } from './SQLiteAdapter.js';

const ENGINE = 'sqlite';

var adapter;
if (ENGINE === 'sqlite') {
    adapter = new SQLiteAdapter();
} else {
    throw new Error(`Unsupported database engine: ${ENGINE}`);
}

/**
 * Create a new adapter instance for a given connection URI.
 *
 * @param {object} config
 * @param {string} config.connection - 连接 URI，如 sqlite:///C:/path.db
 * @param {...object} [config.params] - 额外连接参数（覆盖默认）
 * @returns {SQLiteAdapter}
 */
function createAdapter(config) {
    const { connection } = config;
    if (!connection || typeof connection !== 'string') {
        throw new Error('createAdapter requires a connection URI (e.g. sqlite:///path)');
    }
    const scheme = connection.split('://')[0];
    if (scheme === 'sqlite') {
        return new SQLiteAdapter(config);
    }
    throw new Error(`Unsupported connection scheme: ${scheme} (expected sqlite://)`);
}

export { adapter, SQLiteAdapter, createAdapter };
