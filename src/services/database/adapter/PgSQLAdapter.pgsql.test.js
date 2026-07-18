import { describe, it, expect } from 'vitest';

/**
 * Phase 9 slice S12 (task 9.15): PgSQLAdapter integration smoke test.
 *
 * Gated on `PG_TEST_HOST` so it stays inert under the default `npm test`
 * (SQLite mode) suite. The CI workflow `.github/workflows/ci.yaml`
 * `test_pgsql` job sets the env var and runs `*.pgsql.test.js` against a
 * PostgreSQL 16 / 17 service container.
 *
 * Run locally:
 *   docker compose -f docker-compose.pgsql.yml up -d
 *   PG_TEST_HOST=localhost npm test -- --run PgSQLAdapter.pgsql
 *
 * No `pg` driver dependency: uses Node's built-in `node:net` to probe TCP
 * reachability of the PG container. Full adapter integration tests
 * (initUserSchema / listTables / CRUD / migration parity) will be added in
 * follow-up slices.
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
