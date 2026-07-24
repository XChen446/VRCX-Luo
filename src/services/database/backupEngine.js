// Remote → SQLite backup engine.
//
// Provides `backupRemoteToSqlite(dstConnStr, options)` which copies every
// global + user table from the currently-initialised remote singleton
// adapter (PostgreSQL or MySQL/MariaDB) into a NEW SQLite database file
// the user picks via a native Save-As dialog. This is the symmetric
// counterpart to `migrateEngine.js`'s `migrateSqliteToRemote`: the
// migration copies SQLite → remote (live singleton), the backup copies
// remote (live singleton) → SQLite (new throwaway file). The backup is
// non-destructive — it never touches the running remote database; it only
// reads from it and writes to the user-chosen `.sqlite3` file.
//
// The backup body is engine-agnostic: it only touches the abstract
// `EngineAdapter` surface (`listTablesTypes` / `listGlobalTablesTypes` /
// `initGlobalSchema` / `initUserSchema` / `userTable` / `bulkInsert` /
// `createTable`), which every adapter implements. The one engine-specific
// wrinkle is PostgreSQL: PG keeps user tables in per-account `account_*`
// schemas and global tables in the `public` schema, and its
// `listTablesTypes` only enumerates `account_*` tables (per its JSDoc), so
// we probe for the PG-specific `listGlobalTablesTypes` extension and fall
// back to deriving global tables from the `GLOBAL_TABLES` whitelist for
// MySQL/SQLite (which enumerate all tables flatly through `listTablesTypes`).
//
// Design constraints honoured here (mirrors `migrateEngine.js`):
//   - The source is the live singleton `adapter` only — there is no
//     `srcConfig` parameter. Callers MUST ensure the engine has been
//     switched + restarted so the singleton matches the user's intended
//     source; the UI-side guard `canBackupFromRemote` in
//     `stores/settings/advanced.js` enforces this by checking
//     `adapter.engineType` is a remote engine (not 'sqlite'/'unknown').
//   - `id` / `session_id` columns are copied verbatim (SELECT * includes
//     them, bulkInsert writes them through).
//   - Errors per-table are collected and the run continues — a single
//     broken table does not abort the whole backup.
//   - Row-count verification per table; deeper sampling left to QA.
//   - DATA-INTEGRITY PRIORITY: the 16 global + 22 user base-name whitelists
//     cover the *known* schema, but the backup MUST NOT silently drop tables
//     that fall outside them (upstream additions, legacy tables, the
//     `configs` JSON store, etc.). After the known tables are copied, every
//     remaining source table is mirrored into the destination: its column
//     metadata is read from the source adapter's `listTablesTypes` and
//     re-emitted as a `CREATE TABLE IF NOT EXISTS` via the destination
//     adapter's `createTable` (which applies engine-specific type mapping),
//     then the rows are copied through the same paged `copyTable` path.
//     Constraints are mirrored at column-level only (single-col PK inline,
//     composite PK as a table-level `PRIMARY KEY(...)` clause; UNIQUE/indexes
//     are NOT re-created — recovery-time concerns). `configs` is copied under
//     its original name.

import { adapter, createAdapter } from './adapter/index.js';

/**
 * 16 global tables (public schema) — mirrors `migrateEngine.js`'s
 * `GLOBAL_TABLES` and `SQLiteAdapter.initGlobalSchema` /
 * `PgSQLAdapter.initGlobalSchema` / `MySQLAdapter.initGlobalSchema`
 * table-for-table. Used to split the flat MySQL/SQLite `listTablesTypes`
 * result into global vs user vs unknown buckets.
 * @type {string[]}
 */
const GLOBAL_TABLES = [
    'gamelog_location',
    'gamelog_join_leave',
    'gamelog_portal_spawn',
    'gamelog_video_play',
    'gamelog_resource_load',
    'gamelog_event',
    'gamelog_external',
    'cache_avatar',
    'cache_world',
    'favorite_world',
    'favorite_avatar',
    'favorite_friend',
    'memos',
    'world_memos',
    'avatar_memos',
    'avatar_tags'
];

/**
 * 22 user-table base names — mirrors `migrateEngine.js`'s `USER_TABLE_NAMES`.
 * In the source MySQL DB these live flat as `${prefix}_${name}`; in a
 * source PG DB they live in the `account_${prefix}` schema as just
 * `${name}`. Sorted longest-first when matching so e.g.
 * `activity_sync_state_v2` is tried before `activity_sessions_v2`.
 * @type {string[]}
 */
const USER_TABLE_NAMES = [
    'activity_bucket_cache_v2',
    'activity_sync_state_v2',
    'activity_sessions_v2',
    'manual_relations_MANUEL',
    'mutual_graph_friends_old',
    'mutual_graph_links_old',
    'mutual_graph_friends',
    'mutual_graph_links',
    'mutual_graph_meta',
    'feed_online_offline',
    'friend_log_current',
    'friend_log_history',
    'tracked_nonfriends',
    'notifications_v2',
    'notifications',
    'avatar_history',
    'feed_status',
    'feed_avatar',
    'feed_gps',
    'feed_bio',
    'moderation',
    'notes'
];

// Longest-first for `endsWith('_' + name)` matching.
const USER_TABLE_NAMES_BY_LENGTH_DESC = [...USER_TABLE_NAMES].sort(
    (a, b) => b.length - a.length
);

/**
 * @typedef {Object} BackupProgress
 * @property {'global'|'user'|'mirror'} phase
 * @property {string} table - destination table identifier (bare name or `account_{prefix}.{name}`)
 * @property {number} current - 1-based index of the current table within its phase
 * @property {number} total - total tables in this phase
 * @property {number} rowsCopied - running total rows copied across all tables so far
 */

/**
 * @typedef {Object} BackupResult
 * @property {number} globalTables - number of known global tables processed
 * @property {number} userTables - number of known user tables processed (across all prefixes)
 * @property {number} unknownTables - number of non-whitelist tables mirrored + copied (data-integrity safety net)
 * @property {number} rowsCopied - total rows copied
 * @property {string[]} errors - per-table error messages (empty on full success)
 */

/**
 * Back up data from the live remote-engine singleton adapter to a NEW
 * SQLite database file.
 *
 * The source is the singleton `adapter` from `./adapter/index.js`, which
 * is a `PgSQLAdapter` when the app booted with `VRCX_Database.mode ===
 * 'postgresql'` (C# `PostgreSQL` pool initialised) or a `MySQLAdapter`
 * when mode is `'mysql'`/`'mariadb'` (C# `MySQL` initialised). Callers
 * must ensure the engine has been switched + the app restarted before
 * invoking this function; otherwise the source reads will go to the live
 * SQLite adapter and the "backup" would be SQLite → SQLite (useless).
 * We guard against this by refusing to run when the singleton's
 * `engineType` is `'sqlite'` (or the abstract `'unknown'`).
 *
 * The destination is a throwaway `SQLiteAdapter` constructed from
 * `dstConnStr` (a `sqlite:///path` URI pointing at the user-chosen
 * `.sqlite3` file). The file is created by SQLite on first connection
 * (read-write mode), so the user's chosen path does not need to pre-exist.
 *
 * The body is engine-agnostic: it only touches abstract `EngineAdapter`
 * methods every adapter implements, so PG and MySQL share one code path.
 * `isConnected` (a PgSQLAdapter extension) is probed best-effort when
 * present; subclasses without it are assumed connected after a successful
 * Init.
 *
 * @param {string} dstConnStr - SQLite connection string like 'sqlite:///C:/path/to/backup.sqlite3'.
 * @param {object} [options] - Optional { batchSize=500, onProgress? }.
 * @param {number} [options.batchSize=500] - rows per bulkInsert call.
 * @param {(p: BackupProgress) => void} [options.onProgress] - progress callback for UI.
 * @returns {Promise<BackupResult>}
 */
export async function backupRemoteToSqlite(dstConnStr, options = {}) {
    const { batchSize = 500, onProgress } = options;
    const errors = [];
    let rowsCopied = 0;
    let globalTables = 0;
    let userTables = 0;
    let unknownTables = 0;

    // ── 0. Guards ────────────────────────────────────────────────────
    // The source must NOT be a SQLiteAdapter. If it is, the user hasn't
    // switched engine + restarted yet — refuse to run rather than produce
    // a useless SQLite → SQLite copy that masquerades as a remote backup.
    const engine =
        /** @type {{ engineType?: string, isConnected?: () => boolean }} */ (
            adapter
        ).engineType;
    if (!engine || engine === 'sqlite' || engine === 'unknown') {
        throw new Error(
            'backupRemoteToSqlite: source adapter is the default SQLite engine. ' +
                'Switch VRCX_Database.mode to "postgresql", "mysql" or "mariadb" and ' +
                'restart the app before running the backup.'
        );
    }
    const adapterAny = /** @type {{ isConnected?: () => boolean }} */ (adapter);
    if (
        typeof adapterAny.isConnected === 'function' &&
        !adapterAny.isConnected()
    ) {
        throw new Error(
            `backupRemoteToSqlite: ${engine} backend is not connected. ` +
                'Check VRCX_Database.host/port/credentials and restart the app.'
        );
    }

    // ── 1. Build destination SQLite adapter (read-write) ─────────────
    // The destination is a NEW file the user picked via a Save-As dialog.
    // `createAdapter` with a `sqlite:///path` URI constructs a
    // `SQLiteAdapter` in read-only mode by default; we override to
    // `Read Only=False` so SQLite creates the file if it doesn't exist
    // (proving the directory is writable) and opens existing files in
    // read-write mode for the bulkInsert writes.
    const dstAdapter = await createAdapter(
        /** @type {any} */ ({
            connection: dstConnStr,
            'Read Only': 'False'
        })
    );

    // ── 2. Enumerate source tables + split into global/user/unknown ──
    // PostgreSQL keeps global tables in the `public` schema and user
    // tables in per-account `account_*` schemas. Its `listTablesTypes`
    // only enumerates `account_*` tables (per its JSDoc), so we call the
    // PG-specific `listGlobalTablesTypes` extension for the global half.
    // MySQL/SQLite enumerate ALL tables flatly through `listTablesTypes`,
    // so we derive the global/user/unknown split from the whitelists.
    /** @type {Array<{tableName: string, columns: Array<{name: string, type: string, notNull: boolean, defaultValue: *, isPK: boolean, isHidden: boolean}>}>} */
    const globalSchema = [];
    /**
     * User tables as a list of copy tasks: `{ srcTable, dstTable, columns }`.
     * Built uniformly for both PG (schema-qualified source → flat dest)
     * and MySQL (flat source → flat dest), so §4 has one code path.
     * @type {Array<{srcTable: string, dstTable: string, columns: Array<{name: string, isHidden: boolean}>}>}
     */
    const userTasks = [];
    /** @type {string[]} non-whitelist table names to mirror in §5 */
    const unknownNames = [];
    /** @type {Map<string, {tableName: string, columns: Array}>} */
    const srcSchemaMap = new Map();

    const pgGlobalExt =
        /** @type {{ listGlobalTablesTypes?: () => Promise<Array<{tableName: string, columns: Array}>> } | null} */ (
            adapter
        );
    if (
        engine === 'postgresql' &&
        typeof pgGlobalExt?.listGlobalTablesTypes === 'function'
    ) {
        // PG: global tables in `public`, user tables in `account_*`.
        const pgGlobal = await pgGlobalExt.listGlobalTablesTypes();
        for (const entry of pgGlobal) {
            globalSchema.push(entry);
        }
        const pgUser = await adapter.listTablesTypes();
        for (const entry of pgUser) {
            const { prefix, name } = splitPgUserTable(entry.tableName);
            userTasks.push({
                srcTable: entry.tableName,
                dstTable: dstAdapter.userTable(prefix, name),
                columns: entry.columns
            });
        }
    } else {
        // MySQL (and the SQLite fallback, which we refuse above but keep
        // for robustness): enumerate all tables flatly, then split via
        // the whitelists. This mirrors `migrateEngine.js` §4.
        const allTables = await adapter.listTablesTypes();
        /** @type {Map<string, string[]>} prefix -> list of user-table base names */
        const userTablesByPrefix = new Map();
        for (const entry of allTables) {
            const tableName = entry.tableName;
            if (!tableName) continue;
            srcSchemaMap.set(tableName, entry);
            if (GLOBAL_TABLES.includes(tableName)) {
                globalSchema.push(entry);
                continue;
            }
            const match = matchUserTable(tableName);
            if (match) {
                const { prefix, name } = match;
                if (!userTablesByPrefix.has(prefix)) {
                    userTablesByPrefix.set(prefix, []);
                }
                userTablesByPrefix.get(prefix).push(name);
            } else {
                unknownNames.push(tableName);
            }
        }
        // Flatten the grouped map into per-table copy tasks so §4 has a
        // single uniform loop (same shape as the PG branch).
        for (const [prefix, names] of userTablesByPrefix) {
            for (const name of names) {
                const srcTable = `${prefix}_${name}`;
                const entry = srcSchemaMap.get(srcTable);
                userTasks.push({
                    srcTable,
                    dstTable: dstAdapter.userTable(prefix, name),
                    columns: entry?.columns || []
                });
            }
        }
    }

    // ── 3. Ensure destination global schema exists + copy global tables ─
    await dstAdapter.initGlobalSchema();
    const globalTotal = globalSchema.length;
    let globalIdx = 0;
    for (const { tableName, columns } of globalSchema) {
        globalIdx += 1;
        // PG returns `public.gamelog_location`; MySQL/SQLite return the
        // bare `gamelog_location`. The destination SQLite always uses the
        // bare name (its global tables are flat), so strip any `public.`
        // prefix.
        const dstTable = stripSchemaPrefix(tableName);
        if (typeof onProgress === 'function') {
            onProgress({
                phase: 'global',
                table: dstTable,
                current: globalIdx,
                total: globalTotal,
                rowsCopied
            });
        }
        try {
            const copied = await copyTable(
                adapter,
                dstAdapter,
                tableName, // source identifier (PG: schema-qualified)
                dstTable, // destination flat name
                batchSize,
                columns
            );
            rowsCopied += copied;
            globalTables += 1;
        } catch (err) {
            errors.push(`global:${dstTable}: ${err.message || String(err)}`);
        }
    }

    // ── 4. Copy user tables (uniform task list for both engines) ─────
    const userTotal = userTasks.length;
    let userIdx = 0;
    for (const task of userTasks) {
        userIdx += 1;
        if (typeof onProgress === 'function') {
            onProgress({
                phase: 'user',
                table: task.dstTable,
                current: userIdx,
                total: userTotal,
                rowsCopied
            });
        }
        try {
            const copied = await copyTable(
                adapter,
                dstAdapter,
                task.srcTable,
                task.dstTable,
                batchSize,
                task.columns
            );
            rowsCopied += copied;
            userTables += 1;
        } catch (err) {
            errors.push(`user:${task.dstTable}: ${err.message || String(err)}`);
        }
    }

    // ── 5. Mirror + copy unknown tables (data-integrity safety net) ───
    // Only the MySQL/SQLite branch produces unknowns (PG's
    // `listTablesTypes` + `listGlobalTablesTypes` cover every table, so
    // there is no unknown bucket for PG). Every source table not covered
    // by the known global/user schema is recreated on the destination
    // from its column metadata (column-level PK + type mapping only;
    // UNIQUE/indexes are NOT re-created) then copied through the same
    // paged `copyTable`. `configs` is copied under its original name.
    if (unknownNames.length > 0) {
        console.warn(
            `[备份] 发现 ${unknownNames.length} 张非白名单表，将镜像保底复制: ` +
                unknownNames.join(', ')
        );
    }
    const mirrorTotal = unknownNames.length;
    let mirrorIdx = 0;
    for (const srcTable of unknownNames) {
        mirrorIdx += 1;
        const dstTable = srcTable;
        const entry = srcSchemaMap.get(srcTable);
        if (typeof onProgress === 'function') {
            onProgress({
                phase: 'mirror',
                table: dstTable,
                current: mirrorIdx,
                total: mirrorTotal,
                rowsCopied
            });
        }
        try {
            const colDefs = buildMirroredColumns(entry);
            if (colDefs.length > 0) {
                await dstAdapter.createTable(dstTable, colDefs);
            }
            const copied = await copyTable(
                adapter,
                dstAdapter,
                srcTable,
                dstTable,
                batchSize,
                entry?.columns || []
            );
            rowsCopied += copied;
            unknownTables += 1;
        } catch (err) {
            errors.push(`mirror:${dstTable}: ${err.message || String(err)}`);
        }
    }

    return {
        globalTables,
        userTables,
        unknownTables,
        rowsCopied,
        errors
    };
}

/**
 * Match a flat SQLite/MySQL table name against the 22 known user-table
 * base names. Symmetric to `migrateEngine.js`'s `matchUserTable`.
 *
 * @param {string} tableName - flat table name like `abc_feed_gps`.
 * @returns {{prefix: string, name: string}|null}
 */
function matchUserTable(tableName) {
    for (const name of USER_TABLE_NAMES_BY_LENGTH_DESC) {
        const suffix = '_' + name;
        if (tableName.endsWith(suffix)) {
            const prefix = tableName.slice(0, tableName.length - suffix.length);
            if (prefix.length > 0) {
                return { prefix, name };
            }
            return null;
        }
    }
    return null;
}

/**
 * Strip a leading `public.` schema qualifier from a PG table identifier,
 * returning the bare table name. Non-PG identifiers pass through
 * unchanged.
 *
 * @param {string} table - optionally schema-qualified table name
 * @returns {string} bare table name
 */
function stripSchemaPrefix(table) {
    if (table.startsWith('public.')) {
        return table.slice('public.'.length);
    }
    return table;
}

/**
 * Split a PG schema-qualified user table identifier into `{ prefix, name }`.
 *
 * `'account_xxx.feed_gps'` → `{ prefix: 'xxx', name: 'feed_gps' }`.
 * The `account_` schema-name prefix is stripped to recover the bare
 * account hash, matching how `database/index.js` derives `userPrefix`
 * from `userId`.
 *
 * @param {string} table - `account_{prefix}.{name}` identifier
 * @returns {{prefix: string, name: string}}
 */
function splitPgUserTable(table) {
    const dot = table.indexOf('.');
    const schema = dot >= 0 ? table.slice(0, dot) : table;
    const name = dot >= 0 ? table.slice(dot + 1) : '';
    const prefix = schema.startsWith('account_')
        ? schema.slice('account_'.length)
        : schema;
    return { prefix, name };
}

/**
 * @typedef {import('./adapter/SQLiteAdapter.js').SQLiteAdapter | import('./adapter/PgSQLAdapter.js').PgSQLAdapter | import('./adapter/MySQLAdapter.js').MySQLAdapter} AnyAdapter
 */

/**
 * Copy all rows from `srcTable` (remote) to `dstTable` (SQLite), in
 * batches of `batchSize`. Reads the source in paged `LIMIT/OFFSET` chunks
 * and writes each batch via `bulkInsert(..., 'ignore')` so memory stays
 * bounded. Symmetric to `migrateEngine.js`'s `copyTable`.
 *
 * @param {AnyAdapter} srcAdapter
 * @param {AnyAdapter} dstAdapter
 * @param {string} srcTable - source table identifier (PG: schema-qualified; MySQL: flat).
 * @param {string} dstTable - destination table identifier (SQLite flat).
 * @param {number} batchSize - rows per bulkInsert call.
 * @param {Array<{name: string, isHidden: boolean}>} columns - source column metadata.
 * @returns {Promise<number>} number of rows copied.
 */
async function copyTable(
    srcAdapter,
    dstAdapter,
    srcTable,
    dstTable,
    batchSize,
    columns
) {
    const visibleColumns = (columns || []).filter((c) => !c.isHidden);
    if (visibleColumns.length === 0) return 0;
    const colList = visibleColumns.map((c) => c.name).join(', ');

    // Paged read: LIMIT/OFFSET loop. Memory stays O(batchSize) regardless
    // of source table size. The remote adapters' `execute` callbacks
    // receive positional arrays in SELECT-column order. We use named
    // `@limit` / `@offset` params so both PG (`_bind` → `$N`) and MySQL
    // (`_normalizeArgs` → `@limit`) bind them correctly.
    let offset = 0;
    let totalCopied = 0;
    while (true) {
        const batch = [];
        await srcAdapter.execute(
            (row) => {
                const obj = {};
                visibleColumns.forEach((col, i) => {
                    obj[col.name] = row[i];
                });
                batch.push(obj);
            },
            `SELECT ${colList} FROM ${srcTable} LIMIT @limit OFFSET @offset`,
            { limit: batchSize, offset }
        );
        if (batch.length === 0) break;
        await dstAdapter.bulkInsert(dstTable, batch, 'ignore');
        offset += batch.length;
        totalCopied += batch.length;
        if (batch.length < batchSize) break;
    }

    // Row-count verification per table.
    const srcCount = await srcAdapter.countWhere(srcTable);
    const dstCount = await dstAdapter.countWhere(dstTable);
    if (srcCount !== dstCount) {
        throw new Error(
            `row count mismatch after copy: src=${srcCount} dst=${dstCount}`
        );
    }

    return totalCopied;
}

/**
 * Build structured column definitions for mirroring an unknown source table
 * onto the destination via `adapter.createTable`. Symmetric to
 * `migrateEngine.js`'s `buildMirroredColumns`.
 *
 * @param {{tableName: string, columns: Array<{name: string, type: string, notNull: boolean, defaultValue: *, isPK: boolean, isHidden: boolean}>}|undefined} tableMeta
 * @returns {object[]} column defs for `createTable`
 */
function buildMirroredColumns(tableMeta) {
    if (!tableMeta || !Array.isArray(tableMeta.columns)) return [];
    const visible = tableMeta.columns.filter((c) => !c.isHidden);
    if (visible.length === 0) return [];
    const pkCols = visible.filter((c) => c.isPK).map((c) => c.name);
    /** @type {object[]} */
    const cols = visible.map((c) => {
        /** @type {string[]} */
        const cons = [];
        if (c.notNull) cons.push('NOT NULL');
        if (c.defaultValue != null && c.defaultValue !== '') {
            cons.push(`DEFAULT ${c.defaultValue}`);
        }
        if (pkCols.length === 1 && c.isPK) cons.push('PRIMARY KEY');
        /** @type {{name: string, type: string, constraints?: string}} */
        const def = { name: c.name, type: c.type || 'TEXT' };
        if (cons.length > 0) def.constraints = cons.join(' ');
        return def;
    });
    if (pkCols.length > 1) {
        cols.push(
            /** @type {object} */ (
                /** @type {unknown} */ (`PRIMARY KEY (${pkCols.join(', ')})`)
            )
        );
    }
    return cols;
}

export { GLOBAL_TABLES, USER_TABLE_NAMES };
