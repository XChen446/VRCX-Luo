import { describe, it, expect } from 'vitest';

/**
 * Phase 9 slice S12 (task 9.15): PgSQLAdapter integration smoke test.
 *
 * Gated on `PG_TEST_HOST` so it stays inert under the default `npm test`
 * (SQLite mode) suite. The CI workflow `.github/workflows/ci.yaml`
 * `test_pgsql` job sets the env var and runs `*.pgsql.test.js` against a
 * PostgreSQL 16 / 17 instance provisioned by `ikalnytskyi/action-setup-postgres`.
 *
 * Run locally:
 *   docker run -d --name vrcx-pg -e POSTGRES_PASSWORD=vrcx -e POSTGRES_USER=vrcx \
 *     -e POSTGRES_DB=vrcx -p 5432:5432 postgres:16
 *   PG_TEST_HOST=localhost npm test -- --run PgSQLAdapter.pgsql
 *
 * No `pg` driver dependency: uses Node's built-in `node:net` to probe TCP
 * reachability of the PG instance. Full adapter integration tests
 * (initUserSchema / listTables / CRUD / migration parity) will be added in
 * follow-up slices.
 *
 * TODO: 事务集成测试覆盖空白。PG 引擎级事务语义
 *   (C# `BeginTransaction/CommitTransaction/RollbackTransaction` 往返、
 *   pinned 连接生命周期、超时 sliding Timer 回收后 rollback no-op、
 *   事务内 `execute` 走 pinned 连接读得到未 commit 的写)需真实
 *   Npgsql 后端 + C# 桥,待 follow-up 补集成测试。当前栈契约由
 *   `transaction.test.js` 引擎无关覆盖。
 */
const pgHost = process.env.PG_TEST_HOST;
const describeIntegration = pgHost ? describe : describe.skip;

describeIntegration('PgSQLAdapter integration (requires PG container)', () => {
    it('should reach PostgreSQL container on configured port', async () => {
        const port = Number(process.env.PG_TEST_PORT || 5432);
        const net = await import('node:net');
        await new Promise((resolve, reject) => {
            const socket = new net.Socket();
            socket.setTimeout(5000);
            socket.once('connect', () => {
                socket.destroy();
                resolve();
            });
            socket.once('error', reject);
            socket.once('timeout', () => {
                socket.destroy();
                reject(new Error('timeout'));
            });
            socket.connect(port, pgHost);
        });
        expect(true).toBe(true);
    });
});
