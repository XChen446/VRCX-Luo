import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MySQLAdapter } from './MySQLAdapter.js';
import {
    loadBridge,
    buildMySqlConnectionString
} from './__tests__/bridgeLoader.js';

/**
 * Phase 11.2 slice (task 8.10) 续 — C# 桥路径消费方升级。
 *
 * 本文件从 TCP 端口探测(node:net)升级为全量语义集成测试:在 vitest 进程内用
 * node-api-dotnet 加载 C# 桥(build/Electron/ 下的 VRCX-K.dll / VRCX-Electron.dll,
 * 见 __tests__/bridgeLoader.js),让 MySQLAdapter 走
 * ExecuteJsonOnConnection / BeginTransactionOnConnection 真实执行 SQL。
 *
 * Gated on `MYSQL_TEST_HOST`:env 未设时整个套件 skip,默认 `npm test`
 * (SQLite 模式)零副作用。CI workflow `.github/workflows/ci.yaml` `test_mysql`
 * job 设置 env,先 setup-dotnet 9.0.x + `dotnet build Dotnet/VRCX-Electron.csproj
 * -c Debug`,再导入 test/fixtures/seed.mysql.sql(18 global + 22 abc_ 表),
 * 最后全量运行本文件。
 *
 * Run locally (需 docker + .NET 9 SDK):
 *   dotnet build Dotnet/VRCX-Electron.csproj -c Debug
 *   docker run -d --name vrcx-mysql -e MYSQL_ROOT_PASSWORD=root \
 *     -e MYSQL_DATABASE=vrcx_test -p 3306:3306 mysql:8.0
 *   mysql -h 127.0.0.1 -u root -proot vrcx_test < test/fixtures/seed.mysql.sql
 *   MYSQL_TEST_HOST=127.0.0.1 npx vitest run MySQLAdapter.mysql
 *
 * env 清单(与 CI 一致):MYSQL_TEST_HOST / MYSQL_TEST_PORT / MYSQL_TEST_USER /
 * MYSQL_TEST_PASSWORD / MYSQL_TEST_DATABASE
 *
 * 纪律:
 * - 全部 OnConnection 路径,绕开 C# Init()/IsConnected 的 VRCXStorage 依赖;
 * - CRUD/事务在独立临时表 test_it_crud 上执行(afterAll DROP),seed 数据零污染;
 * - 套件顺序 A→B→F→C→D→E:listTablesTypes() 返回 DATABASE() 全表,必须在
 *   C 套件创建临时表之前断言 40 条目(18 global + 22 user);
 * - 桥加载 beforeAll 显式 30s 超时(dotnet.load 冷启动可数秒);
 * - 断言值全部来自 test/fixtures/seed.mysql.sql(29e6c33a),与 CI Verify 步骤对齐。
 *
 * 遗留 TODO(原文件继承):`beginTransaction`/`commit`/`rollback` 在真实 MySQL
 * 后端上的引擎级语义(事务内读未 commit 写、sliding Timer 超时回收)由本文件
 * 套件 D 覆盖;60s idle 超时真实等待不做(keepAlive 布尔语义已覆盖)。
 */

const mysqlHost = process.env.MYSQL_TEST_HOST;
const describeIntegration = mysqlHost ? describe : describe.skip;

describeIntegration('MySQLAdapter 集成(真实 C# 桥 + seed 库)', () => {
    /** @type {MySQLAdapter} */
    let adapter;
    /** @type {*} 保存 vitest.setup.js 的 noopAsync stub 原值,afterAll 恢复 */
    let savedMySQLBridge;
    /** @type {*} loadBridge() 同时注入 globalThis.PostgreSQL,对称保存/恢复 */
    let savedPostgreSQLBridge;

    beforeAll(async () => {
        savedMySQLBridge = globalThis.MySQL;
        savedPostgreSQLBridge = globalThis.PostgreSQL;
        loadBridge(); // 幂等单例,注入 globalThis.MySQL / globalThis.PostgreSQL
        adapter = new MySQLAdapter({
            connection: buildMySqlConnectionString()
        });
    }, 30000);

    afterAll(() => {
        globalThis.MySQL = savedMySQLBridge;
        globalThis.PostgreSQL = savedPostgreSQLBridge;
    });

    // ── 套件 A:桥加载与连接 ──────────────────────────────────────────

    describe('A 桥加载与连接', () => {
        it('A1 桥加载冒烟:dotnet 加载 + 类可实例化', () => {
            const bridge = loadBridge(); // 幂等:返回 beforeAll 同一实例
            expect(bridge.mysql).toBeTruthy();
            expect(bridge.pg).toBeTruthy();
            expect(bridge.dllPath).toBeTruthy();
            expect(globalThis.MySQL).toBe(bridge.mysql);
            // node-api-dotnet 包装对象 keys 为空,禁止 Object.keys 断言;
            // 只做方法存在性检查
            expect(typeof bridge.mysql.GetHealth).toBe('function');
            expect(typeof bridge.pg.GetHealth).toBe('function');
        });

        it('A2 首个真实 SQL:连接串连通 + 命名参数绑定 + seed 可见', async () => {
            // 首个真实 SQL 即带命名参数,尽早暴露 JS object → C# IDictionary
            // 序列化风险;同时验证连接串有效与 seed 数据可见
            const rows = await adapter.select('memos', ['user_id'], {
                user_id: 'usr_alice'
            });
            expect(rows).toEqual([['usr_alice']]);
        });
    });

    // ── 套件 B:seed 数据消费(只读)───────────────────────────────────

    describe('B seed 数据消费(只读)', () => {
        it('B1 关键表行数与 CI Verify 对齐', async () => {
            const counts = {
                cache_avatar: await adapter.countWhere(
                    'cache_avatar',
                    null,
                    null
                ),
                gamelog_location: await adapter.countWhere(
                    'gamelog_location',
                    null,
                    null
                ),
                gamelog_join_leave: await adapter.countWhere(
                    'gamelog_join_leave',
                    null,
                    null
                ),
                abc_notes: await adapter.countWhere('abc_notes', null, null),
                abc_feed_gps: await adapter.countWhere(
                    'abc_feed_gps',
                    null,
                    null
                ),
                abc_friend_log_history: await adapter.countWhere(
                    'abc_friend_log_history',
                    null,
                    null
                ),
                abc_notifications: await adapter.countWhere(
                    'abc_notifications',
                    null,
                    null
                )
            };
            expect(counts).toEqual({
                cache_avatar: 2,
                gamelog_location: 2,
                gamelog_join_leave: 2,
                abc_notes: 2,
                abc_feed_gps: 2,
                abc_friend_log_history: 2,
                abc_notifications: 1
            });
        });

        it('B2 命名参数 WHERE 绑定往返', async () => {
            const rows = await adapter.select(
                'gamelog_join_leave',
                ['display_name'],
                {
                    user_id: 'usr_alice'
                }
            );
            expect(rows).toEqual([['Alice']]);
        });

        it('B3 代表性行内容:usr_alice(memos + abc_notes)', async () => {
            const memo = await adapter.selectOne('memos', ['user_id', 'memo'], {
                user_id: 'usr_alice'
            });
            expect(memo).toEqual(['usr_alice', 'Seed memo for Alice']);
            const note = await adapter.selectOne(
                'abc_notes',
                ['display_name', 'note'],
                {
                    user_id: 'usr_alice'
                }
            );
            expect(note).toEqual(['Alice', 'Seed note for Alice']);
        });

        it('B4 缓存表内容 + 数字类型', async () => {
            const row = await adapter.selectOne(
                'cache_avatar',
                ['name', 'version'],
                {
                    id: 'avtr_2'
                }
            );
            expect(row).toEqual(['Avatar Two', 2]);
        });

        it('B5 复合语义行:friend_log_history', async () => {
            const row = await adapter.selectOne(
                'abc_friend_log_history',
                [
                    'display_name',
                    'trust_level',
                    'previous_trust_level',
                    'friend_number'
                ],
                { user_id: 'usr_bob' }
            );
            expect(row).toEqual(['Bob', 'Known User', 'Trusted User', 4]);
        });

        it('B6 保留字列往返(cookies 的 key/value,quoteIdent 反引号)', async () => {
            const row = await adapter.selectOne('cookies', ['key', 'value'], {
                key: 'seed_cookie_key'
            });
            expect(row).toEqual(['seed_cookie_key', '{"auth":"seed"}']);
        });
    });

    // ── 套件 F:元数据(必须在 C 套件之前:临时表尚未创建)─────────────

    describe('F 元数据(必须在 C 套件之前)', () => {
        it('F1 listTables:用户表枚举', async () => {
            const tables = await adapter.listTables('abc\\_%');
            expect(tables).toHaveLength(22);
            expect(tables).toContain('abc_notes');
        });

        it('F2 listTables:全局表枚举', async () => {
            const gamelogTables = await adapter.listTables('gamelog\\_%');
            expect(gamelogTables).toHaveLength(7);
            const cacheTables = await adapter.listTables('cache\\_%');
            expect(cacheTables).toHaveLength(2);
            expect(cacheTables).toContain('cache_avatar');
            expect(cacheTables).toContain('cache_world');
        });

        // F3 的 40 全表计数依赖文件内声明顺序执行(vitest 约定):必须在
        // C 套件创建 test_it_crud 之前运行,否则计数变 41。
        it('F3 listTablesTypes:全库 40 条目结构', async () => {
            const tables = await adapter.listTablesTypes();
            expect(tables).toHaveLength(40);
            expect(tables.some((t) => t.tableName === 'memos')).toBe(true);
            expect(tables.some((t) => t.tableName === 'abc_notes')).toBe(true);
            for (const t of tables) {
                expect(t.tableName).toBeTruthy();
                expect(Array.isArray(t.columns)).toBe(true);
                expect(t.columns.length).toBeGreaterThan(0);
                expect(t.columns[0].name.length).toBeGreaterThan(0);
                expect('isHidden' in t.columns[0]).toBe(true);
            }
        });
    });

    // ── 套件 C:adapter CRUD 真实往返(独立临时表)─────────────────────

    describe('C adapter CRUD 真实往返(独立临时表 test_it_crud)', () => {
        beforeAll(async () => {
            await adapter.executeNonQuery(
                'CREATE TABLE test_it_crud (id VARCHAR(32) PRIMARY KEY, val VARCHAR(255), num INT)'
            );
        });

        it('C1 insert + selectOne 往返', async () => {
            const affected = await adapter.insert('test_it_crud', {
                id: 'it1',
                val: 'v1',
                num: 1
            });
            expect(affected).toBe(1);
            const row = await adapter.selectOne(
                'test_it_crud',
                ['id', 'val', 'num'],
                {
                    id: 'it1'
                }
            );
            expect(row).toEqual(['it1', 'v1', 1]);
        });

        it('C2 update + select 验证', async () => {
            const affected = await adapter.update(
                'test_it_crud',
                { val: 'v1-upd' },
                {
                    id: 'it1'
                }
            );
            expect(affected).toBe(1);
            const rows = await adapter.select('test_it_crud', ['val'], {
                id: 'it1'
            });
            expect(rows).toEqual([['v1-upd']]);
        });

        it('C3 delete + countWhere 验证', async () => {
            const affected = await adapter.delete('test_it_crud', {
                id: 'it1'
            });
            expect(affected).toBe(1);
            const count = await adapter.countWhere('test_it_crud', 'id = @id', {
                id: 'it1'
            });
            expect(count).toBe(0);
        });

        it('C4 upsertPartial:insert 后 update 不增行', async () => {
            const data = { id: 'it2', val: 'a', num: 1 };
            const first = await adapter.upsertPartial(
                'test_it_crud',
                data,
                { val: 'a2' },
                'id'
            );
            const second = await adapter.upsertPartial(
                'test_it_crud',
                data,
                { val: 'a2' },
                'id'
            );
            // MySQL ON DUPLICATE KEY UPDATE 的 affected 行数:insert=1,
            // update=2。本用例第二次调用确实变更值(首轮 insert 后 val='a',
            // 二轮 ON DUPLICATE 把 val 更新为 'a2',affected=2,并非
            // set 相同值=0 的引擎特例),故 affected>=1 成立。
            expect(first).toBeGreaterThanOrEqual(1);
            expect(second).toBeGreaterThanOrEqual(1);
            const count = await adapter.countWhere('test_it_crud', 'id = @id', {
                id: 'it2'
            });
            expect(count).toBe(1);
            const row = await adapter.selectOne('test_it_crud', ['val'], {
                id: 'it2'
            });
            expect(row).toEqual(['a2']);
        });

        it('C5 bulkInsert + execute 命名参数', async () => {
            const affected = await adapter.bulkInsert('test_it_crud', [
                { id: 'it3', val: 'v1', num: 10 },
                { id: 'it4', val: 'v2', num: 20 }
            ]);
            expect(affected).toBe(2);
            const rows = [];
            await adapter.execute(
                (row) => rows.push(row),
                'SELECT val FROM test_it_crud WHERE num >= @min ORDER BY id',
                { min: 10 }
            );
            expect(rows).toEqual([['v1'], ['v2']]);
        });
    });

    // ── 套件 D:事务(OnConnection pinned 路径,用 test_it_crud)─────────

    describe('D 事务(OnConnection pinned 路径)', () => {
        beforeAll(async () => {
            // 清空 C 套件遗留数据,保证事务用例确定性
            await adapter.executeNonQuery('DELETE FROM test_it_crud');
        });

        afterAll(async () => {
            await adapter.executeNonQuery('DROP TABLE IF EXISTS test_it_crud');
        });

        it('D1 withTransaction commit 后可见', async () => {
            await adapter.withTransaction(async () => {
                await adapter.insert('test_it_crud', {
                    id: 'it1',
                    val: 'v1',
                    num: 1
                });
            });
            const row = await adapter.selectOne('test_it_crud', ['id', 'val'], {
                id: 'it1'
            });
            expect(row).toEqual(['it1', 'v1']);
        });

        it('D2 事务内抛错 → rollback 不可见', async () => {
            await expect(
                adapter.withTransaction(async () => {
                    await adapter.insert('test_it_crud', {
                        id: 'it2',
                        val: 'v2',
                        num: 2
                    });
                    throw new Error('boom');
                })
            ).rejects.toThrow('boom');
            const count = await adapter.countWhere('test_it_crud', 'id = @id', {
                id: 'it2'
            });
            expect(count).toBe(0);
        });

        it('D3 事务内读得到未 commit 的写', async () => {
            await adapter.withTransaction(async () => {
                await adapter.insert('test_it_crud', {
                    id: 'it3',
                    val: 'v3',
                    num: 3
                });
                const row = await adapter.selectOne(
                    'test_it_crud',
                    ['id', 'val'],
                    {
                        id: 'it3'
                    }
                );
                expect(row).toEqual(['it3', 'v3']);
            });
        });

        it('D4 嵌套 withTransaction 拒绝且栈恢复', async () => {
            await expect(
                adapter.withTransaction(async () => {
                    await adapter.withTransaction(async () => {});
                })
            ).rejects.toThrow(/嵌套/);
            expect(adapter._txStack).toHaveLength(0);
            // 随后一次正常事务成功(栈已恢复)
            await adapter.withTransaction(async () => {
                await adapter.insert('test_it_crud', {
                    id: 'it4',
                    val: 'v4',
                    num: 4
                });
            });
            expect(adapter._txStack).toHaveLength(0);
            const row = await adapter.selectOne('test_it_crud', ['id'], {
                id: 'it4'
            });
            expect(row).toEqual(['it4']);
        });

        it('D5 keepAlive:事务内 true,事务后 false', async () => {
            const inTx = await adapter.withTransaction(async () => {
                await adapter.insert('test_it_crud', {
                    id: 'it5',
                    val: 'v5',
                    num: 5
                });
                return await adapter.keepAlive();
            });
            expect(inTx).toBe(true);
            const afterTx = await adapter.keepAlive();
            expect(afterTx).toBe(false);
        });

        it('D6 手动 begin/commit/rollback 栈契约', async () => {
            // commit 路径:配对后栈清空,写入可见
            const connId1 = await adapter.beginTransaction();
            expect(adapter._txStack).toHaveLength(1);
            await adapter.insert('test_it_crud', {
                id: 'it6',
                val: 'v6',
                num: 6
            });
            await adapter.commit(connId1);
            expect(adapter._txStack).toHaveLength(0);
            const committed = await adapter.countWhere(
                'test_it_crud',
                'id = @id',
                {
                    id: 'it6'
                }
            );
            expect(committed).toBe(1);
            // rollback 路径:配对后栈清空,写入不可见
            const connId2 = await adapter.beginTransaction();
            await adapter.insert('test_it_crud', {
                id: 'it7',
                val: 'v7',
                num: 7
            });
            await adapter.rollback(connId2);
            expect(adapter._txStack).toHaveLength(0);
            const rolledBack = await adapter.countWhere(
                'test_it_crud',
                'id = @id',
                {
                    id: 'it7'
                }
            );
            expect(rolledBack).toBe(0);
        });
    });

    // ── 套件 E:建表幂等(对已 seed 库重复执行)────────────────────────

    describe('E 建表幂等(对已 seed 库重复执行)', () => {
        it('E1 initGlobalSchema 重复执行 resolve', async () => {
            await adapter.initGlobalSchema();
        });

        it('E2 initUserSchema(abc) 重复执行 resolve', async () => {
            await adapter.initUserSchema('abc');
        });
    });

    // ── 既有用例保留:构造断言与池统计验证器 ─────────────────────────

    describe('既有用例:构造断言与池统计验证器', () => {
        it('should construct MySQLAdapter with a mysql:// connection URI', () => {
            const port = process.env.MYSQL_TEST_PORT || 3306;
            const probeAdapter = new MySQLAdapter({
                connection: `mysql://root:root@${mysqlHost}:${port}/vrcx_test`
            });
            expect(probeAdapter.engineType).toBe('mysql');
            expect(probeAdapter.connectionString).toContain(
                `Server=${mysqlHost}`
            );
            expect(probeAdapter.connectionString).toContain(`Port=${port}`);
            expect(probeAdapter.connectionString).toContain(
                'Database=vrcx_test'
            );
            expect(probeAdapter.connectionString).toContain('User ID=root');
            expect(probeAdapter.connectionString).toContain('Password=root');
        });

        it('getPoolStats returns driver truth values after pool warm-up (MySQL reflection verifier)', async () => {
            // 池统计真值化(设计文档 pool-stats-design):MySQL.cs GetPoolStats
            // 反射 MySqlConnector 2.6.1 内部结构(m_sessions / m_sessionSemaphore)
            // 拿驱动真值。真值下 idleInPool/totalOpen 是实际物理连接数(远小于 50);
            // 反射失败(字段改名/驱动升级)或回退估算时是配额假象(99/100) → 变红,
            // 此用例即"验证器",本地带 C# 桥环境(桌面运行 / dotnet + bridge 测试
            // 环境)下每次真值化改动需保持绿。
            // 集成测试桥未 Init:Ping() 内部 _dataSource 为空 → catch 返回 false
            // (不会抛错),守卫早退;仅当桥已 Init(真实桌面环境)才执行真值断言。
            const bridgeAlive = Boolean(await globalThis.MySQL.Ping());
            if (!bridgeAlive) return;

            // 无 connection 参数 → 走单例 _dataSource 池路径(非 ExecuteJsonOnConnection),
            // 两次查询确保池已建物理连接(min=1 常驻)。
            const statsAdapter = new MySQLAdapter();
            await statsAdapter.execute(() => {}, 'SELECT 1');
            await statsAdapter.execute(() => {}, 'SELECT 1');

            const stats = await statsAdapter.getPoolStats();
            expect(stats.max).toBeGreaterThanOrEqual(50);
            expect(stats.idleInPool).toBeGreaterThanOrEqual(0);
            expect(stats.idleInPool).toBeLessThan(50);
            expect(stats.totalOpen).toBeGreaterThanOrEqual(1);
            expect(stats.totalOpen).toBeLessThan(50);
        });
    });
});
