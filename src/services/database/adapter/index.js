import { SQLiteAdapter } from './SQLiteAdapter.js';

const ENGINE = 'sqlite';

var adapter;
if (ENGINE === 'sqlite') {
    adapter = new SQLiteAdapter();
} else {
    throw new Error(`Unsupported database engine: ${ENGINE}`);
}

export { adapter, SQLiteAdapter };
