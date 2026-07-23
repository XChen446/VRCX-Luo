import { SQLiteAdapter } from './SQLiteAdapter.js';

// ── Engine singleton & lazy-load policy ──────────────────────────────
//
// `PgSQLAdapter.js` (1604 lines) and `MySQLAdapter.js` (1128 lines on
// the MySQL branch) are intentionally NOT statically imported here.
// A static import forces every test file that touches the database
// layer to transform those modules, inflating transform time ~11x
// and import time ~3.3x, which pushes unrelated tests past their
// default 5s/10s timeouts (see Phase 9 Stage 5 D15 for the PgSQL
// measurement; the same applies to MySQL). Instead we lazy-load them
// via dynamic `import()` only when `initAdapter(mode)` is called with
// `'postgresql'` or `'mysql'`/`'mariadb'`, *or* `createAdapter()` is
// called with a matching URI scheme. In the default `sqlite` mode
// (production + vitest stub), neither module body is ever evaluated.
//
// Why not top-level `await import()` for the singleton? Rolldown's CJS
// output rejects top-level await in modules that are transitively
// `require()`d (e.g. `accountHub.js` uses `require()` to break circular
// deps with stores that re-export the adapter). So the non-sqlite
// singletons are initialised lazily by `initAdapter(mode)`, while the
// sqlite singleton stays synchronously initialised at module load to
// preserve the existing test/app contract (no init ceremony required
// for sqlite).
//
// ── Alignment with the MySQL branch ──────────────────────────────────
//
// The MySQL branch uses `initAdapter(mode)` (mode parameter) and reads
// `adapter.engineType` for engine detection in the migration runner.
// Phase 9 previously used a parameterless `initAdapter()` that read
// `VRCXStorage.Get('VRCX_Database.mode')` at module top level. This
// file aligns Phase 9 to the MySQL branch's contract:
//   - `initAdapter(mode)` takes an explicit mode argument (the caller
//     — `interopApi.js` — reads `VRCXStorage` once and passes it in,
//     keeping the adapter module free of `VRCXStorage` reads so it can
//     be unit-tested without stubbing the global).
//   - `getDatabaseEngine()` in `migrations/index.js` now reads
//     `adapter.engineType` instead of re-reading `VRCXStorage`, so
//     engine detection stays in sync with whichever adapter
//     `initAdapter(mode)` actually constructed.
// Phase 9 retains its D15 fix (lazy import for PgSQL) and extends the
// same lazy-import policy to MySQL so the merged codebase treats both
// non-sqlite engines uniformly.

// Default sqlite singleton. Constructed synchronously at module load
// so callers can keep using the `import { adapter } from '.../adapter'
// pattern with no init ceremony in the default (sqlite) mode. In
// `postgresql` / `mysql` mode the singleton is swapped by
// `initAdapter(mode)` via lazy import — `let` + live ESM binding
// ensures importers observe the post-init value.
//
// The singleton is typed as the abstract base `EngineAdapter` rather
// than a `SQLiteAdapter | PgSQLAdapter | MySQLAdapter` union: the
// latter would require `import('./MySQLAdapter.js')` type expressions
// that trigger TS2307 in the Phase 9 workspace (where MySQLAdapter.js
// is absent). Using the base class preserves type safety for all
// callers, which go through the base interface exclusively.
/** @type {import('./EngineAdapter.js').EngineAdapter} */
let adapter = new SQLiteAdapter();

/** @type {string} engine mode currently held by `adapter` ('sqlite' | 'postgresql' | 'mysql') */
let _initializedMode = 'sqlite';

/** @type {Promise<import('./EngineAdapter.js').EngineAdapter> | null} */
let _initPromise = null;

/**
 * Normalise an engine mode token.
 *
 * `'mariadb'` is treated as an alias for `'mysql'` (same adapter, same
 * wire protocol). Any other value is returned as-is so the caller can
 * reject it with a precise error message.
 *
 * @param {string} mode
 * @returns {string} 'sqlite' | 'postgresql' | 'mysql' | original
 * @private
 */
function _normalizeMode(mode) {
    if (mode === 'mariadb') return 'mysql';
    return mode;
}

/**
 * Lazy-import spec for non-sqlite engines.
 *
 * Kept as a lookup table so `initAdapter` and `createAdapter` share the
 * same path/class-name mapping, and so adding a fourth engine later is
 * a one-line change here.
 *
 * @type {Record<string, { path: string, className: string }>}
 * @private
 */
const _engineSpec = {
    postgresql: { path: './PgSQLAdapter.js', className: 'PgSQLAdapter' },
    mysql: { path: './MySQLAdapter.js', className: 'MySQLAdapter' }
};

/**
 * Initialise (or switch) the singleton adapter for the given engine mode.
 *
 * Mode handling:
 *   - `'sqlite'` (default) — synchronously constructed. No async cost.
 *     If the current singleton is not a `SQLiteAdapter` (e.g. after a
 *     prior non-sqlite init), a fresh `SQLiteAdapter` is constructed.
 *   - `'postgresql'` — lazy-imports `PgSQLAdapter.js` (1604 lines) via
 *     dynamic `import()` so the module is only transformed when PG is
 *     actually used (Phase 9 Stage 5 D15 fix — keeps sqlite-mode tests
 *     fast).
 *   - `'mysql'` / `'mariadb'` — lazy-imports `MySQLAdapter.js` via the
 *     same mechanism. In the Phase 9 workspace `MySQLAdapter.js` does
 *     not exist yet; the dynamic `import()` only fires when the user
 *     actually selects `mysql` mode, so sqlite + postgresql mode stay
 *     safe. Once this branch merges with the MySQL branch, the file
 *     will be present and `mysql` mode becomes available without any
 *     further change to this module.
 *
 * Concurrent calls:
 *   - Same-mode concurrent calls share the in-flight `_initPromise`.
 *   - Cross-mode concurrent calls serialise: a later call awaits the
 *     in-flight init, then re-checks the mode and starts its own init
 *     if the mode still differs.
 *
 * Must be `await`ed from `interopApi.js` startup (after
 * `CefSharp.BindObjectAsync` / Electron proxy setup, before
 * `configRepository.init()`) so the singleton is ready before any
 * database operation runs.
 *
 * @param {string} [mode='sqlite'] - 'sqlite' | 'postgresql' | 'mysql' | 'mariadb'
 * @returns {Promise<import('./EngineAdapter.js').EngineAdapter>}
 */
export async function initAdapter(mode = 'sqlite') {
    const normalized = _normalizeMode(mode);

    // sqlite: synchronous, no lazy import.
    if (normalized === 'sqlite') {
        // If a non-sqlite init is in flight, wait for it to finish so we
        // don't race on the `adapter` binding.
        if (_initPromise) {
            await _initPromise;
        }
        if (!(adapter instanceof SQLiteAdapter)) {
            adapter = new SQLiteAdapter();
        }
        _initializedMode = 'sqlite';
        return adapter;
    }

    // Non-sqlite engines must be in the spec table.
    const spec = _engineSpec[normalized];
    if (!spec) {
        throw new Error(
            `initAdapter: unsupported engine mode: ${mode}` +
                ` (expected 'sqlite' | 'postgresql' | 'mysql' | 'mariadb')`
        );
    }

    // Already initialised for this mode — return the singleton.
    if (_initializedMode === normalized && adapter) {
        return adapter;
    }

    // If a different mode's init is in flight, await it before starting
    // our own so we don't race on the `adapter` binding. After awaiting,
    // re-check in case the in-flight init was for our mode after all
    // (e.g. two concurrent postgresql calls).
    if (_initPromise) {
        await _initPromise;
        if (_initializedMode === normalized && adapter) {
            return adapter;
        }
    }

    // Begin lazy import. The promise is shared with concurrent same-mode
    // callers; cross-mode callers will await it above and then start
    // their own.
    _initPromise = import(spec.path)
        .then((mod) => {
            const AdapterClass = mod[spec.className];
            if (!AdapterClass) {
                throw new Error(
                    `initAdapter: ${spec.path} did not export ${spec.className}`
                );
            }
            adapter = new AdapterClass();
            _initializedMode = normalized;
            _initPromise = null;
            return adapter;
        })
        .catch((err) => {
            // Clear the in-flight marker so a later retry can attempt
            // the import again instead of awaiting a rejected promise
            // forever.
            _initPromise = null;
            throw err;
        });
    return _initPromise;
}

/**
 * Create a new adapter instance for a given connection URI.
 *
 * Async because the PostgreSQL / MySQL branches lazy-load their adapter
 * modules via `await import()` — see the file header note for why the
 * static imports were removed. The SQLite branch pays no async cost
 * beyond a microtask.
 *
 * URI schemes:
 *   - `sqlite:///path`            → SQLiteAdapter
 *   - `postgresql://host:port/db` → PgSQLAdapter
 *   - `mysql://host:port/db`      → MySQLAdapter
 *   - `mariadb://host:port/db`    → MySQLAdapter (alias)
 *
 * @param {object} config
 * @param {string} config.connection - 连接 URI，如 sqlite:///C:/path.db 或 postgresql://host:port/db
 * @param {...object} [config.params] - 额外连接参数（覆盖默认，如 'Read Only': 'False'）
 * @returns {Promise<import('./EngineAdapter.js').EngineAdapter>}
 */
async function createAdapter(config) {
    const { connection } = config;
    if (!connection || typeof connection !== 'string') {
        throw new Error(
            'createAdapter requires a connection URI (e.g. sqlite:///path)'
        );
    }
    const scheme = connection.split('://')[0];
    if (scheme === 'sqlite') {
        const rest = connection.slice('sqlite://'.length);
        if (!rest || /^\/+$/.test(rest) || !rest.trim()) {
            throw new Error('createAdapter: connection URI has empty path');
        }
        return new SQLiteAdapter(config);
    }
    // Non-sqlite schemes: resolve via the `_engineSpec` table and a
    // string-variable dynamic import (`import(spec.path)`). TypeScript
    // cannot statically resolve a string-variable import specifier, so
    // absent modules (MySQLAdapter.js in the Phase 9 workspace) do not
    // trigger TS2307 at type-check time. At runtime the import only
    // fires for the requested scheme, so sqlite + postgresql stay safe;
    // mysql raises a runtime module-not-found error, which is the
    // expected behaviour until the MySQL branch's MySQLAdapter.js
    // merges into this workspace.
    const spec = _engineSpec[scheme === 'mariadb' ? 'mysql' : scheme];
    if (!spec) {
        throw new Error(
            `Unsupported connection scheme: ${scheme} (expected sqlite://, postgresql://, mysql://, or mariadb://)`
        );
    }
    const mod = await import(spec.path);
    const AdapterClass = mod[spec.className];
    if (!AdapterClass) {
        throw new Error(
            `createAdapter: ${spec.path} did not export ${spec.className}`
        );
    }
    return new AdapterClass(config);
}

export { adapter, SQLiteAdapter, createAdapter };
