import { describe, it, expect, vi, beforeEach } from 'vitest';

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

// ─────────────────────────────────────────────────────────────────────────
// Bug A: MySQL 保留字列名(key)转义
// MySQL 是唯一把 `KEY` 当保留字的引擎。DDL 已用反引号,但 SQL 构建器
// 此前裸拼列名 → `INSERT IGNORE INTO cookies (key, value)` 语法错误。
// 以下用例验证 11 个 SQL 构建器方法对 Object.keys 派生的列名做
// `quoteIdent` 转义,且 params 键保持裸名(永不转义)。
// ─────────────────────────────────────────────────────────────────────────

describe('SQL 构建器标识符转义', () => {
    /** @type {MySQLAdapter} */
    let adapter;

    beforeEach(() => {
        adapter = new MySQLAdapter();
        adapter.executeNonQuery = vi.fn().mockResolvedValue(0);
        adapter.execute = vi.fn().mockImplementation(async (cb) => cb(['v']));
    });

    describe('quoteIdent', () => {
        it('包裹反引号', () => {
            expect(adapter.quoteIdent('key')).toBe('`key`');
        });

        it('内部反引号按 MySQL 规则转义为双反引号', () => {
            expect(adapter.quoteIdent('a`b')).toBe('`a``b`');
        });

        it('非字符串输入经 String() 转换', () => {
            expect(adapter.quoteIdent(42)).toBe('`42`');
        });
    });

    describe('insert', () => {
        it('列名转义为反引号,params 键保持裸名', async () => {
            await adapter.insert('cookies', { key: 'k', value: 'v' }, 'ignore');
            expect(adapter.executeNonQuery.mock.calls[0][0]).toBe(
                'INSERT IGNORE INTO cookies (`key`, `value`) VALUES (@key, @value)'
            );
            expect(adapter.executeNonQuery.mock.calls[0][1]).toEqual({
                key: 'k',
                value: 'v'
            });
        });
    });

    describe('bulkInsert', () => {
        it('列名转义,行参数键保持裸名(带行号后缀)', async () => {
            await adapter.bulkInsert(
                'cookies',
                [
                    { key: 'k1', value: 'v1' },
                    { key: 'k2', value: null }
                ],
                'ignore'
            );
            expect(adapter.executeNonQuery.mock.calls[0][0]).toBe(
                'INSERT IGNORE INTO cookies (`key`, `value`) VALUES (@key_0, @value_0), (@key_1, @value_1)'
            );
            expect(adapter.executeNonQuery.mock.calls[0][1]).toEqual({
                key_0: 'k1',
                value_0: 'v1',
                key_1: 'k2',
                value_1: null
            });
        });
    });

    describe('update / updateWhere / delete', () => {
        it('update: SET 与 WHERE 的列名都转义,params 键带前缀且裸名', async () => {
            await adapter.update('configs', { value: 'v' }, { key: 'k' });
            expect(adapter.executeNonQuery.mock.calls[0][0]).toBe(
                'UPDATE configs SET `value` = @set_value WHERE `key` = @where_key'
            );
            expect(adapter.executeNonQuery.mock.calls[0][1]).toEqual({
                set_value: 'v',
                where_key: 'k'
            });
        });

        it('updateWhere: SET 列名转义,whereClause 裸片段契约原样', async () => {
            await adapter.updateWhere('configs', { value: 'v' }, '`key` = @k', {
                k: 'k'
            });
            expect(adapter.executeNonQuery.mock.calls[0][0]).toBe(
                'UPDATE configs SET `value` = @set_value WHERE `key` = @k'
            );
            expect(adapter.executeNonQuery.mock.calls[0][1]).toEqual({
                k: 'k',
                set_value: 'v'
            });
        });

        it('delete: WHERE 列名转义,params 键裸名', async () => {
            await adapter.delete('configs', { key: 'k' });
            expect(adapter.executeNonQuery.mock.calls[0][0]).toBe(
                'DELETE FROM configs WHERE `key` = @key'
            );
            expect(adapter.executeNonQuery.mock.calls[0][1]).toEqual({
                key: 'k'
            });
        });
    });

    describe('selectOne / select', () => {
        it('selectOne: WHERE 与数组列名转义', async () => {
            await adapter.selectOne('cookies', ['key', 'value'], { key: 'k' });
            expect(adapter.execute.mock.calls[0][1]).toBe(
                'SELECT `key`, `value` FROM cookies WHERE `key` = @key LIMIT 1'
            );
            expect(adapter.execute.mock.calls[0][2]).toEqual({ key: 'k' });
        });

        it('select: WHERE 转义,数组列名转义', async () => {
            await adapter.select('cookies', ['key', 'value'], { key: 'k' });
            expect(adapter.execute.mock.calls[0][1]).toBe(
                'SELECT `key`, `value` FROM cookies WHERE `key` = @key'
            );
        });

        it('select: 字符串 colStr 分支原样保留(调用方自行构造)', async () => {
            await adapter.select('cookies', 'key, value', { key: 'k' });
            expect(adapter.execute.mock.calls[0][1]).toBe(
                'SELECT key, value FROM cookies WHERE `key` = @key'
            );
        });

        it('select: 无 where 时不加 WHERE 子句', async () => {
            await adapter.select('cookies', ['key']);
            expect(adapter.execute.mock.calls[0][1]).toBe(
                'SELECT `key` FROM cookies'
            );
        });
    });

    describe('count', () => {
        it('WHERE 列名转义', async () => {
            await adapter.count('cookies', { key: 'k' });
            expect(adapter.execute.mock.calls[0][1]).toBe(
                'SELECT COUNT(*) FROM cookies WHERE `key` = @key'
            );
            expect(adapter.execute.mock.calls[0][2]).toEqual({ key: 'k' });
        });
    });

    describe('increment', () => {
        it('SET 目标列与 WHERE 列名都转义', async () => {
            await adapter.increment('configs', 'value', 1, { key: 'k' });
            expect(adapter.executeNonQuery.mock.calls[0][0]).toBe(
                'UPDATE configs SET `value` = `value` + @amount WHERE `key` = @where_key'
            );
            expect(adapter.executeNonQuery.mock.calls[0][1]).toEqual({
                amount: 1,
                where_key: 'k'
            });
        });
    });

    describe('upsertPartial', () => {
        it('INSERT 列与 ON DUPLICATE KEY UPDATE 列名都转义', async () => {
            await adapter.upsertPartial(
                'configs',
                { key: 'k', value: 'v' },
                { value: 'v2' }
            );
            expect(adapter.executeNonQuery.mock.calls[0][0]).toBe(
                'INSERT INTO configs (`key`, `value`) VALUES (@key, @value) ' +
                    'ON DUPLICATE KEY UPDATE `value` = @up_value'
            );
            expect(adapter.executeNonQuery.mock.calls[0][1]).toEqual({
                key: 'k',
                value: 'v',
                up_value: 'v2'
            });
        });
    });

    describe('createTable', () => {
        it('结构化列定义转义(含 key 保留字)', async () => {
            await adapter.createTable('configs', [
                { name: 'key', type: 'TEXT', constraints: 'PRIMARY KEY' },
                { name: 'value', type: 'TEXT' }
            ]);
            // TEXT PK → VARCHAR(255)(MySQL 不允许 TEXT 作 PK)。
            expect(adapter.executeNonQuery.mock.calls[0][0]).toBe(
                'CREATE TABLE IF NOT EXISTS configs (`key` VARCHAR(255) PRIMARY KEY, `value` TEXT)'
            );
        });

        it('raw-string 列定义分支原样保留(裸片段契约)', async () => {
            await adapter.createTable('t', ['a INTEGER PRIMARY KEY', 'v TEXT']);
            expect(adapter.executeNonQuery.mock.calls[0][0]).toBe(
                'CREATE TABLE IF NOT EXISTS t (a INTEGER PRIMARY KEY, v TEXT)'
            );
        });
    });
});
