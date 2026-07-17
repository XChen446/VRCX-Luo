// @ts-check
/**
 * Deterministic, normalized `.dump`-equivalent output for a node:sqlite
 * DatabaseSync instance. Implements the issue #3 Phase 7.1 dump-comparison
 * scheme ("规范化 SQLite .dump 输出，排除易变列").
 *
 * Normalization rules:
 *  - Enumerate `sqlite_schema` WHERE `name NOT LIKE 'sqlite_%'` AND
 *    `type IN ('table','index')`. This excludes volatile internals:
 *    `sqlite_sequence`, `sqlite_autoindex_*`, `sqlite_stat*` — the only
 *    auto-generated, run-to-run-variable schema objects.
 *  - No user-data columns are excluded (every seeded value is deterministic).
 *  - Schema section: tables first (alphabetical by name), then indexes
 *    (alphabetical). Each DDL is whitespace-collapsed, trimmed, and the
 *    token `IF NOT EXISTS ` is stripped so `CREATE TABLE IF NOT EXISTS x`
 *    normalizes to `CREATE TABLE x`.
 *  - Data section: for each table (alphabetical), emit one
 *    `INSERT INTO "tbl" VALUES(...);` per row. Rows are sorted by the
 *    table's primary-key columns (cid order via `PRAGMA table_info`); when
 *    a table has no PK, rows are sorted by all columns in cid order.
 *  - Literals: `null` → `NULL`; number → raw; string → single-quoted with
 *    embedded `'` doubled; Uint8Array/Buffer → `X'hex'`; boolean → 0/1.
 *
 * The output is stable across runs and Node versions (everything sorted),
 * which makes it suitable as a committed golden-master fixture.
 */

/**
 * Quote a SQL identifier.
 * @param {string} name
 * @returns {string}
 */
function quoteIdent(name) {
    return '"' + String(name).replace(/"/g, '""') + '"';
}

/**
 * Format a JS/SQLite value as a SQL literal.
 * @param {*} v
 * @returns {string}
 */
function formatLiteral(v) {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
    if (typeof v === 'boolean') return v ? '1' : '0';
    if (v instanceof Uint8Array || Buffer.isBuffer(v)) {
        const hex = Buffer.from(v).toString('hex');
        return `X'${hex}'`;
    }
    // string (and anything else coerced to string)
    return "'" + String(v).replace(/'/g, "''") + "'";
}

/**
 * Collapse runs of whitespace to a single space and trim.
 * @param {string} s
 * @returns {string}
 */
function collapseWs(s) {
    return String(s).replace(/\s+/g, ' ').trim();
}

/**
 * Strip the `IF NOT EXISTS ` token from a CREATE statement so the normalized
 * DDL is independent of whether the table/index was created idempotently.
 * @param {string} ddl
 * @returns {string}
 */
function stripIfNotExists(ddl) {
    return collapseWs(ddl).replace(/\bIF NOT EXISTS\s+/i, '');
}

/**
 * Row comparator that compares element-wise across the given key-column
 * indices. Numbers compare numerically; everything else lexically; nulls
 * sort before non-nulls.
 * @param {Array<*>} a
 * @param {Array<*>} b
 * @param {number[]} keyIdx
 * @returns {number}
 */
function compareRows(a, b, keyIdx) {
    for (const i of keyIdx) {
        const va = a[i];
        const vb = b[i];
        if (va === vb) continue;
        // null/undefined sorts first
        if (va === null || va === undefined) return -1;
        if (vb === null || vb === undefined) return 1;
        if (typeof va === 'number' && typeof vb === 'number') {
            return va < vb ? -1 : 1;
        }
        const sa = String(va);
        const sb = String(vb);
        if (sa < sb) return -1;
        if (sa > sb) return 1;
    }
    return 0;
}

/**
 * Produce the normalized dump string.
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {string}
 */
function normalizeDump(db) {
    const schemaRows = db
        .prepare(
            "SELECT type, name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND type IN ('table','index') ORDER BY type DESC, name"
        )
        .all();

    const tables = schemaRows
        .filter((r) => r.type === 'table')
        .map((r) => r.name)
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const indexes = schemaRows
        .filter((r) => r.type === 'index')
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    const lines = [];

    lines.push('-- SCHEMA');
    for (const tbl of tables) {
        const row = schemaRows.find(
            (r) => r.type === 'table' && r.name === tbl
        );
        lines.push(`${stripIfNotExists(row.sql)};`);
    }
    for (const idx of indexes) {
        lines.push(`${stripIfNotExists(idx.sql)};`);
    }

    lines.push('-- DATA');
    for (const tbl of tables) {
        const colInfo = db
            .prepare(`PRAGMA table_info(${quoteIdent(tbl)})`)
            .all();
        const colNames = colInfo.map((c) => c.name);
        // PK columns sorted by their `pk` ordinal; fall back to all columns.
        const pkCols = colInfo
            .filter((c) => c.pk > 0)
            .sort((a, b) => a.pk - b.pk);
        const keyIdx = (pkCols.length > 0 ? pkCols : colInfo).map((c) => c.cid);

        const rows = db
            .prepare(`SELECT * FROM ${quoteIdent(tbl)}`)
            .all()
            .map((r) => colNames.map((n) => r[n]));
        rows.sort((a, b) => compareRows(a, b, keyIdx));

        for (const r of rows) {
            const vals = r.map(formatLiteral).join(', ');
            lines.push(`INSERT INTO ${quoteIdent(tbl)} VALUES(${vals});`);
        }
    }

    return lines.join('\n') + '\n';
}

export { normalizeDump };
