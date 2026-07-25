/**
 * 栈式事务上下文 + withTransaction 行为测试。
 *
 * 验证项(对应讨论中的七类干扰路径):
 *  1. 事务外调用走默认池(_txStack 空,connId 不影响行为)
 *  2. withTransaction 体内 execute/insert/bulkInsert 自动走 pinned 连接
 *  3. withTransaction 成功 → commit + pop 栈
 *  4. withTransaction 抛错 → rollback + pop 栈
 *  5. 嵌套 withTransaction → 抛错(不支持嵌套)
 *  6. 串行多个 withTransaction → 栈深度恢复 0
 *  7. srcAdapter / dstAdapter 实例隔离(各自独立 _txStack)
 *  8. beginTransaction/commit/rollback 手动模式也能正确管理栈
 *  9. rollback 无活跃事务 → 静默 no-op(与 PG 超时对齐)
 * 10. countWhere 在事务内读得到未 commit 的写(关键正确性保证)
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { MemorySQLiteAdapter } from '../../migrations/__tests__/memoryAdapter.js';

let db;
let adapter;

beforeEach(() => {
    db = new DatabaseSync(':memory:');
    adapter = new MemorySQLiteAdapter(db);
    db.exec('CREATE TABLE test_t (id INTEGER PRIMARY KEY, val TEXT)');
});

afterEach(() => {
    try {
        db?.close();
    } catch {
        /* ignore */
    }
    db = undefined;
    adapter = undefined;
});

describe('栈式事务上下文', () => {
    test('事务外调用:栈空,_txStack 不影响行为', async () => {
        expect(adapter._txStack).toHaveLength(0);
        await adapter.insert('test_t', { id: 1, val: 'a' });
        expect(adapter._txStack).toHaveLength(0);
        const rows = await adapter.select('test_t', ['id']);
        expect(rows).toEqual([[1]]);
    });

    test('withTransaction 体内 insert 自动走事务连接', async () => {
        await adapter.withTransaction(async () => {
            expect(adapter._txStack).toHaveLength(1);
            await adapter.insert('test_t', { id: 1, val: 'in-tx' });
        });
        expect(adapter._txStack).toHaveLength(0);
        const rows = await adapter.select('test_t', ['val']);
        expect(rows).toEqual([['in-tx']]);
    });

    test('withTransaction 成功 → commit + 栈恢复 0', async () => {
        await adapter.withTransaction(async () => {
            await adapter.insert('test_t', { id: 1, val: 'committed' });
        });
        expect(adapter._txStack).toHaveLength(0);
        const count = await adapter.countWhere('test_t');
        expect(count).toBe(1);
    });

    test('withTransaction 抛错 → rollback + 栈恢复 0', async () => {
        await expect(
            adapter.withTransaction(async () => {
                await adapter.insert('test_t', { id: 1, val: 'will-rollback' });
                throw new Error('boom');
            })
        ).rejects.toThrow('boom');
        expect(adapter._txStack).toHaveLength(0);
        const count = await adapter.countWhere('test_t');
        expect(count).toBe(0);
    });

    test('嵌套 withTransaction → 抛错', async () => {
        await expect(
            adapter.withTransaction(async () => {
                await adapter.withTransaction(async () => {});
            })
        ).rejects.toThrow(/嵌套/);
        expect(adapter._txStack).toHaveLength(0);
    });

    test('嵌套 beginTransaction → 抛错', async () => {
        await adapter.beginTransaction();
        expect(adapter._txStack).toHaveLength(1);
        await expect(adapter.beginTransaction()).rejects.toThrow(/嵌套/);
        await adapter.rollback(adapter._txStack[0] ?? 0);
        expect(adapter._txStack).toHaveLength(0);
    });

    test('串行多个 withTransaction → 栈深度恢复 0', async () => {
        await adapter.withTransaction(async () => {
            await adapter.insert('test_t', { id: 1, val: 'tx1' });
        });
        expect(adapter._txStack).toHaveLength(0);
        await adapter.withTransaction(async () => {
            await adapter.insert('test_t', { id: 2, val: 'tx2' });
        });
        expect(adapter._txStack).toHaveLength(0);
        const count = await adapter.countWhere('test_t');
        expect(count).toBe(2);
    });
});

describe('手动 beginTransaction / commit / rollback', () => {
    test('手动模式也能正确管理栈', async () => {
        const connId = await adapter.beginTransaction();
        expect(typeof connId).toBe('number');
        expect(adapter._txStack).toHaveLength(1);
        await adapter.insert('test_t', { id: 1, val: 'manual' });
        await adapter.commit(connId);
        expect(adapter._txStack).toHaveLength(0);
        const count = await adapter.countWhere('test_t');
        expect(count).toBe(1);
    });

    test('手动 rollback 清栈', async () => {
        const connId = await adapter.beginTransaction();
        expect(adapter._txStack).toHaveLength(1);
        await adapter.insert('test_t', { id: 1, val: 'will-rollback' });
        await adapter.rollback(connId);
        expect(adapter._txStack).toHaveLength(0);
        const count = await adapter.countWhere('test_t');
        expect(count).toBe(0);
    });

    test('rollback 无活跃事务 → 静默 no-op(不抛错)', async () => {
        // connId=999 不存在,_doRollback 容忍 no transaction 错误
        await expect(adapter.rollback(999)).resolves.toBeUndefined();
        expect(adapter._txStack).toHaveLength(0);
    });
});

describe('实例隔离(srcAdapter vs dstAdapter)', () => {
    test('两个 adapter 实例的 _txStack 独立', async () => {
        const db2 = new DatabaseSync(':memory:');
        const adapter2 = new MemorySQLiteAdapter(db2);
        db2.exec('CREATE TABLE test_t (id INTEGER PRIMARY KEY, val TEXT)');

        await adapter.beginTransaction();
        await adapter2.beginTransaction();

        expect(adapter._txStack).toHaveLength(1);
        expect(adapter2._txStack).toHaveLength(1);
        expect(adapter._txStack).not.toBe(adapter2._txStack);

        // adapter 的事务不影响 adapter2
        await adapter.insert('test_t', { id: 1, val: 'a1' });
        await adapter2.insert('test_t', { id: 1, val: 'a2' });

        await adapter.commit(adapter._txStack[0]);
        await adapter2.rollback(adapter2._txStack[0]);

        expect(adapter._txStack).toHaveLength(0);
        expect(adapter2._txStack).toHaveLength(0);

        const count1 = await adapter.countWhere('test_t');
        const count2 = await adapter2.countWhere('test_t');
        expect(count1).toBe(1);  // committed
        expect(count2).toBe(0);  // rolled back

        db2.close();
    });
});

describe('事务内读未 commit 的写(关键正确性)', () => {
    test('countWhere 在事务内读得到未 commit 的 insert', async () => {
        await adapter.withTransaction(async () => {
            await adapter.insert('test_t', { id: 1, val: 'uncommitted' });
            await adapter.insert('test_t', { id: 2, val: 'uncommitted2' });
            // 事务内 count 应读到 2(走同一连接,读得到未 commit 的写)
            const count = await adapter.countWhere('test_t');
            expect(count).toBe(2);
        });
        // 事务外 count 也应是 2(已 commit)
        const count = await adapter.countWhere('test_t');
        expect(count).toBe(2);
    });

    test('select 在事务内读得到未 commit 的 insert', async () => {
        await adapter.withTransaction(async () => {
            await adapter.insert('test_t', { id: 1, val: 'uncommitted' });
            const rows = await adapter.select('test_t', ['val']);
            expect(rows).toEqual([['uncommitted']]);
        });
    });

    test('事务 rollback 后,事务内的写不可见', async () => {
        await adapter.withTransaction(async () => {
            await adapter.insert('test_t', { id: 1, val: 'will-rollback' });
            const count = await adapter.countWhere('test_t');
            expect(count).toBe(1);  // 事务内可见
            throw new Error('rollback-test');
        }).catch(() => {});
        const count = await adapter.countWhere('test_t');
        expect(count).toBe(0);  // 回滚后不可见
    });
});

describe('withTransaction 返回值', () => {
    test('withTransaction 透传 fn 的返回值', async () => {
        const result = await adapter.withTransaction(async () => {
            await adapter.insert('test_t', { id: 1, val: 'a' });
            return 'success';
        });
        expect(result).toBe('success');
    });

    test('withTransaction 透传 fn 的对象返回值', async () => {
        const result = await adapter.withTransaction(async () => {
            return { copied: 42, errors: [] };
        });
        expect(result).toEqual({ copied: 42, errors: [] });
    });
});