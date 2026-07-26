import { describe, it, expect } from 'vitest';

import { MySQLAdapter } from './MySQLAdapter.js';

/**
 * MySQLAdapter pure unit tests (no MySQL container required).
 *
 * Mirrors `PgSQLAdapter.unit.test.js` for the subset of behaviour that
 * has no external dependency. Runs in the default vitest environment
 * (jsdom + `vitest.setup.js` noopAsync stubs).
 *
 * What's tested here (no MySQL backend required):
 *   - `_buildConnectionString` URI parsing (mysql://user:pass@host:port/db)
 *   - `engineType` getter
 *   - `isConnected` defensive stub behaviour + absent-binding guard
 *
 * What's NOT tested here (needs a real MySQL backend):
 *   - `execute` / `executeNonQuery` actually hitting MySqlConnector
 *   - `initUserSchema` / `initGlobalSchema` DDL round-trips
 *   - `isConnected` real `SELECT 1` round-trip (covered by
 *     `MySQLAdapter.mysql.test.js` when `MYSQL_TEST_HOST` is set)
 *
 * TODO: 事务单元测试覆盖空白。`beginTransaction`/`commit`/`rollback`
 *   (现已标 @private) 及 `withTransaction` 的 MySQL 引擎级语义
 *   (pooled 连接 + `BEGIN/COMMIT/ROLLBACK` SQL 往返、事务内读未
 *   commit 写)目前仅由 `transaction.test.js` 用 MemorySQLiteAdapter
 *   做引擎无关的栈契约验证。MySQL 特定的事务行为需真实 MySQL
 *   后端 + C# 桥,无法在纯 JS unit test 中覆盖,待 follow-up 补
 *   集成测试。
 */
describe('MySQLAdapter unit (no container)', () => {
    describe('engineType', () => {
        it('returns "mysql"', () => {
            const adapter = new MySQLAdapter();
            expect(adapter.engineType).toBe('mysql');
        });
    });

    describe('_buildConnectionString', () => {
        it('parses a full mysql:// URI with credentials', () => {
            const adapter = new MySQLAdapter({
                connection: 'mysql://root:pass@127.0.0.1:3306/vrcx_test'
            });
            expect(adapter.connectionString).toContain('Server=127.0.0.1');
            expect(adapter.connectionString).toContain('Port=3306');
            expect(adapter.connectionString).toContain('Database=vrcx_test');
            expect(adapter.connectionString).toContain('User ID=root');
            expect(adapter.connectionString).toContain('Password=pass');
        });

        it('parses a mysql:// URI without explicit port (defaults to 3306)', () => {
            const adapter = new MySQLAdapter({
                connection: 'mysql://root:pass@127.0.0.1/vrcx_test'
            });
            expect(adapter.connectionString).toContain('Server=127.0.0.1');
            expect(adapter.connectionString).toContain('Port=3306');
            expect(adapter.connectionString).toContain('Database=vrcx_test');
        });

        it('returns null connectionString when no connection arg provided', () => {
            const adapter = new MySQLAdapter();
            expect(adapter.connectionString).toBeNull();
        });
    });

    describe('isConnected', () => {
        it('resolves to a boolean and does not throw under the vitest noopAsync stub', async () => {
            // Under vitest.setup.js, MySQL is a Proxy returning noopAsync
            // for any property access, so MySQL.Ping is noopAsync
            // → returns Promise.resolve(''). `await` it → '' → Boolean('') === false.
            // The real C# binding returns a synchronous bool (CefSharp) or a
            // Promise<boolean> (Electron); either way `await` yields a boolean.
            const adapter = new MySQLAdapter();
            const result = await adapter.isConnected();
            expect(typeof result).toBe('boolean');
            await expect(adapter.isConnected()).resolves.toBeDefined();
        });

        it('resolves false when the MySQL binding is absent', async () => {
            const adapter = new MySQLAdapter();
            const saved = globalThis.MySQL;
            // @ts-expect-error — deliberately delete the global for this test
            delete globalThis.MySQL;
            try {
                await expect(adapter.isConnected()).resolves.toBe(false);
            } finally {
                globalThis.MySQL = saved;
            }
        });
    });
});