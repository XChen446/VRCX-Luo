/**
 * onTableChange 完备层(计数器轮询)单元测试。
 *
 * 两层覆盖:
 * 1. 确定性机制测试(FakeCounterAdapter 覆写 _readChangeCounter 用可控
 *    计数器驱动):订阅/退订生命周期、共享定时器启停、基线建立、版本
 *    前进触发全部订阅表失效(count=-1)、_syncChangeBaseline 基线去重、
 *    订阅方异常隔离、基类 no-op 默认。
 * 2. 真实语义测试(同一 SQLite 文件双连接):MemorySQLiteAdapter + 外部
 *    写者连接,验证"他写者提交 → data_version 前进 → 轮询触发"。
 *
 * 单连接内存库无法用于真实语义:data_version 是"他写者视角"计数器,
 * 本连接读不到自己提交的递增(详见 SQLiteAdapter._readChangeCounter
 * 与 docs/architecture/ADAPTER_API.md §9)。
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineAdapter, setChangeGateHook } from '../EngineAdapter.js';
import { SQLiteAdapter } from '../SQLiteAdapter.js';
import { MemorySQLiteAdapter } from '../../migrations/__tests__/memoryAdapter.js';

// ── 测试替身 ────────────────────────────────────────────────────────────

/** 最小子类:不覆写计数器 → onTableChange 应退化为 no-op。 */
class NoCounterAdapter extends EngineAdapter {}

/**
 * 可控计数器子类:测试辅助 bump() 模拟一次"他写者提交"。
 */
class FakeCounterAdapter extends SQLiteAdapter {
    /** @param {number} [version] */
    constructor(version = 0) {
        super();
        /** @type {number} */
        this._version = version;
    }

    /** @override @protected */
    async _readChangeCounter() {
        return this._version;
    }

    /** 测试辅助:模拟一次他写者提交(计数器 +1) */
    bump() {
        this._version += 1;
    }
}

describe('onTableChange — 订阅生命周期', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('首个订阅启动共享定时器,全部退订后停止', () => {
        const adapter = new FakeCounterAdapter();
        expect(vi.getTimerCount()).toBe(0);
        const unsub1 = adapter.onTableChange('feed_gps', vi.fn());
        expect(vi.getTimerCount()).toBe(1);
        const unsub2 = adapter.onTableChange('feed_status', vi.fn());
        expect(vi.getTimerCount()).toBe(1); // 共享同一轮询定时器
        unsub1();
        expect(vi.getTimerCount()).toBe(1);
        unsub2();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('参数校验:空表名 / 非函数回调抛 TypeError', () => {
        const adapter = new FakeCounterAdapter();
        expect(() => adapter.onTableChange('', vi.fn())).toThrow(TypeError);
        expect(() => adapter.onTableChange('feed_gps', null)).toThrow(TypeError);
        expect(() => adapter.onTableChange('feed_gps', 'nope')).toThrow(TypeError);
    });

    it('实例级隔离:两个实例的订阅互不串扰', () => {
        const a = new FakeCounterAdapter();
        const b = new FakeCounterAdapter();
        const cbA = vi.fn();
        a.onTableChange('feed_gps', cbA);
        expect(vi.getTimerCount()).toBe(1);
        b.onTableChange('feed_gps', cbA);
        expect(vi.getTimerCount()).toBe(2); // 每实例独立定时器
    });
});

describe('onTableChange — 完备层触发语义', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('首轮轮询只建基线不触发;版本前进触发全部订阅表(count=-1)', async () => {
        const adapter = new FakeCounterAdapter(10);
        const cb1 = vi.fn();
        const cb2 = vi.fn();
        adapter.onTableChange('feed_gps', cb1);
        adapter.onTableChange('feed_status', cb2);

        await vi.advanceTimersByTimeAsync(EngineAdapter.CHANGE_POLL_MS);
        expect(cb1).not.toHaveBeenCalled(); // 首轮:基线建立

        adapter.bump(); // 他写者提交
        await vi.advanceTimersByTimeAsync(EngineAdapter.CHANGE_POLL_MS);
        expect(cb1).toHaveBeenCalledTimes(1);
        expect(cb1).toHaveBeenCalledWith(
            expect.objectContaining({ table: 'feed_gps', count: -1 })
        );
        expect(cb2).toHaveBeenCalledTimes(1);

        // 基线已同步:同一版本不再重复触发
        await vi.advanceTimersByTimeAsync(EngineAdapter.CHANGE_POLL_MS * 2);
        expect(cb1).toHaveBeenCalledTimes(1);
    });

    it('_syncChangeBaseline 吸收自写(漏斗事件),版本前进不再触发完备层', async () => {
        const adapter = new FakeCounterAdapter(10);
        const cb = vi.fn();
        adapter.onTableChange('feed_gps', cb);

        await vi.advanceTimersByTimeAsync(EngineAdapter.CHANGE_POLL_MS); // 基线
        adapter.bump(); // 自写:版本前进
        adapter._syncChangeBaseline(adapter._version); // 漏斗事件携带快照

        await vi.advanceTimersByTimeAsync(EngineAdapter.CHANGE_POLL_MS);
        expect(cb).not.toHaveBeenCalled(); // 被基线吸收,无多余失效
    });

    it('退订最后一个订阅者后写入不再触发;重新订阅重建基线', async () => {
        const adapter = new FakeCounterAdapter(10);
        const cb = vi.fn();
        const unsub = adapter.onTableChange('feed_gps', cb);
        await vi.advanceTimersByTimeAsync(EngineAdapter.CHANGE_POLL_MS); // 基线

        unsub();
        adapter.bump();
        await vi.advanceTimersByTimeAsync(EngineAdapter.CHANGE_POLL_MS * 2);
        expect(cb).not.toHaveBeenCalled();

        // 重新订阅:重建基线后新写入正常触发
        const cb2 = vi.fn();
        adapter.onTableChange('feed_gps', cb2);
        await vi.advanceTimersByTimeAsync(EngineAdapter.CHANGE_POLL_MS); // 重建基线
        adapter.bump();
        await vi.advanceTimersByTimeAsync(EngineAdapter.CHANGE_POLL_MS);
        expect(cb2).toHaveBeenCalledTimes(1);
    });

    it('订阅方抛异常不阻断其他订阅者与轮询循环', async () => {
        const adapter = new FakeCounterAdapter(10);
        const bad = vi.fn(() => {
            throw new Error('boom');
        });
        const good = vi.fn();
        adapter.onTableChange('feed_gps', bad);
        adapter.onTableChange('feed_status', good);

        await vi.advanceTimersByTimeAsync(EngineAdapter.CHANGE_POLL_MS); // 基线
        adapter.bump();
        await vi.advanceTimersByTimeAsync(EngineAdapter.CHANGE_POLL_MS);
        expect(good).toHaveBeenCalledTimes(1);
        expect(bad).toHaveBeenCalledTimes(1);
    });
});

describe('onTableChange — 基类 no-op 默认(不覆写计数器)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('订阅合法、定时器按订阅驱动,但永不触发', async () => {
        const adapter = new NoCounterAdapter();
        const cb = vi.fn();
        adapter.onTableChange('feed_gps', cb);
        expect(vi.getTimerCount()).toBe(1);
        await vi.advanceTimersByTimeAsync(EngineAdapter.CHANGE_POLL_MS * 3);
        expect(cb).not.toHaveBeenCalled();
    });
});

describe('onTableChange — C# 门控钩子(F6)', () => {
    /** @type {ReturnType<typeof vi.fn>} */
    let hook;

    beforeEach(() => {
        vi.useFakeTimers();
        hook = vi.fn();
        setChangeGateHook(hook);
    });

    afterEach(() => {
        setChangeGateHook(null);
        vi.useRealTimers();
    });

    it('首个订阅 → hook(true) 恰好 1 次;第二实例再订阅不再调用', () => {
        const a = new FakeCounterAdapter();
        const b = new FakeCounterAdapter();
        const unsubA = a.onTableChange('feed_gps', vi.fn());
        expect(hook).toHaveBeenCalledTimes(1);
        expect(hook).toHaveBeenCalledWith(true);

        b.onTableChange('feed_gps', vi.fn());
        expect(hook).toHaveBeenCalledTimes(1); // 计数非 0→1,不重复开启

        unsubA();
        expect(hook).toHaveBeenCalledTimes(1); // 计数未归零,不关闭
    });

    it('交错退订计数不归零期间无调用', () => {
        const a = new FakeCounterAdapter();
        const b = new FakeCounterAdapter();
        const ua1 = a.onTableChange('feed_gps', vi.fn());
        const ua2 = a.onTableChange('feed_status', vi.fn());
        const ub1 = b.onTableChange('feed_gps', vi.fn());
        expect(hook).toHaveBeenCalledTimes(1);

        ua1();
        expect(hook).toHaveBeenCalledTimes(1);
        ua2();
        expect(hook).toHaveBeenCalledTimes(1);
        ub1();
        expect(hook).toHaveBeenCalledTimes(2);
        expect(hook).toHaveBeenLastCalledWith(false);
    });

    it('全部退订 → hook(false) 1 次', () => {
        const a = new FakeCounterAdapter();
        const ua1 = a.onTableChange('feed_gps', vi.fn());
        const ua2 = a.onTableChange('feed_status', vi.fn());
        expect(hook).toHaveBeenCalledTimes(1);

        ua1();
        expect(hook).toHaveBeenCalledTimes(1);
        ua2();
        expect(hook).toHaveBeenCalledTimes(2);
        expect(hook).toHaveBeenLastCalledWith(false);
    });

    it('同表多回调退订交错 → 计数不失衡(add 去重免疫)', () => {
        const a = new FakeCounterAdapter();
        const u1 = a.onTableChange('feed_gps', vi.fn());
        const u2 = a.onTableChange('feed_gps', vi.fn()); // 同表第二个回调:表项已存在
        expect(hook).toHaveBeenCalledTimes(1); // 计数按实例×表项,不重复 +1

        u1();
        expect(hook).toHaveBeenCalledTimes(1); // set 仍非空,不减
        u2();
        expect(hook).toHaveBeenCalledTimes(2); // 表项清空 → 归零关闭
        expect(hook).toHaveBeenLastCalledWith(false);

        // 失衡校验:再订阅再全退订,门控仍正常往返
        const u3 = a.onTableChange('feed_gps', vi.fn());
        expect(hook).toHaveBeenCalledTimes(3);
        expect(hook).toHaveBeenLastCalledWith(true);
        u3();
        expect(hook).toHaveBeenCalledTimes(4);
        expect(hook).toHaveBeenLastCalledWith(false);
    });

    it('同 cb 双订阅双退订幂等 → 计数不失衡,再订阅可重开门控', () => {
        const a = new FakeCounterAdapter();
        const cb = vi.fn();
        const u1 = a.onTableChange('feed_gps', cb);
        const u2 = a.onTableChange('feed_gps', cb); // 同引用再订阅:Set 去重,计数不重复 +1
        expect(hook).toHaveBeenCalledTimes(1);
        expect(hook).toHaveBeenLastCalledWith(true);

        u1(); // 表项清空 → 计数归零 → 关闭门控
        expect(hook).toHaveBeenCalledTimes(2);
        expect(hook).toHaveBeenLastCalledWith(false);

        u2(); // 重复退订:幂等早退,不得再次 -1(修复前计数 → -1)
        expect(hook).toHaveBeenCalledTimes(2); // 无额外调用

        // 失衡校验:再订阅 → hook(true) 必须再次触发(修复前计数 -1→0,永不触发)
        const u3 = a.onTableChange('feed_gps', cb);
        expect(hook).toHaveBeenCalledTimes(3);
        expect(hook).toHaveBeenLastCalledWith(true);
        u3();
        expect(hook).toHaveBeenCalledTimes(4);
        expect(hook).toHaveBeenLastCalledWith(false);

        expect(hook.mock.calls.map(([v]) => v)).toEqual([
            true,
            false,
            true,
            false
        ]);
    });

    it('已退订闭包重复调用幂等:无 hook 调用、无异常', () => {
        const a = new FakeCounterAdapter();
        const unsub = a.onTableChange('feed_gps', vi.fn());
        expect(hook).toHaveBeenCalledTimes(1);

        unsub();
        expect(hook).toHaveBeenCalledTimes(2);
        expect(hook).toHaveBeenLastCalledWith(false);

        expect(() => unsub()).not.toThrow(); // 再调用:静默幂等
        expect(() => unsub()).not.toThrow();
        expect(hook).toHaveBeenCalledTimes(2); // 无额外门控调用
    });
});

describe('onTableChange — 漏斗事件路由(实时层)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('匹配 table 的事件实时触发该表回调(表级粒度,毫秒级)', () => {
        const adapter = new FakeCounterAdapter(10);
        const cbA = vi.fn();
        const cbB = vi.fn();
        adapter.onTableChange('abc_feed_gps', cbA);
        adapter.onTableChange('abc_feed_status', cbB);

        adapter._onFunnelEvent({
            table: 'abc_feed_gps',
            count: 3,
            ts: 1234,
            dv: 11
        });
        expect(cbA).toHaveBeenCalledTimes(1);
        expect(cbA).toHaveBeenCalledWith({
            table: 'abc_feed_gps',
            count: 3,
            ts: 1234
        });
        expect(cbB).not.toHaveBeenCalled();
    });

    it('未订阅/未知 table 的事件仅同步基线,不打扰订阅方', () => {
        const adapter = new FakeCounterAdapter(10);
        const cb = vi.fn();
        adapter.onTableChange('abc_feed_gps', cb);
        adapter._onFunnelEvent({ table: 'xyz_other', count: 1, ts: 1, dv: 11 });
        expect(cb).not.toHaveBeenCalled();
    });

    it('漏斗事件携带 dv → 基线推进,完备层轮询不再兜底触发', async () => {
        const adapter = new FakeCounterAdapter(10);
        const cb = vi.fn();
        adapter.onTableChange('abc_feed_gps', cb);

        await vi.advanceTimersByTimeAsync(EngineAdapter.CHANGE_POLL_MS); // 基线 10
        adapter.bump(); // 自写:版本 11
        adapter._onFunnelEvent({ table: 'abc_feed_gps', count: 1, ts: 1, dv: 11 });

        await vi.advanceTimersByTimeAsync(EngineAdapter.CHANGE_POLL_MS);
        // 只收到漏斗事件本身,无完备层兜底重复触发
        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb).toHaveBeenCalledWith(
            expect.objectContaining({ count: 1 })
        );
    });

    it('count 缺失时回退 -1(全量失效提示)', () => {
        const adapter = new FakeCounterAdapter(10);
        const cb = vi.fn();
        adapter.onTableChange('abc_feed_gps', cb);
        adapter._onFunnelEvent({ table: 'abc_feed_gps', ts: 1 });
        expect(cb).toHaveBeenCalledWith(
            expect.objectContaining({ count: -1 })
        );
    });

    it('无 dv 的事件(外部文件连接)不推进基线', async () => {
        const adapter = new FakeCounterAdapter(10);
        const cb = vi.fn();
        adapter.onTableChange('abc_feed_gps', cb);
        await vi.advanceTimersByTimeAsync(EngineAdapter.CHANGE_POLL_MS); // 基线 10
        adapter._onFunnelEvent({ table: 'abc_feed_gps', count: 1, ts: 1 }); // dv 缺失
        adapter.bump(); // 版本 11(无事件覆盖)
        await vi.advanceTimersByTimeAsync(EngineAdapter.CHANGE_POLL_MS);
        // 漏斗事件 1 次 + 兜底 1 次
        expect(cb).toHaveBeenCalledTimes(2);
    });
});

describe('wireFunnelEvents — 桥事件按 conn 路由(adapter/index.js)', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('绑定 SQLite/PostgreSQL/MySQL 三桥的 add_DatabaseChanged', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('SQLite', { add_DatabaseChanged: vi.fn() });
        vi.stubGlobal('PostgreSQL', { add_DatabaseChanged: vi.fn() });
        vi.stubGlobal('MySQL', { add_DatabaseChanged: vi.fn() });

        const { wireFunnelEvents } = await import('../index.js');
        wireFunnelEvents();
        expect(globalThis.SQLite.add_DatabaseChanged).toHaveBeenCalledTimes(1);
        expect(globalThis.PostgreSQL.add_DatabaseChanged).toHaveBeenCalledTimes(1);
        expect(globalThis.MySQL.add_DatabaseChanged).toHaveBeenCalledTimes(1);
    });

    it('conn=default 的事件路由到单例 adapter 的订阅', async () => {
        vi.useFakeTimers();
        const handler = vi.fn();
        const stub = { add_DatabaseChanged: vi.fn((fn) => handler.mockImplementation(fn)) };
        vi.stubGlobal('SQLite', stub);

        const { wireFunnelEvents, adapter } = await import('../index.js');
        wireFunnelEvents();
        const bridgeHandler = globalThis.SQLite.add_DatabaseChanged.mock.calls[0][0];

        const cb = vi.fn();
        const unsub = adapter.onTableChange('abc_feed_gps', cb);
        bridgeHandler(JSON.stringify({ conn: 'default', table: 'abc_feed_gps', count: 5, ts: 9, dv: 3 }));
        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb).toHaveBeenCalledWith({ table: 'abc_feed_gps', count: 5, ts: 9 });

        // 未知 conn(外部文件)→ 丢弃
        bridgeHandler(JSON.stringify({ conn: 'other.db', table: 'abc_feed_gps', count: 1, ts: 1, dv: 3 }));
        expect(cb).toHaveBeenCalledTimes(1);
        unsub(); // 保持模块级门控计数归零,避免污染后续 F6 用例
    });

    it('createAdapter(sqlite) 注册 _changeInstances:外部文件事件按 conn 路由,未知 conn 丢弃', async () => {
        vi.useFakeTimers();
        const stub = { add_DatabaseChanged: vi.fn() };
        vi.stubGlobal('SQLite', stub);

        const { wireFunnelEvents, createAdapter } = await import('../index.js');
        wireFunnelEvents();
        const bridgeHandler =
            globalThis.SQLite.add_DatabaseChanged.mock.calls[0][0];

        const instance = await createAdapter({
            connection: 'sqlite:///C:/tmp/x.db'
        });
        expect(instance.connectionString).toBeTruthy();

        const cb = vi.fn();
        const unsub = instance.onTableChange('x', cb);
        bridgeHandler(
            JSON.stringify({
                conn: instance.connectionString,
                table: 'x',
                count: 1,
                ts: 0,
                dv: null
            })
        );
        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb).toHaveBeenCalledWith({ table: 'x', count: 1, ts: 0 });

        // 未知 conn(未注册实例)→ 丢弃
        bridgeHandler(
            JSON.stringify({
                conn: 'unknown.db',
                table: 'x',
                count: 1,
                ts: 0,
                dv: null
            })
        );
        expect(cb).toHaveBeenCalledTimes(1);
        unsub(); // 保持模块级门控计数归零,避免污染后续 F6 用例
    });

    it('Electron 运行时(window.electron.onDbChange)走 onDbChange 通道,不走 add_DatabaseChanged', async () => {
        vi.useFakeTimers();
        const onDbChange = vi.fn();
        const savedElectron = window.electron;
        window.electron = { onDbChange };
        try {
            const { wireFunnelEvents, adapter } = await import('../index.js');
            wireFunnelEvents();
            expect(onDbChange).toHaveBeenCalledTimes(1);

            const handler = onDbChange.mock.calls[0][0];
            const cb = vi.fn();
            const unsub = adapter.onTableChange('abc_feed_gps', cb);
            handler('{"conn":"default","table":"abc_feed_gps","count":2,"ts":5,"dv":3}');
            expect(cb).toHaveBeenCalledTimes(1);
            expect(cb).toHaveBeenCalledWith({
                table: 'abc_feed_gps',
                count: 2,
                ts: 5
            });
            unsub(); // 保持模块级门控计数归零,避免污染后续 F6 用例
        } finally {
            window.electron = savedElectron;
        }
    });

    it('initAdapter 启动关闭门控,订阅/退订经桥扇出(三桥 SetChangeEnabled)', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('SQLite', {
            add_DatabaseChanged: vi.fn(),
            SetChangeEnabled: vi.fn()
        });
        vi.stubGlobal('PostgreSQL', {
            add_DatabaseChanged: vi.fn(),
            SetChangeEnabled: vi.fn()
        });
        vi.stubGlobal('MySQL', {
            add_DatabaseChanged: vi.fn(),
            SetChangeEnabled: vi.fn()
        });

        const { initAdapter, adapter } = await import('../index.js');
        await initAdapter('sqlite');
        expect(globalThis.SQLite.SetChangeEnabled).toHaveBeenCalledTimes(1);
        expect(globalThis.SQLite.SetChangeEnabled).toHaveBeenCalledWith(false);
        expect(globalThis.PostgreSQL.SetChangeEnabled).toHaveBeenCalledTimes(1);
        expect(globalThis.PostgreSQL.SetChangeEnabled).toHaveBeenCalledWith(
            false
        );
        expect(globalThis.MySQL.SetChangeEnabled).toHaveBeenCalledTimes(1);
        expect(globalThis.MySQL.SetChangeEnabled).toHaveBeenCalledWith(false);

        const unsub = adapter.onTableChange('abc_feed_gps', vi.fn());
        expect(globalThis.SQLite.SetChangeEnabled).toHaveBeenLastCalledWith(
            true
        );
        expect(globalThis.PostgreSQL.SetChangeEnabled).toHaveBeenLastCalledWith(
            true
        );
        expect(globalThis.MySQL.SetChangeEnabled).toHaveBeenLastCalledWith(
            true
        );

        unsub();
        expect(globalThis.SQLite.SetChangeEnabled).toHaveBeenLastCalledWith(
            false
        );
        expect(globalThis.PostgreSQL.SetChangeEnabled).toHaveBeenLastCalledWith(
            false
        );
        expect(globalThis.MySQL.SetChangeEnabled).toHaveBeenLastCalledWith(
            false
        );
    });

    it('桥无 SetChangeEnabled(旧版)时 initAdapter 不抛,事件恒发', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('SQLite', { add_DatabaseChanged: vi.fn() });
        vi.stubGlobal('PostgreSQL', { add_DatabaseChanged: vi.fn() });
        vi.stubGlobal('MySQL', { add_DatabaseChanged: vi.fn() });

        const { initAdapter } = await import('../index.js');
        await expect(initAdapter('sqlite')).resolves.toBeDefined();
    });
});

describe('onTableChange — SQLite data_version 真实语义(双连接文件库)', () => {
    /** @type {string} */
    let dir;
    /** @type {string} */
    let file;
    /** @type {DatabaseSync | undefined} */
    let db1;
    /** @type {MemorySQLiteAdapter | undefined} */
    let adapter;
    /** @type {DatabaseSync | undefined} */
    let db2;

    beforeEach(async () => {
        vi.useFakeTimers();
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dv-'));
        file = path.join(dir, 'test.db');
        db1 = new DatabaseSync(file);
        adapter = new MemorySQLiteAdapter(db1);
        await adapter.executeNonQuery(
            'CREATE TABLE feed_gps (id INTEGER PRIMARY KEY, x TEXT)'
        );
        db2 = new DatabaseSync(file); // 外部写者连接
    });

    afterEach(() => {
        vi.useRealTimers();
        try {
            db2?.close();
        } catch {
            /* ignore */
        }
        try {
            db1?.close();
        } catch {
            /* ignore */
        }
        db1 = undefined;
        db2 = undefined;
        adapter = undefined;
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('_readChangeCounter 能观察到外部连接提交的递增', async () => {
        const v1 = await adapter._readChangeCounter();
        db2.prepare('INSERT INTO feed_gps (x) VALUES (?)').run('external');
        const v2 = await adapter._readChangeCounter();
        expect(v2).toBeGreaterThan(v1);
    });

    it('外部连接提交 → data_version 前进 → 轮询触发全量失效', async () => {
        const cb = vi.fn();
        adapter.onTableChange('feed_gps', cb);

        await vi.advanceTimersByTimeAsync(EngineAdapter.CHANGE_POLL_MS); // 基线建立
        expect(cb).not.toHaveBeenCalled();

        db2.prepare('INSERT INTO feed_gps (x) VALUES (?)').run('external');
        await vi.advanceTimersByTimeAsync(EngineAdapter.CHANGE_POLL_MS);
        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb).toHaveBeenCalledWith(
            expect.objectContaining({ table: 'feed_gps', count: -1 })
        );

        // 无新提交:不再触发
        await vi.advanceTimersByTimeAsync(EngineAdapter.CHANGE_POLL_MS * 2);
        expect(cb).toHaveBeenCalledTimes(1);
    });
});

describe('SQLiteAdapter._readChangeCounter — 观察连接桥(F7)', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('默认实例经桥读观察连接:GetDataVersion 调用 1 次,不走池路径', async () => {
        vi.useFakeTimers();
        const getDv = vi.fn().mockResolvedValue(42);
        vi.stubGlobal('SQLite', { GetDataVersion: getDv });

        const adapter = new SQLiteAdapter();
        await expect(adapter._readChangeCounter()).resolves.toBe(42);
        expect(getDv).toHaveBeenCalledTimes(1);
        // mock 无 Execute——若回退池路径会 TypeError,隐式证明未走池路径
    });

    it('GetDataVersion 返回 null → null', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('SQLite', {
            GetDataVersion: vi.fn().mockResolvedValue(null)
        });

        const adapter = new SQLiteAdapter();
        await expect(adapter._readChangeCounter()).resolves.toBeNull();
    });

    it('外部实例(connectionString)不走桥,经 ExecuteJsonOnConnection 读池路径', async () => {
        vi.useFakeTimers();
        const execJson = vi.fn().mockResolvedValue('[[42]]');
        vi.stubGlobal('SQLite', {
            ExecuteJsonOnConnection: execJson
        });

        const adapter = new SQLiteAdapter({
            connection: 'sqlite:///C:/tmp/x.db'
        });
        await expect(adapter._readChangeCounter()).resolves.toBe(42);
        expect(execJson).toHaveBeenCalledTimes(1);
        expect(execJson).toHaveBeenCalledWith(
            adapter.connectionString,
            'PRAGMA data_version',
            undefined,
            undefined
        );
        // 桥无 GetDataVersion → 未走观察连接
        expect(execJson.mock.calls[0][0]).toBe(adapter.connectionString);
    });

    it('GetDataVersion 抛异常 → 回退池路径(Execute)', async () => {
        vi.useFakeTimers();
        const exec = vi.fn().mockResolvedValue([[7]]);
        vi.stubGlobal('SQLite', {
            GetDataVersion: vi.fn().mockRejectedValue(new Error('boom')),
            Execute: exec
        });

        const adapter = new SQLiteAdapter();
        await expect(adapter._readChangeCounter()).resolves.toBe(7);
        expect(exec).toHaveBeenCalledTimes(1);
        expect(exec).toHaveBeenCalledWith(
            'PRAGMA data_version',
            undefined,
            undefined
        );
    });
});
