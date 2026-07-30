/**
 * SQLiteAdapter connectionString 模式 connId 路由测试。
 *
 * 验证 connectionString 模式下 withTransaction 体内的写操作
 * 经过 ExecuteNonQueryOnConnection(带 connId)路由到 pinned 路径,
 * 而非 fresh-conn 路径(传 connectionString 不带 connId)。
 *
 * 测试策略:
 *   - mock 全局 SQLite 对象为 vi.fn()记录调用参数
 *   - 构造真实 SQLiteAdapter({connection: 'sqlite:///tmp/test.db'})
 *   - 验证 _doBegin 调 SQLite.BeginTransaction(connectionString)
 *   - 验证事务外 executeNonQuery 调 SQLite.ExecuteNonQueryOnConnection(connectionString, sql, args)
 *   - 验证 withTransaction 体内 executeNonQuery 调 SQLite.ExecuteNonQueryOnConnection(connectionString, sql, args, connId) (带 connId 路由到 pinned 路径)
 *   - 验证无 connectionString 的 SQLiteAdapter 调 SQLite.BeginTransaction() (无参)
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { SQLiteAdapter } from '../SQLiteAdapter.js';

// ── Mock 全局 SQLite ──────────────────────────────────────────────────────

const mockFns = {
    Execute: vi.fn(() => Promise.resolve([])),
    ExecuteJson: vi.fn(() => Promise.resolve('[]')),
    ExecuteNonQuery: vi.fn(() => Promise.resolve(0)),
    ExecuteJsonOnConnection: vi.fn(() => Promise.resolve('[]')),
    ExecuteNonQueryOnConnection: vi.fn(() => Promise.resolve(0)),
    BeginTransaction: vi.fn(() => Promise.resolve(1)),
    CommitTransaction: vi.fn(),
    RollbackTransaction: vi.fn(),
    KeepAliveTransaction: vi.fn(() => true),
    GetPoolStats: vi.fn(() => Promise.resolve('{}')),
    ClearIdleConnections: vi.fn(() => Promise.resolve()),
    IsConnected: vi.fn(() => Promise.resolve(true)),
    Ping: vi.fn(() => Promise.resolve(true)),
    GetHealth: vi.fn(() => Promise.resolve('{}'))
};

const origSQLite = globalThis.SQLite;

// ── 测试 ──────────────────────────────────────────────────────────────────

describe('SQLiteAdapter connectionString 模式 connId 路由', () => {
    let adapter;

    beforeEach(() => {
        vi.clearAllMocks();
        globalThis.SQLite = mockFns;
        // connectionString 模式(如 pullEngine dstAdapter)
        adapter = new SQLiteAdapter({ connection: 'sqlite:///tmp/test_pull.db' });
    });

    afterEach(() => {
        adapter = undefined;
        globalThis.SQLite = origSQLite;
    });

    test('_doBegin:connectionString 模式调 SQLite.BeginTransaction(connectionString)', async () => {
        await adapter._doBegin();
        expect(mockFns.BeginTransaction).toHaveBeenCalledTimes(1);
        // 必须带 connectionString 参数(目标文件)
        expect(mockFns.BeginTransaction).toHaveBeenCalledWith(
            expect.stringContaining('tmp')
        );
    });

    test('事务外 executeNonQuery:走 fresh-conn 路径(传 connectionString 不带 connId)', async () => {
        await adapter.executeNonQuery('INSERT INTO t (id) VALUES (1)');
        expect(mockFns.ExecuteNonQueryOnConnection).toHaveBeenCalledTimes(1);
        const callArgs = mockFns.ExecuteNonQueryOnConnection.mock.calls[0];
        // 第 1 个参数是 connectionString,第 2 个是 sql,第 3 个是 args
        expect(callArgs[0]).toContain('tmp');
        expect(callArgs[1]).toBe('INSERT INTO t (id) VALUES (1)');
    });

    test('withTransaction 体内 executeNonQuery:走 pinned 路径(connectionString+connId)', async () => {
        await adapter.withTransaction(async () => {
            await adapter.executeNonQuery('INSERT INTO t (id) VALUES (1)');
        });
        expect(mockFns.ExecuteNonQueryOnConnection).toHaveBeenCalled();
        // 验证所有 executeNonQuery 调用都经过 ExecuteNonQueryOnConnection 且带了 connId(第 4 参数)
        for (const callArgs of mockFns.ExecuteNonQueryOnConnection.mock.calls) {
            // 第 1 参数是 resolved connectionString(不含 sqlite://)
            expect(typeof callArgs[0]).toBe('string');
            expect(callArgs[0]).not.toContain('sqlite://');
            // 第 2 参数是 sql
            expect(typeof callArgs[1]).toBe('string');
            // 第 4 参数是 connId(number)
            expect(typeof callArgs[3]).toBe('number');
        }
    });

    test('withTransaction 成功后 commit 调 SQLite.CommitTransaction(connId)', async () => {
        await adapter.withTransaction(async () => {
            await adapter.executeNonQuery('INSERT INTO t (id) VALUES (1)');
        });
        expect(mockFns.CommitTransaction).toHaveBeenCalledTimes(1);
        expect(typeof mockFns.CommitTransaction.mock.calls[0][0]).toBe('number');
    });

    test('withTransaction 抛错后 rollback 调 SQLite.RollbackTransaction(connId)', async () => {
        await expect(adapter.withTransaction(async () => {
            await adapter.executeNonQuery('INSERT INTO t (id) VALUES (1)');
            throw new Error('simulated failure');
        })).rejects.toThrow('simulated failure');
        expect(mockFns.RollbackTransaction).toHaveBeenCalledTimes(1);
        expect(typeof mockFns.RollbackTransaction.mock.calls[0][0]).toBe('number');
    });
});

describe('SQLiteAdapter 单例模式(无 connectionString)路由', () => {
    let adapter;

    beforeEach(() => {
        vi.clearAllMocks();
        globalThis.SQLite = mockFns;
        // 单例模式(无 connection 参数)
        adapter = new SQLiteAdapter({});
    });

    afterEach(() => {
        adapter = undefined;
        globalThis.SQLite = origSQLite;
    });

    test('_doBegin:单例模式调 SQLite.BeginTransaction() (无参)', async () => {
        await adapter._doBegin();
        expect(mockFns.BeginTransaction).toHaveBeenCalledTimes(1);
        // 无参调用
        expect(mockFns.BeginTransaction).toHaveBeenCalledWith();
    });

    test('事务外 executeNonQuery:走单例池(传 sql+args,connId=undefined)', async () => {
        await adapter.executeNonQuery('INSERT INTO t (id) VALUES (1)');
        expect(mockFns.ExecuteNonQuery).toHaveBeenCalledTimes(1);
        const callArgs = mockFns.ExecuteNonQuery.mock.calls[0];
        // 单例池路径:ExecuteNonQuery(sql, args, connId=undefined)
        expect(callArgs[0]).toBe('INSERT INTO t (id) VALUES (1)');
        expect(callArgs[2]).toBeUndefined();
    });
});
