import { describe, it, expect, afterEach } from 'vitest';

import {
    initAdapter,
    createAdapter,
    adapter,
    SQLiteAdapter
} from './index.js';

/**
 * Stage 3 (dynamic import 404 fix): `adapter/index.js` unit tests.
 *
 * The `_engineSpec` table was changed from variable-path
 * `{ path }` entries to literal-path loader functions
 * (`load: () => import('./XxxAdapter.js')`) so Rolldown can statically
 * resolve the dynamic imports and emit real on-demand chunks instead of
 * a runtime network-fetch fallback that 404s in the packaged app.
 *
 * These tests pin the observable contract of `initAdapter` /
 * `createAdapter` / the `adapter` live binding under vitest:
 *   - postgresql / mysql / mariadb init swap the exported `adapter`
 *     singleton to the lazy-loaded engine adapter;
 *   - sqlite mode stays synchronous and never touches the loaders;
 *   - concurrent same-mode calls share the in-flight init promise;
 *   - createAdapter resolves schemes through the same `_engineSpec`
 *     table with identical error messages.
 *
 * Under `vitest.setup.js`, `PostgreSQL` / `MySQL` are noopAsync Proxy
 * globals, so lazy-importing and constructing PgSQLAdapter /
 * MySQLAdapter is safe and side-effect-free.
 *
 * NOTE: `adapter` is an ESM live binding — its value changes whenever
 * `initAdapter` switches mode. `afterEach` resets the singleton back to
 * sqlite so tests never observe a leaked engine instance.
 */
describe('adapter/index lazy-load (literal-path loaders)', () => {
    afterEach(async () => {
        // Reset to sqlite so the `adapter` live binding never leaks a
        // non-sqlite engine into a later test.
        await initAdapter('sqlite');
    });

    // ── initAdapter: mode → engine singleton ─────────────────────────

    it('postgresql: returns a PgSQLAdapter and rebinds the exported adapter singleton', async () => {
        const instance = await initAdapter('postgresql');

        expect(instance.engineType).toBe('postgresql');
        expect(instance.constructor.name).toBe('PgSQLAdapter');
        // The exported `adapter` is a live binding — it must now point
        // at the same lazy-loaded singleton.
        expect(instance).toBe(adapter);
    });

    it('mysql: returns a MySQLAdapter instance', async () => {
        const instance = await initAdapter('mysql');

        expect(instance.engineType).toBe('mysql');
        expect(instance.constructor.name).toBe('MySQLAdapter');
        expect(instance).toBe(adapter);
    });

    it('mariadb: alias normalises to mysql', async () => {
        const instance = await initAdapter('mariadb');

        expect(instance.engineType).toBe('mysql');
        expect(instance.constructor.name).toBe('MySQLAdapter');
        expect(instance).toBe(adapter);
    });

    it('sqlite: resolves synchronously and never triggers a loader', async () => {
        // The sqlite branch awaits nothing — its promise settles on the
        // first microtask, i.e. before a plain `await Promise.resolve()`.
        // A non-sqlite path would need at least one dynamic-import
        // round-trip before settling.
        const promise = initAdapter('sqlite');
        let settled = false;
        promise.then(() => {
            settled = true;
        });
        await Promise.resolve();
        expect(settled).toBe(true);

        const instance = await promise;
        expect(instance).toBeInstanceOf(SQLiteAdapter);
        expect(instance.constructor.name).toBe('SQLiteAdapter');
        expect(instance).toBe(adapter);
    });

    it('switching from postgresql back to sqlite restores the SQLiteAdapter singleton', async () => {
        await initAdapter('postgresql');
        expect(adapter.constructor.name).toBe('PgSQLAdapter');

        const sqlite = await initAdapter('sqlite');
        expect(sqlite).toBeInstanceOf(SQLiteAdapter);
        expect(sqlite.constructor.name).toBe('SQLiteAdapter');
        expect(sqlite).toBe(adapter);
    });

    it('unsupported mode throws the exact error message', async () => {
        await expect(initAdapter('unsupported')).rejects.toThrow(
            "initAdapter: unsupported engine mode: unsupported" +
                " (expected 'sqlite' | 'postgresql' | 'mysql' | 'mariadb')"
        );
        // The singleton must be untouched after the rejection.
        expect(adapter.constructor.name).toBe('SQLiteAdapter');
    });

    it('concurrent same-mode calls share the in-flight init (single load)', async () => {
        await initAdapter('sqlite');

        const first = initAdapter('postgresql');
        const second = initAdapter('postgresql');

        const [a, b] = await Promise.all([first, second]);
        // Both calls must resolve to the SAME instance. Had the second
        // call started its own load instead of awaiting the shared
        // `_initPromise`, it would have constructed a second
        // PgSQLAdapter — identity equality proves promise sharing.
        expect(a).toBe(b);
        expect(a).toBe(adapter);
        expect(a.constructor.name).toBe('PgSQLAdapter');
    });

    // ── createAdapter: connection URI → new engine instance ──────────

    it('createAdapter: postgresql:// URI returns a PgSQLAdapter', async () => {
        const instance = await createAdapter({
            connection: 'postgresql://host:5432/db'
        });

        expect(instance.engineType).toBe('postgresql');
        expect(instance.constructor.name).toBe('PgSQLAdapter');
        expect(instance.connectionString).toBe('postgresql://host:5432/db');
    });

    it('createAdapter: mysql:// URI returns a MySQLAdapter', async () => {
        const instance = await createAdapter({
            connection: 'mysql://host:3306/db'
        });

        expect(instance.engineType).toBe('mysql');
        expect(instance.constructor.name).toBe('MySQLAdapter');
        // MySQLAdapter._buildConnectionString normalises the URI into a
        // `Server=...;Port=...;Database=...` connection string.
        expect(instance.connectionString).toBe(
            'Server=host;Port=3306;Database=db'
        );
    });

    it('createAdapter: mariadb:// URI returns a MySQLAdapter (alias)', async () => {
        const instance = await createAdapter({
            connection: 'mariadb://host:3306/db'
        });

        expect(instance.engineType).toBe('mysql');
        expect(instance.constructor.name).toBe('MySQLAdapter');
    });

    it('createAdapter: sqlite:/// URI returns a SQLiteAdapter', async () => {
        const instance = await createAdapter({
            connection: 'sqlite:///C:/data/vrcx.db'
        });

        expect(instance).toBeInstanceOf(SQLiteAdapter);
        expect(instance.constructor.name).toBe('SQLiteAdapter');
    });

    it('createAdapter: empty/missing connection and unknown scheme throw', async () => {
        await expect(createAdapter({})).rejects.toThrow(
            'createAdapter requires a connection URI (e.g. sqlite:///path)'
        );
        await expect(
            createAdapter({ connection: '' })
        ).rejects.toThrow(
            'createAdapter requires a connection URI (e.g. sqlite:///path)'
        );
        await expect(
            createAdapter({ connection: 'oracle://host:1521/db' })
        ).rejects.toThrow(
            'Unsupported connection scheme: oracle' +
                ' (expected sqlite://, postgresql://, mysql://, or mariadb://)'
        );
    });
});
