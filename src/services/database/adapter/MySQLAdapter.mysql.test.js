import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import net from 'node:net';
import { MySQLAdapter } from './MySQLAdapter.js';

/**
 * Phase 11.2 slice (task 8.10): MySQLAdapter integration smoke test.
 *
 * Gated on `MYSQL_TEST_HOST` so it stays inert under the default `npm test`
 * (SQLite mode) suite. The CI workflow `.github/workflows/ci.yaml`
 * `test_mysql` job sets the env var and runs `*.mysql.test.js` against a
 * MySQL 8.0 / 8.4 instance provisioned by
 * `shogo82148/actions-setup-mysql@076e636c # v1.52.1`.
 *
 * Run locally:
 *   docker run -d --name vrcx-mysql -e MYSQL_ROOT_PASSWORD=root \
 *     -e MYSQL_DATABASE=vrcx_test -p 3306:3306 mysql:8.0
 *   MYSQL_TEST_HOST=127.0.0.1 npm test -- --run MySQLAdapter.mysql
 *
 * No `mysql2` driver dependency: uses Node's built-in `node:net` to probe
 * TCP reachability of the MySQL instance, aligned with the PgSQLAdapter
 * integration smoke test pattern. The adapter's execute path routes
 * through the C# MySQL backend binding (`globalThis.MySQL`), which is
 * not available in the Linux CI runner, so schema/CRUD assertions are
 * deferred to a follow-up slice that can provision the .NET runtime.
 * The construct-time assertions below exercise the pure synchronous
 * `_buildConnectionString` path, which has no external dependency.
 *
 * TODO: 事务单元测试覆盖空白。`beginTransaction`/`commit`/`rollback`
 *   (现已标 @private) 及 `withTransaction` 的 MySQL 引擎级语义
 *   (pooled 连接 + `BEGIN/COMMIT/ROLLBACK` SQL 往返、事务内读未
 *   commit 写)目前仅由 `transaction.test.js` 用 MemorySQLiteAdapter
 *   做引擎无关的栈契约验证。MySQL 特定的事务行为需真实 MySQL
 *   后端 + C# 桥,无法在纯 JS unit test 中覆盖,待 follow-up 补
 *   集成测试。
 */
const mysqlHost = process.env.MYSQL_TEST_HOST;
const describeIntegration = mysqlHost ? describe : describe.skip;

describeIntegration(
    'MySQLAdapter integration (requires MySQL container)',
    () => {
        let tcpReachable = false;

        beforeAll(async () => {
            const port = Number(process.env.MYSQL_TEST_PORT || 3306);
            tcpReachable = await new Promise((resolve) => {
                const socket = new net.Socket();
                socket.setTimeout(5000);
                socket.once('connect', () => {
                    socket.destroy();
                    resolve(true);
                });
                socket.once('error', () => resolve(false));
                socket.once('timeout', () => {
                    socket.destroy();
                    resolve(false);
                });
                socket.connect(port, mysqlHost);
            });
        });

        afterAll(() => {
            // No persistent state: schema/CRUD assertions are deferred to a
            // follow-up slice that can provision the .NET runtime
            // (globalThis.MySQL binding) in the CI runner. The construct-time
            // assertions here leave no tables or connections behind.
        });

        it('should reach MySQL container on configured port', () => {
            expect(tcpReachable).toBe(true);
        });

        it('should construct MySQLAdapter with a mysql:// connection URI', () => {
            const port = process.env.MYSQL_TEST_PORT || 3306;
            const adapter = new MySQLAdapter({
                connection: `mysql://root:root@${mysqlHost}:${port}/vrcx_test`
            });
            expect(adapter.engineType).toBe('mysql');
            expect(adapter.connectionString).toContain(`Server=${mysqlHost}`);
            expect(adapter.connectionString).toContain(`Port=${port}`);
            expect(adapter.connectionString).toContain('Database=vrcx_test');
            expect(adapter.connectionString).toContain('User ID=root');
            expect(adapter.connectionString).toContain('Password=root');
        });

        it('getPoolStats returns driver truth values after pool warm-up (MySQL reflection verifier)', async () => {
            // 池统计真值化(设计文档 pool-stats-design):MySQL.cs GetPoolStats
            // 反射 MySqlConnector 2.6.1 内部结构(m_sessions / m_sessionSemaphore)
            // 拿驱动真值。真值下 idleInPool/totalOpen 是实际物理连接数(远小于 50);
            // 反射失败(字段改名/驱动升级)或回退估算时是配额假象(99/100) → 变红,
            // 此用例即"验证器",本地带 C# 桥环境(桌面运行 / dotnet + bridge 测试
            // 环境)下每次真值化改动需保持绿。
            // 需要真实 C# 桥:vitest 的 noopAsync stub 下 MySQL.Ping() 返回 ''(falsy),
            // 直接跳过(CI test_mysql job 无 .NET 桥,与文件头注释的桥限制一致)。
            const bridgeAlive = Boolean(await globalThis.MySQL.Ping());
            if (!bridgeAlive) return;

            // 无 connection 参数 → 走单例 _dataSource 池路径(非 ExecuteJsonOnConnection),
            // 两次查询确保池已建物理连接(min=1 常驻)。
            const adapter = new MySQLAdapter();
            await adapter.execute(() => {}, 'SELECT 1');
            await adapter.execute(() => {}, 'SELECT 1');

            const stats = await adapter.getPoolStats();
            expect(stats.max).toBeGreaterThanOrEqual(50);
            expect(stats.idleInPool).toBeGreaterThanOrEqual(0);
            expect(stats.idleInPool).toBeLessThan(50);
            expect(stats.totalOpen).toBeGreaterThanOrEqual(1);
            expect(stats.totalOpen).toBeLessThan(50);
        });
    }
);
