// @vitest-environment node

/**
 * SQLite 并发写压力测试(WAL + busy_timeout)。
 *
 * 验证 SQLite 在 WAL 模式 + busy_timeout 下,多线程并发写同一 .db
 * 文件时,竞争写等待而非立即抛 SQLITE_BUSY。这是 PR #13 池化改造
 * (SQLite.cs 删除单连接 + ReaderWriterLockSlim,改用 ADO.NET 池化)
 * 的理论安全基础:SQLite 只支持一个并发写事务,但 busy_timeout
 * 让其他写连接阻塞等锁(最多 5s)而非立即失败。
 *
 * 测试策略:用 worker_threads 创建 N 个 Worker,每个 Worker 打开
 * 同一文件级 SQLite(WAL + busy_timeout=5000 + locking_mode=NORMAL),
 * 并发执行 M 次写事务。期望:
 *   1. 全部写事务成功(0 SQLITE_BUSY)—— busy_timeout 足够消化
 *      桌面场景的写竞争(事务 ms 级,5s 超时绰绰有余)。
 *   2. 总写入行数 === N × M(无丢失)。
 *
 * 局限性(详见 TODO):本测试用 node:sqlite 的 DatabaseSync 验证
 * SQLite WAL 并发写理论本身,不直接覆盖 C# System.Data.SQLite
 * 池化的并发写行为(那是不同的代码路径,需 C# 端测试项目)。
 * 但两者共享同一 SQLite 引擎(WAL/busy_timeout/locking_mode 是
 * 文件级 PRAGMA,与驱动无关),理论保证一致。
 *
 * 参见 PR #13 review #9。
 */

import { afterAll, describe, expect, test } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpDir;

afterAll(() => {
    if (tmpDir && existsSync(tmpDir)) {
        rmSync(tmpDir, { recursive: true, force: true });
    }
});

/**
 * 启动 N 个 Worker 并发写同一 .db 文件,每个 Worker 写 M 次事务。
 * @param {string} dbPath - 文件级 SQLite 路径
 * @param {number} numWorkers - Worker 数量
 * @param {number} writesPerWorker - 每个 Worker 的写事务次数
 * @returns {Promise<Array<{ok: number, busy: number, errors: string[]}>>}
 */
function runConcurrentWriters(dbPath, numWorkers, writesPerWorker) {
    const workerCode = `
        const { DatabaseSync } = require('node:sqlite');
        const { parentPort } = require('worker_threads');
        const dbPath = ${JSON.stringify(dbPath)};
        const writesPerWorker = ${writesPerWorker};

        const db = new DatabaseSync(dbPath);
        db.exec('PRAGMA busy_timeout=5000');
        db.exec('PRAGMA journal_mode=WAL');
        db.exec('PRAGMA locking_mode=NORMAL');

        let ok = 0;
        let busy = 0;
        const errors = [];

        for (let i = 0; i < writesPerWorker; i++) {
            try {
                db.exec('BEGIN IMMEDIATE');
                db.prepare('INSERT INTO t (val) VALUES (?)').run('w_' + i);
                db.exec('COMMIT');
                ok++;
            } catch (e) {
                try { db.exec('ROLLBACK'); } catch {}
                const msg = String(e.message || '');
                if (msg.includes('busy') || msg.includes('locked')) {
                    busy++;
                } else {
                    errors.push(msg);
                }
            }
        }
        db.close();
        parentPort.postMessage({ ok, busy, errors });
    `;

    return new Promise((resolve, reject) => {
        const results = [];
        let done = 0;
        let hasError = false;

        for (let i = 0; i < numWorkers; i++) {
            const worker = new Worker(workerCode, { eval: true });
            worker.on('message', (msg) => {
                results.push(msg);
                done++;
                if (done === numWorkers) resolve(results);
            });
            worker.on('error', (err) => {
                if (!hasError) {
                    hasError = true;
                    reject(err);
                }
            });
        }
    });
}

describe('SQLite 并发写压力测试(WAL + busy_timeout)', () => {
    test('4 Worker × 50 写事务 = 200 行全部成功,0 SQLITE_BUSY', async () => {
        tmpDir = mkdtempSync(join(tmpdir(), 'vrcx-sqlite-concurrent-'));
        const dbPath = join(tmpDir, 'stress.db');

        // 主线程建表 + 设 WAL/busy_timeout/locking_mode
        const db = new DatabaseSync(dbPath);
        db.exec('PRAGMA journal_mode=WAL');
        db.exec('PRAGMA busy_timeout=5000');
        db.exec('PRAGMA locking_mode=NORMAL');
        db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, val TEXT)');
        db.close();

        const numWorkers = 4;
        const writesPerWorker = 50;
        const results = await runConcurrentWriters(
            dbPath,
            numWorkers,
            writesPerWorker
        );

        const totalOk = results.reduce((s, r) => s + r.ok, 0);
        const totalBusy = results.reduce((s, r) => s + r.busy, 0);
        const allErrors = results.flatMap((r) => r.errors);

        // 全部 200 次写事务成功,0 次 SQLITE_BUSY
        expect(totalOk).toBe(numWorkers * writesPerWorker);
        expect(totalBusy).toBe(0);
        expect(allErrors).toHaveLength(0);

        // 验证行数:200 行全部落盘
        const verifyDb = new DatabaseSync(dbPath);
        const count = verifyDb.prepare('SELECT COUNT(*) AS c FROM t').get();
        verifyDb.close();
        expect(count.c).toBe(numWorkers * writesPerWorker);
    });

    test('2 Worker × 100 写事务 = 200 行全部成功(高并发度单线程少)', async () => {
        const dbPath = join(tmpDir, 'stress2.db');

        const db = new DatabaseSync(dbPath);
        db.exec('PRAGMA journal_mode=WAL');
        db.exec('PRAGMA busy_timeout=5000');
        db.exec('PRAGMA locking_mode=NORMAL');
        db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, val TEXT)');
        db.close();

        const results = await runConcurrentWriters(dbPath, 2, 100);

        const totalOk = results.reduce((s, r) => s + r.ok, 0);
        const totalBusy = results.reduce((s, r) => s + r.busy, 0);
        const allErrors = results.flatMap((r) => r.errors);

        expect(totalOk).toBe(200);
        expect(totalBusy).toBe(0);
        expect(allErrors).toHaveLength(0);

        const verifyDb = new DatabaseSync(dbPath);
        const count = verifyDb.prepare('SELECT COUNT(*) AS c FROM t').get();
        verifyDb.close();
        expect(count.c).toBe(200);
    });

    test('8 Worker × 25 写事务 = 200 行全部成功(高并发度多线程)', async () => {
        const dbPath = join(tmpDir, 'stress8.db');

        const db = new DatabaseSync(dbPath);
        db.exec('PRAGMA journal_mode=WAL');
        db.exec('PRAGMA busy_timeout=5000');
        db.exec('PRAGMA locking_mode=NORMAL');
        db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, val TEXT)');
        db.close();

        const results = await runConcurrentWriters(dbPath, 8, 25);

        const totalOk = results.reduce((s, r) => s + r.ok, 0);
        const totalBusy = results.reduce((s, r) => s + r.busy, 0);
        const allErrors = results.flatMap((r) => r.errors);

        expect(totalOk).toBe(200);
        expect(totalBusy).toBe(0);
        expect(allErrors).toHaveLength(0);

        const verifyDb = new DatabaseSync(dbPath);
        const count = verifyDb.prepare('SELECT COUNT(*) AS c FROM t').get();
        verifyDb.close();
        expect(count.c).toBe(200);
    });
});

/**
 * TODO(review #9):C# System.Data.SQLite 池化并发写压力测试。
 *
 * 本测试用 node:sqlite 验证 SQLite WAL 并发写理论(busy_timeout 让
 * 竞争写等待而非立即抛 SQLITE_BUSY),但 C# 桥的并发写行为
 * (System.Data.SQLite ADO.NET 池化 → 多连接竞争文件锁)是不同的
 * 代码路径,需 C# 端测试项目(xUnit/NUnit)覆盖:
 *
 *   1. 池化下多连接并发写同一 .db 文件,busy_timeout=5000 是否
 *      让竞争写等待而非抛 "database is locked"。
 *   2. push/pull 事务期间,后台 updateLoop / L1 日志持久化的
 *      非事务写是否与事务写竞争文件锁(桌面端真实负载场景)。
 *   3. Max Pool Size=100 下极端并发(>100 写请求)的排队行为。
 *
 * 两路径共享同一 SQLite 引擎(WAL/busy_timeout/locking_mode 是
 * 文件级 PRAGMA,与驱动无关),理论保证一致;但池化层的连接
 * 管理/超时/重试策略是 System.Data.SQLite 特有的,需独立验证。
 * 合并后应开 follow-up issue 跟踪。
 */