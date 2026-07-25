/**
 * Migration transaction protection tests (issue #3 Phase 10.6 / Track C).
 *
 * Verifies that `runMigrations` wraps each per-version migration in a
 * transaction and that a failure mid-migration rolls back ALL prior steps
 * within that transaction — leaving the database at its pre-migration state
 * with no half-applied schema changes and no persisted checkpoint.
 *
 * Carrier: real `runMigrations` runner + real `.map` files + in-memory
 * `MemorySQLiteAdapter` backed by `node:sqlite` DatabaseSync. The
 * production `adapter` singleton and `configRepository` are mocked so the
 * runner uses the in-memory engine and an in-memory Map for checkpoints.
 *
 * Failure injection: `memAdapter.executeNonQuery` is monkey-patched to
 * throw when the SQL string matches `ALTER TABLE ... gamelog_location`
 * (the first DDL on `gamelog_location` in v16/schema.map — the add_column
 * of `group_name`). This is string-based, not callCount-based, so it is
 * robust against reordering of the schema changes.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

let db;
let memAdapter;
const configStore = new Map();

// Mock the adapter singleton + factory. The runner imports `adapter` from
// `../adapter/index.js` (relative to the runner); vi.mock resolves to the
// same absolute module, so this intercepts the runner's import. The getter
// reads the live `memAdapter` (set in beforeEach) lazily.
vi.mock('../../adapter/index.js', () => ({
    get adapter() {
        return memAdapter;
    },
    createAdapter: () => memAdapter
}));

// Mock configRepository. The runner imports the default export and calls
// `setInt`/`getInt` for version checkpoints.
vi.mock('../../../config.js', () => ({
    default: {
        setInt: vi.fn(async (k, v) => {
            configStore.set(k, String(v));
        }),
        getInt: vi.fn(async (k, d) =>
            configStore.has(k) ? Number(configStore.get(k)) : d
        )
    }
}));

// Import the runner AFTER mocks (vitest hoists vi.mock above imports).
import { runMigrations } from '../index.js';

beforeEach(async () => {
    configStore.clear();
    const { DatabaseSync } = await import('node:sqlite');
    const { MemorySQLiteAdapter } = await import('./memoryAdapter.js');
    const { buildPreV16Fixture } = await import('./preV16Fixture.js');
    db = new DatabaseSync(':memory:');
    buildPreV16Fixture(db);
    memAdapter = new MemorySQLiteAdapter(db);
});

afterEach(() => {
    try {
        db?.close();
    } catch {
        /* ignore close errors — db may be in a broken txn state */
    }
    db = undefined;
    memAdapter = undefined;
});

// ── Direct query helpers (bypass the adapter; read straight from the DB) ──

function columnsOf(table) {
    return db
        .prepare(`PRAGMA table_info("${table}")`)
        .all()
        .map((r) => r.name);
}

function tableRowCount(table) {
    return db.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get().c;
}

/**
 * Wrap `memAdapter.executeNonQuery` to throw on SQL matching a predicate.
 * Returns a restore function that reverts the patch.
 * @param {(sql: string) => boolean} shouldThrow
 * @param {string} errMsg
 * @returns {() => void} restore
 */
function injectFailure(shouldThrow, errMsg) {
    const original = memAdapter.executeNonQuery.bind(memAdapter);
    memAdapter.executeNonQuery = async (sql, args) => {
        if (typeof sql === 'string' && shouldThrow(sql)) {
            throw new Error(errMsg);
        }
        return original(sql, args);
    };
    return () => {
        memAdapter.executeNonQuery = original;
    };
}

const PREFIXES = ['userA1', 'userB2'];

// ── Block 1: explicit transaction semantics ─────────────────────────────

describe('explicit transaction semantics', () => {
    test('begin → insert → commit persists the row', async () => {
        db.exec('CREATE TABLE txn_test (id INTEGER PRIMARY KEY, val TEXT)');
        const connId = await memAdapter.beginTransaction();
        await memAdapter.executeNonQuery(
            'INSERT INTO txn_test (id, val) VALUES (@id, @val)',
            { id: 1, val: 'committed' }
        );
        await memAdapter.commit(connId);
        expect(tableRowCount('txn_test')).toBe(1);
    });

    test('begin → insert → rollback leaves the table empty', async () => {
        db.exec('CREATE TABLE txn_test (id INTEGER PRIMARY KEY, val TEXT)');
        const connId = await memAdapter.beginTransaction();
        await memAdapter.executeNonQuery(
            'INSERT INTO txn_test (id, val) VALUES (@id, @val)',
            { id: 1, val: 'will-rollback' }
        );
        await memAdapter.rollback(connId);
        expect(tableRowCount('txn_test')).toBe(0);
    });

    test('rollback() without an active transaction is silently no-op (aligned with PG timeout semantics)', async () => {
        // SQLite's ROLLBACK without BEGIN raises "no transaction is active",
        // but _doRollback now catches this error to align with PG's
        // "connId已超时回滚后 rollback no-op" semantics. This lets
        // withTransaction's catch block call rollback() unconditionally.
        await expect(memAdapter.rollback(0)).resolves.toBeUndefined();
    });

    test('commit() without an active transaction throws "no transaction is active"', async () => {
        // COMMIT without BEGIN still raises — _doCommit does NOT catch
        // this (unlike rollback), so calling commit on a stale/missing
        // transaction surfaces loudly (caller bug, not a cleanup path).
        await expect(memAdapter.commit(0)).rejects.toThrow(/no transaction/i);
    });
});

// ── Block 2: 单步迁移失败 → 之前步骤回滚 ──────────────────────────────

describe('单步迁移失败 → 之前步骤回滚', () => {
    test('failed ALTER TABLE on gamelog_location rolls back the whole v16-schema transaction', async () => {
        // Sanity: pre-migration state — gamelog_location has no group_name
        expect(columnsOf('gamelog_location')).not.toContain('group_name');

        // Inject failure on the first ALTER TABLE targeting gamelog_location.
        // In v16/schema.map, the changes run in order:
        //   1. %_feed_gps ADD COLUMN group_name         (ALTER TABLE userA1_feed_gps ...)
        //   2. %_feed_online_offline ADD COLUMN group_name
        //   3. gamelog_location ADD COLUMN group_name   ← INJECTED FAILURE fires here
        // Steps 1-2 succeed inside the transaction; step 3 throws; rollback
        // undoes steps 1-2 as well.
        const restore = injectFailure(
            (sql) =>
                sql.includes('ALTER TABLE') && sql.includes('gamelog_location'),
            'INJECTED_FAILURE'
        );

        // runMigrations rejects with the migration label wrapping the
        // injected error message. Single call — the error message format is
        // `迁移 v16 (schema) 失败: INJECTED_FAILURE`.
        await expect(runMigrations(0, 16)).rejects.toThrow(
            /迁移 v16.*INJECTED_FAILURE/
        );

        // Post-failure: gamelog_location still has no group_name (ALTER failed)
        expect(columnsOf('gamelog_location')).not.toContain('group_name');

        // Rollback undid the prior %_feed_gps group_name add too — this is
        // the key proof that the transaction actually rolled back, not just
        // that the ALTER happened to fail.
        expect(columnsOf('userA1_feed_gps')).not.toContain('group_name');
        expect(columnsOf('userB2_feed_gps')).not.toContain('group_name');

        // Checkpoint NOT persisted — recordCheckpoint runs after schema
        // execution succeeds, so a mid-schema failure never reaches it.
        expect(configStore.get('VRCX_databaseVersion')).toBeUndefined();

        restore();
    });
});

// ── Block 3: runMigrations 中途抛错后数据库状态不变 ──────────────────

describe('runMigrations 中途抛错后数据库状态不变', () => {
    test('failed migration leaves database at pre-migration version', async () => {
        const restore = injectFailure(
            (sql) =>
                sql.includes('ALTER TABLE') && sql.includes('gamelog_location'),
            'INJECTED_FAILURE'
        );

        await expect(runMigrations(0, 16)).rejects.toThrow();

        // No schema changes leaked through (rollback was effective).
        // gamelog_location retains its OLD shape: groupName column, no group_name.
        expect(columnsOf('gamelog_location')).not.toContain('group_name');
        expect(columnsOf('gamelog_location')).toContain('groupName');
        // No checkpoint persisted.
        expect(configStore.get('VRCX_databaseVersion')).toBeUndefined();

        restore();
    });

    test('failed migration does not leave half-applied schema changes', async () => {
        const restore = injectFailure(
            (sql) =>
                sql.includes('ALTER TABLE') && sql.includes('gamelog_location'),
            'INJECTED_FAILURE'
        );

        await expect(runMigrations(0, 16)).rejects.toThrow();

        // None of the v16 schema additions should be present on any prefix.
        for (const p of PREFIXES) {
            expect(columnsOf(`${p}_feed_gps`)).not.toContain('group_name');
            expect(columnsOf(`${p}_feed_online_offline`)).not.toContain(
                'group_name'
            );
            expect(columnsOf(`${p}_friend_log_current`)).not.toContain(
                'friend_number'
            );
            expect(columnsOf(`${p}_friend_log_history`)).not.toContain(
                'friend_number'
            );
            expect(columnsOf(`${p}_avatar_history`)).not.toContain('time');
        }
        // gamelog_location: old groupName column intact, new group_name absent.
        expect(columnsOf('gamelog_location')).toContain('groupName');
        expect(columnsOf('gamelog_location')).not.toContain('group_name');

        restore();
    });

    test('failed migration can be safely retried — partial-failure then retry reaches target version', async () => {
        // First run: inject failure on ALTER TABLE gamelog_location.
        const restore = injectFailure(
            (sql) =>
                sql.includes('ALTER TABLE') && sql.includes('gamelog_location'),
            'INJECTED_FAILURE'
        );

        await expect(runMigrations(0, 16)).rejects.toThrow();
        expect(columnsOf('gamelog_location')).not.toContain('group_name');

        // Remove failure injection and retry — the pre-v16 fixture is
        // untouched by the failed run, so retry starts from a clean state.
        restore();

        await runMigrations(0, 16);

        // Migration succeeded: group_name now exists, groupName dropped.
        expect(columnsOf('gamelog_location')).toContain('group_name');
        expect(columnsOf('gamelog_location')).not.toContain('groupName');
        // Checkpoint persisted at v16.
        expect(configStore.get('VRCX_databaseVersion')).toBe('16');
    });

    test('rollback itself failing does not mask the original migration error', async () => {
        // Inject failure on the schema operation AND make rollback blow up.
        // The runner's catch block wraps adapter.rollback() in its own
        // try/catch and logs the rollback error without re-throwing — the
        // original migration error must still surface to the caller.
        const restoreExec = injectFailure(
            (sql) =>
                sql.includes('ALTER TABLE') && sql.includes('gamelog_location'),
            'INJECTED_FAILURE'
        );

        const originalRollback = memAdapter.rollback.bind(memAdapter);
        memAdapter.rollback = async () => {
            throw new Error('ROLLBACK_BOOM');
        };

        // Single call — after a failed rollback the DB may be left in an
        // active transaction, so calling runMigrations again would throw
        // "cannot start a transaction within a transaction" and mask the
        // real error. Capture the error from one invocation.
        let caughtError;
        try {
            await runMigrations(0, 16);
        } catch (e) {
            caughtError = e;
        }

        // The surfaced error must be the migration failure, NOT ROLLBACK_BOOM.
        expect(caughtError).toBeInstanceOf(Error);
        expect(caughtError.message).toMatch(/迁移 v16/);
        expect(caughtError.message).toMatch(/INJECTED_FAILURE/);
        expect(caughtError.message).not.toMatch(/ROLLBACK_BOOM/);

        // Restore for clean afterEach teardown.
        memAdapter.rollback = originalRollback;
        restoreExec();
    });
});
