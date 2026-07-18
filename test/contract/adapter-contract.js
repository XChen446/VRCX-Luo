// @ts-check
/**
 * EngineAdapter 接口契约测试套件（库文件）。
 *
 * 任何实现 EngineAdapter 抽象基类的 adapter 都应满足这些契约。
 * 调用方在自己的 .test.js 中 import 并执行：
 *
 *   import { runAdapterContractTests } from '../../../../test/contract/adapter-contract.js';
 *   describe('EngineAdapter contract — MyAdapter', () => {
 *       runAdapterContractTests(() => new MyAdapter(...), 'MyAdapter');
 *   });
 *
 * 本文件不含顶层 describe/test/it 调用——所有测试注册都在
 * runAdapterContractTests 函数体内发生，仅当被 wrapper .test.js
 * 调用时才执行。vitest 的 include glob 只扫描 src 下的测试文件，
 * 不扫描 test/ 目录，因此本文件永远不会被 vitest 误识别为入口。
 *
 * 契约测试不依赖方言细节（不断言 INSERT OR IGNORE 等字面语法），
 * 只断言跨引擎不变语义。
 *
 * @param {() => import('../../src/services/database/adapter/EngineAdapter.js').EngineAdapter} adapterFactory - 每次调用返回一个 fresh adapter 实例
 * @param {string} name - adapter 名称，用于 describe 块标题
 */
import { describe, test, beforeEach, afterEach, expect } from 'vitest';
import { EngineAdapter } from '../../src/services/database/adapter/EngineAdapter.js';

export function runAdapterContractTests(adapterFactory, name) {
    describe(`EngineAdapter contract — ${name}`, () => {
        let adapter;

        beforeEach(() => {
            adapter = adapterFactory();
        });

        afterEach(() => {
            try {
                adapter?._testDb?.close();
            } catch {
                // ignore close errors — db may already be closed
            }
            adapter = undefined;
        });

        /**
         * Create the standard test table used by most contract tests.
         * @param {string} [tableName] - table name (defaults to 'contract_t')
         */
        async function createTestTable(tableName = 'contract_t') {
            await adapter.createTable(tableName, [
                { name: 'id', type: 'INTEGER PRIMARY KEY' },
                { name: 'name', type: 'TEXT' },
                { name: 'value', type: 'INTEGER' }
            ]);
        }

        // ── 1. raw execution ────────────────────────────────────────────

        describe('raw execution', () => {
            test('execute(callback, sql, args) — callback receives positional array', async () => {
                await createTestTable();
                await adapter.insert('contract_t', {
                    id: 1,
                    name: 'alice',
                    value: 10
                });
                let received = null;
                await adapter.execute(
                    (row) => {
                        received = row;
                    },
                    'SELECT id, name, value FROM contract_t WHERE id = @id',
                    { id: 1 }
                );
                expect(received).toEqual([1, 'alice', 10]);
            });

            test('executeNonQuery(sql, args) returns rows-affected for DML, 0 for DDL', async () => {
                // DDL returns 0
                const ddlResult = await adapter.executeNonQuery(
                    'CREATE TABLE contract_ddl (id INTEGER PRIMARY KEY, name TEXT)'
                );
                expect(ddlResult).toBe(0);

                // DML (INSERT) returns 1 — call executeNonQuery directly so the
                // contract verifies the底层 method, not the insert/update/delete wrappers.
                const insResult = await adapter.executeNonQuery(
                    'INSERT INTO contract_ddl (id, name) VALUES (@id, @name)',
                    { id: 1, name: 'x' }
                );
                expect(insResult).toBe(1);

                // DML (UPDATE) returns rows-affected
                const updResult = await adapter.executeNonQuery(
                    'UPDATE contract_ddl SET name = @name WHERE id = @id',
                    { id: 1, name: 'y' }
                );
                expect(updResult).toBe(1);

                // DML (DELETE) returns rows-affected
                const delResult = await adapter.executeNonQuery(
                    'DELETE FROM contract_ddl WHERE id = @id',
                    { id: 1 }
                );
                expect(delResult).toBe(1);
            });

            test('named params with @ prefix and without @ prefix both bind', async () => {
                await createTestTable();

                // Without @ prefix — adapter._normalizeArgs prefixes keys
                await adapter.executeNonQuery(
                    'INSERT INTO contract_t (id, name, value) VALUES (@id, @name, @value)',
                    { id: 1, name: 'alice', value: 10 }
                );

                // With @ prefix — keys already normalized, should also work
                await adapter.executeNonQuery(
                    'INSERT INTO contract_t (id, name, value) VALUES (@id, @name, @value)',
                    { '@id': 2, '@name': 'bob', '@value': 20 }
                );

                const rows = await adapter.select(
                    'contract_t',
                    ['id', 'name', 'value'],
                    undefined,
                    { order: 'id' }
                );
                expect(rows).toEqual([
                    [1, 'alice', 10],
                    [2, 'bob', 20]
                ]);
            });
        });

        // ── 2. transaction semantics ────────────────────────────────────

        describe('transaction semantics', () => {
            test('begin() → insert → rollback() leaves table empty', async () => {
                await createTestTable();
                await adapter.begin();
                await adapter.insert('contract_t', {
                    id: 1,
                    name: 'alice',
                    value: 10
                });
                await adapter.rollback();
                const rows = await adapter.select('contract_t', '*');
                expect(rows).toHaveLength(0);
            });

            test('begin() → insert → commit() persists row', async () => {
                await createTestTable();
                await adapter.begin();
                await adapter.insert('contract_t', {
                    id: 1,
                    name: 'alice',
                    value: 10
                });
                await adapter.commit();
                const rows = await adapter.select(
                    'contract_t',
                    ['id', 'name'],
                    { id: 1 }
                );
                expect(rows).toEqual([[1, 'alice']]);
            });

            test('begin() → error → rollback() does not persist DML', async () => {
                // DML rollback is cross-engine invariant (unlike DDL rollback,
                // which MySQL/MariaDB implicitly commits). See file header L18-19.
                await createTestTable();
                await adapter.begin();
                await adapter.insert('contract_t', {
                    id: 1,
                    name: 'alice',
                    value: 10
                });
                try {
                    // Trigger a constraint error inside the transaction — duplicate PK
                    await adapter.insert('contract_t', {
                        id: 1,
                        name: 'bob',
                        value: 20
                    });
                } catch {
                    // expected — duplicate primary key
                }
                await adapter.rollback();
                // The row inserted inside the transaction should NOT persist
                const rows = await adapter.select('contract_t', '*');
                expect(rows).toHaveLength(0);
            });
        });

        // ── 3. CRUD round-trip ──────────────────────────────────────────

        describe('CRUD round-trip', () => {
            test('insert returns 1, selectOne returns the row', async () => {
                await createTestTable();
                const result = await adapter.insert('contract_t', {
                    id: 1,
                    name: 'alice',
                    value: 10
                });
                expect(result).toBe(1);
                const row = await adapter.selectOne(
                    'contract_t',
                    ['id', 'name', 'value'],
                    { id: 1 }
                );
                expect(row).toEqual([1, 'alice', 10]);
            });

            test('insert "ignore" on duplicate PK returns 0', async () => {
                await createTestTable();
                await adapter.insert('contract_t', {
                    id: 1,
                    name: 'alice',
                    value: 10
                });
                const result = await adapter.insert(
                    'contract_t',
                    { id: 1, name: 'bob', value: 20 },
                    'ignore'
                );
                expect(result).toBe(0);
                // Original row unchanged
                const row = await adapter.selectOne('contract_t', ['name'], {
                    id: 1
                });
                expect(row).toEqual(['alice']);
            });

            test('upsertPartial inserts on first call, updates on second', async () => {
                await createTestTable();

                // First call: insert
                const r1 = await adapter.upsertPartial(
                    'contract_t',
                    { id: 1, name: 'alice', value: 10 },
                    { value: 99 },
                    'id'
                );
                expect(r1).toBe(1);
                const row1 = await adapter.selectOne(
                    'contract_t',
                    ['name', 'value'],
                    { id: 1 }
                );
                expect(row1).toEqual(['alice', 10]);

                // Second call: update on conflict
                const r2 = await adapter.upsertPartial(
                    'contract_t',
                    { id: 1, name: 'alice', value: 10 },
                    { value: 99 },
                    'id'
                );
                expect(r2).toBe(1);
                const row2 = await adapter.selectOne(
                    'contract_t',
                    ['name', 'value'],
                    { id: 1 }
                );
                expect(row2).toEqual(['alice', 99]);
            });

            test('update with equality where mutates only matching rows', async () => {
                await createTestTable();
                await adapter.insert('contract_t', {
                    id: 1,
                    name: 'alice',
                    value: 10
                });
                await adapter.insert('contract_t', {
                    id: 2,
                    name: 'bob',
                    value: 20
                });
                await adapter.insert('contract_t', {
                    id: 3,
                    name: 'carol',
                    value: 10
                });

                const affected = await adapter.update(
                    'contract_t',
                    { value: 99 },
                    { value: 10 }
                );
                expect(affected).toBe(2);

                // Matching rows updated
                const r1 = await adapter.selectOne('contract_t', ['value'], {
                    id: 1
                });
                expect(r1).toEqual([99]);
                const r3 = await adapter.selectOne('contract_t', ['value'], {
                    id: 3
                });
                expect(r3).toEqual([99]);
                // Non-matching row unchanged
                const r2 = await adapter.selectOne('contract_t', ['value'], {
                    id: 2
                });
                expect(r2).toEqual([20]);
            });

            test('delete with equality where removes only matching rows', async () => {
                await createTestTable();
                await adapter.insert('contract_t', {
                    id: 1,
                    name: 'alice',
                    value: 10
                });
                await adapter.insert('contract_t', {
                    id: 2,
                    name: 'bob',
                    value: 20
                });
                await adapter.insert('contract_t', {
                    id: 3,
                    name: 'carol',
                    value: 10
                });

                const affected = await adapter.delete('contract_t', {
                    value: 10
                });
                expect(affected).toBe(2);

                const remaining = await adapter.select(
                    'contract_t',
                    ['id'],
                    undefined,
                    { order: 'id' }
                );
                expect(remaining).toEqual([[2]]);
            });
        });

        // ── 4. DDL → Metadata 闭环 ─────────────────────────────────────

        describe('DDL → Metadata 闭环', () => {
            test('createTable then listTables contains the name', async () => {
                await adapter.createTable('contract_meta', [
                    { name: 'id', type: 'INTEGER PRIMARY KEY' },
                    { name: 'name', type: 'TEXT' }
                ]);
                const tables = await adapter.listTables('%contract_meta%');
                expect(tables).toContain('contract_meta');
            });

            test('getTableColumns returns column metadata', async () => {
                await adapter.createTable('contract_meta', [
                    { name: 'id', type: 'INTEGER PRIMARY KEY' },
                    { name: 'name', type: 'TEXT' }
                ]);
                const cols = await adapter.getTableColumns('contract_meta');
                // PRAGMA table_xinfo returns positional arrays:
                // [cid, name, type, notnull, dflt_value, pk, hidden]
                expect(cols.length).toBeGreaterThanOrEqual(2);
                const names = cols.map((c) => c[1]);
                expect(names).toContain('id');
                expect(names).toContain('name');
            });

            test('listTablesTypes returns structured column objects', async () => {
                await adapter.createTable('contract_meta', [
                    { name: 'id', type: 'INTEGER PRIMARY KEY' },
                    { name: 'name', type: 'TEXT' }
                ]);
                const result = await adapter.listTablesTypes();
                const entry = result.find(
                    (t) => t.tableName === 'contract_meta'
                );
                expect(entry).toBeDefined();
                expect(Array.isArray(entry.columns)).toBe(true);
                const idCol = entry.columns.find((c) => c.name === 'id');
                expect(idCol).toBeDefined();
                expect(idCol.type).toMatch(/INTEGER/i);
                expect(idCol.isPK).toBe(true);
            });

            test('dropTable removes from listTables', async () => {
                await adapter.createTable('contract_drop', [
                    { name: 'id', type: 'INTEGER PRIMARY KEY' }
                ]);
                let tables = await adapter.listTables('%contract_drop%');
                expect(tables).toContain('contract_drop');

                await adapter.dropTable('contract_drop');

                tables = await adapter.listTables('%contract_drop%');
                expect(tables).not.toContain('contract_drop');
            });
        });

        // ── 5. count consistency ───────────────────────────────────────

        describe('count consistency', () => {
            test('count(table, where) == select(table, "*", where).length', async () => {
                await createTestTable();
                await adapter.insert('contract_t', {
                    id: 1,
                    name: 'alice',
                    value: 10
                });
                await adapter.insert('contract_t', {
                    id: 2,
                    name: 'bob',
                    value: 10
                });
                await adapter.insert('contract_t', {
                    id: 3,
                    name: 'carol',
                    value: 20
                });

                const cnt = await adapter.count('contract_t', { value: 10 });
                const rows = await adapter.select('contract_t', '*', {
                    value: 10
                });
                expect(cnt).toBe(rows.length);
                expect(cnt).toBe(2);
            });

            test('countWhere == count with equivalent where', async () => {
                await createTestTable();
                await adapter.insert('contract_t', {
                    id: 1,
                    name: 'alice',
                    value: 10
                });
                await adapter.insert('contract_t', {
                    id: 2,
                    name: 'bob',
                    value: 10
                });
                await adapter.insert('contract_t', {
                    id: 3,
                    name: 'carol',
                    value: 20
                });

                const cntEq = await adapter.count('contract_t', { value: 10 });
                const cntWhere = await adapter.countWhere(
                    'contract_t',
                    'value = @value',
                    { value: 10 }
                );
                expect(cntWhere).toBe(cntEq);
            });
        });

        // ── 6. abstract enforcement ───────────────────────────────────

        describe('abstract enforcement', () => {
            test('new EngineAdapter() throws TypeError (abstract class cannot be instantiated)', () => {
                expect(() => new EngineAdapter()).toThrow(TypeError);
            });

            test('subclass missing abstract method throws "abstract" error on call', () => {
                /**
                 * Stub subclass that intentionally implements none of the
                 * abstract methods — used to verify the base class throws.
                 */
                class StubAdapter extends EngineAdapter {}

                const stub = new StubAdapter();
                // Calling any abstract method should throw with "abstract" keyword
                expect(() => stub.execute(null, '', null)).toThrow(/abstract/);
                expect(() => stub.insert('', {}, undefined)).toThrow(
                    /abstract/
                );
                expect(() => stub.begin()).toThrow(/abstract/);
            });
        });
    });
}
