# EngineAdapter API 参考（三引擎统一契约）

> 面向消费方与实现方开发者的完整方法契约参考。基类 `src/services/database/adapter/EngineAdapter.js`（1205 行）定义了三引擎（SQLite / MySQL / PostgreSQL）统一接口；本文档覆盖全部公开方法（含事件推送），并合并原 `CHANGE_NOTIFICATION_API.md` 的变更通知语义（2026-08 并入）。
>
> **接口冻结**：基类冻结于 **42 abstract + 3 optional 方法**（2026-07-16），后续只增不改签名（2026-07-25 破例将 begin/commit/rollback 改名为 beginTransaction/commit/rollback 并新增 withTransaction，原因见 §7 与 `TRANSACTION_DESIGN.md`）。
>
> **标记约定**：`@abstract` 子类必须实现（基类抛 `'abstract'`）；`@optional` 基类有默认实现、子类可覆写；`@engine-specific` 产生引擎相关 SQL 语法（三端差异）；`@private` 生产代码不应直接调用。

## 1. 总览

### 引擎注册与实例获取

```js
import { adapter, initAdapter, createAdapter } from '@/services/database/adapter';

await initAdapter(mode);          // mode: 'sqlite' | 'mysql' | 'postgresql'，构造单例 adapter
adapter.engineType;               // 运行时引擎标识（'sqlite' | 'mysql' | 'postgresql' | 'unknown'）
const ext = await createAdapter({ connection: 'sqlite:///D:/data/ext.db' }); // 外部实例（push/pull 引擎用）
```

- **默认单例**：`adapter`，对应 C# 侧 `conn = "default"`。
- **外部实例**：`createAdapter` 构建，`connectionString` 为构建后的连接字符串；写漏斗事件按此值路由（见 §9）。
- 引擎文件：`SQLiteAdapter.js` / `MySQLAdapter.js` / `PgSQLAdapter.js`（均继承 EngineAdapter）。
- `initAdapter(mode)` 由 `VRCX_Database.mode` 驱动（`vrcx.js` 启动时调用），迁移运行器经 `adapter.engineType` 检测引擎（不重复读配置）。

### 实例字段

| 字段 | 说明 |
|---|---|
| `_prefixOverride` | `withPrefix` 临时前缀覆盖（嵌套安全） |
| `connectionString` | 连接标识：默认单例 `null`；外部实例为构建后 connectionString（事件路由键） |
| `_txStack` | 事务 connId 栈（实例独立，srcAdapter/dstAdapter 天然隔离） |

## 2. 连接与健康

| 方法 | 签名 | 说明 |
|---|---|---|
| `isConnected` | `() => Promise<boolean>` | 存活探针：C# 后端已初始化且 Ping 成功。双运行时差异（CefSharp 同步 / Electron Promise）已用 `async` 统一，**调用方必须 await** |
| `getHealth` | `() => Promise<{ connected, latencyMs?, lastHealthCheck? }>` | 健康快照（C# 桥 JSON） |
| `getPoolStats` | `() => Promise<{ active, pinnedIdle, availableCapacity, max, totalOpen, idleInPool }>` | 连接池三态指标。基础字段（active/pinnedIdle/availableCapacity/max）所有引擎对称、UI 主用；扩展字段（totalOpen/idleInPool）为反射真值或近似（SQLite 用 peak-borrowed 近似），供诊断校验。StatusBar 每秒采样一次（Issue #14） |
| `clearIdleConnections` | `() => Promise<void>` | 清理池中空闲连接（不影响 active/pinned） |
| `engineType` | `getter: string` | 引擎标识；默认 `'unknown'`，子类覆写。迁移兼容性检查据此报错而非静默冒充 sqlite |

## 3. 原始执行

| 方法 | 签名 | 说明 |
|---|---|---|
| `execute` | `(callback, sql, args?) => Promise<void>` | 执行 SELECT/PRAGMA，逐行回调（positional array）。`@abstract` |
| `executeNonQuery` | `(sql, args?) => Promise<number>` | 执行 INSERT/UPDATE/DELETE/DDL，返回影响行数。`@abstract` |

- 事务中两者读 `_txStack.at(-1)` 自动走 pinned 连接（栈顶 connId），事务外走默认池——**签名不变，调用方无感**。

## 4. CRUD 写入

| 方法 | 签名 | 引擎差异（`@engine-specific`） |
|---|---|---|
| `insert` | `(table, data, conflict?) => Promise<number>` | conflict: `'ignore'`/`'replace'` → SQLite `INSERT OR IGNORE/REPLACE`；PG `ON CONFLICT DO NOTHING/UPDATE`；MySQL `INSERT IGNORE/REPLACE INTO` |
| `bulkInsert` | `(table, rows, conflict?) => Promise<number>` | 同上；rows 各元素须同键 |
| `update` | `(table, data, where) => Promise<number>` | 等值条件（key:value → `col = @key`） |
| `updateWhere` | `(table, data, whereClause, params?) => Promise<number>` | 原始 WHERE（不含 WHERE 关键字） |
| `delete` | `(table, where) => Promise<number>` | 等值条件 |
| `deleteAll` | `(table) => Promise<number>` | 清空全表 |
| `deleteWhere` | `(table, whereClause, params?) => Promise<number>` | 原始 WHERE |
| `increment` | `(table, column, amount, where) => Promise<number>` | 数值列自增 |
| `upsertPartial` | `(table, insertData, updateData, conflictColumn) => Promise<number>` | SQLite/PG `ON CONFLICT(col) DO UPDATE SET ...`；MySQL `ON DUPLICATE KEY UPDATE ...` |

## 5. SELECT 与 COUNT

| 方法 | 签名 | 说明 |
|---|---|---|
| `selectOne` | `(table, columns, where) => Promise<Array\|null>` | 单行（positional array）或 null |
| `select` | `(table, columns, where?, options?) => Promise<Array<Array>>` | options: `{ order?, limit?, distinct? }`；省略 where = 全表 |
| `selectWhere` | `(table, columns, whereClause?, params?, options?) => Promise<Array<Array>>` | 原始 WHERE（省略/`null` 跳过） |
| `selectJoin` | `(spec) => Promise<Array<Array>>` | spec: `{ from, alias?, joins?, columns, where?, params?, order?, limit? }`；joins: `[{ type, table, alias?, on }]` |
| `selectWhereIn` | `(table, columns, inColumn, inValues, extraWhere?, extraParams?, options?) => Promise<Array<Array>>` | `WHERE col IN (...) [AND extra]` |
| `selectUnion` | `(sources, options?) => Promise<Array<Array>>` | UNION ALL；sources: `[{ table, columns?, nulls?, where?, params?, order?, limit? }]`；options: `{ schema?, order?, limit? }` |
| `selectGroupBy` | `(table, spec) => Promise<Array<Array>>` | spec: `{ columns?, aggregates?, groupBy?, where?, params?, order?, limit?, having? }`；aggregates: `[{ expr: 'COUNT(*)', alias: 'cnt' }]` |
| `count` | `(table, where) => Promise<number>` | 等值条件计数 |
| `countWhere` | `(table, whereClause?, params?) => Promise<number>` | 原始 WHERE 计数（省略 = COUNT 全表） |

## 6. DDL 与 Schema

| 方法 | 签名 | 说明 |
|---|---|---|
| `createTable` | `(tableName, columns) => Promise<number>` | `CREATE TABLE IF NOT EXISTS`；columns: `[{ name, type, constraints? }]` 或裸字符串 |
| `createIndex` | `(indexName, table, columns, unique?) => Promise<number>` | `CREATE INDEX IF NOT EXISTS` |
| `alterTableAddColumn` | `(table, columnDef) => Promise<number>` | columnDef 为完整列定义（如 `'name TEXT NOT NULL DEFAULT ""'`） |
| `alterTableDropColumn` | `(table, column) => Promise<number>` | |
| `alterTableRename` | `(table, newName) => Promise<number>` | |
| `dropTable` | `(table) => Promise<number>` | `DROP TABLE IF EXISTS` |
| `initUserSchema` | `(prefix) => Promise<void>` | 初始化某账号前缀的用户表（22 表 + 4 索引，见 SQLiteAdapter） |
| `initGlobalSchema` | `() => Promise<void>` | 初始化全局共享表（18 表） |
| `listTables` | `(likePattern) => Promise<Array<string>>` | LIKE 过滤；SQLite `sqlite_schema` / MySQL `SHOW TABLES LIKE` / PG `pg_catalog.pg_tables` |
| `getTableColumns` | `(table) => Promise<Array<Array>>` | 列元数据（方言特定 positional rows）；SQLite `PRAGMA table_xinfo` / MySQL `SHOW COLUMNS FROM` / PG `information_schema.columns` |
| `listTablesTypes` | `() => Promise<Array<{tableName, columns: Array<{name, type, notNull, defaultValue, isPK, isHidden}>}>>` | 表枚举 + 列元数据组合（结构化对象） |

## 7. 事务（栈式上下文）

生产代码**只用 `withTransaction(fn)`**；`beginTransaction`/`commit`/`rollback` 为 `@private`（仅测试验证栈契约时手动调用）。

| 方法 | 签名 | 说明 |
|---|---|---|
| `withTransaction` | `(fn: () => Promise<T>) => Promise<T>` | 自动 begin→fn→commit；抛错→rollback→重抛；**不支持嵌套**（栈非空抛错）。体内 execute/insert/bulkInsert 自动走 pinned 连接 |
| `keepAlive` | `() => Promise<boolean>` | 重置 sliding idle timer（不执行 SQL）。`true` 续命成功；`false` 已超时回滚/不在事务中——调用方应提前退出事务体。**逃生舱**：事务内 await 长交互（>60s）前调用；更推荐把交互拆到事务外（乐观锁模式） |
| `beginTransaction` | `() => Promise<number>` | `@private`；push connId 到 `_txStack`；嵌套抛错 |
| `commit` | `(connId) => Promise<void>` | `@private`；`_doCommit` 后 pop 栈 |
| `rollback` | `(connId) => Promise<void>` | `@private`；已超时/不存在 connId 静默 no-op；pop 栈 |
| `_doBegin` | `() => Promise<number>` | `@abstract @protected` 引擎钩子。PG 调 `PostgreSQL.BeginTransaction()` 返回真实 connId；SQLite/MySQL 发 `BEGIN` 返回 0（单连接无需 pin） |
| `_doCommit` | `(connId) => Promise<void>` | `@abstract @protected`；PG `CommitTransaction(connId)`；SQLite/MySQL 发 `COMMIT`（忽略 connId） |
| `_doRollback` | `(connId) => Promise<void>` | `@abstract @protected`；同上语义 |
| `_doKeepAlive` | `(connId) => Promise<boolean>` | `@abstract @protected`；`true` timer 已重置；`false` 已超时回滚。MemorySQLiteAdapter 恒 true |

- **C# 侧 60s idle 超时**：`TX_IDLE_MS = 60000`，三引擎对称（`SQLite.cs`/`PostgreSQL.cs`/`MySQL.cs` 的 `_pinned` + InFlight/TimedOut 竞态防御）。
- 详细设计（七类干扰路径、keepAlive 语义、PRAGMA 选型）见 `TRANSACTION_DESIGN.md`。

## 8. 命名与 SQL 方言助手

| 方法 | 签名 | 引擎差异 |
|---|---|---|
| `userTable` | `(prefix, name) => string` | SQLite/MySQL `{prefix}_{name}`；**PG `account_{prefix}.{name}`（schema 隔离）** |
| `withPrefix` | `(prefix, fn) => Promise<T>` | `@optional`；临时前缀覆盖，嵌套安全（`_prefixOverride` 恢复） |
| `sqlToUnixMs` | `(column) => string` | SQLite `strftime('%s', col)*1000`；PG `EXTRACT(EPOCH FROM col)*1000`；MySQL `UNIX_TIMESTAMP(col)*1000` |
| `sqlExtractWorldId` | `(column) => string` | `"wrld_xxx:12345" → "wrld_xxx"`；SQLite `SUBSTR/INSTR`；PG `SUBSTRING/POSITION`；MySQL `SUBSTRING_INDEX` |
| `sqlHasInstanceId` | `(column) => string` | 位置串含 `:`；SQLite `INSTR>0`；PG `POSITION>0`；MySQL `LOCATE>0` |
| `sqlDate` | `(column) => string` | 取日期部分；SQLite `date(col)`；PG `col::date`；MySQL `DATE(col)` |
| `sqlEnterTime` | `(tsColumn, msColumn) => string` | 离开事件推算进入时间（enter = leave − duration）：SQLite `strftime(..., '-' || (time/1000) || ' seconds')`；PG `created_at - (time/1000)*INTERVAL '1 second'`；MySQL `created_at - INTERVAL (time/1000) SECOND` |
| `daysAgoISO` | `(days) => string` | `@optional`；N 天前 ISO 8601 字符串 |

## 9. 事件推送（onTableChange 变更通知）

> 本节完整承载原 `CHANGE_NOTIFICATION_API.md` 语义（2026-08 并入本文档）。原始设计文档在 git 历史（`git show 07ebdba2:docs/CHANGE_NOTIFICATION_DESIGN.md`），内部机制见各实现文件代码注释。

### 9.1 是什么

统一的三引擎**表级变更订阅接口**，挂在 `EngineAdapter` 基类（`@optional`，基类提供完整默认实现）。消费方订阅一张物理表，在表被写入时收到"失效提示"。

核心语义（务必先理解）：

- **事件是失效提示（invalidate hint），不是数据管道**——事件负载**不带行数据**，收到事件后应重新查询数据。漏事件最多延迟一次 UI 刷新，永不导致数据不一致。
- **检测层对消费方透明**——实时层（C# 写漏斗事件，毫秒级）+ 完备层（计数器轮询兜底，最坏 ~5s）自动组合，消费方无感。
- **自写去重**——本进程自己的写入经实时层正常触发对应表回调（毫秒级失效提示，属预期刷新信号）；完备层基线同步吸收自写，不会因自写再触发一次 count=-1 全量失效。
- 当前尚无生产消费方（接口就绪，等待首个接入，如多账号 Store 热替换）。

### 9.2 接口契约

```js
/**
 * 订阅某张物理表的变更。
 * @param {string} table 物理表名（以 userTable(prefix, name) 计算，见 §9.4）
 * @param {(evt: { table: string, count: number, ts: number }) => void} cb
 * @returns {() => void} unsubscribe —— Store/组件卸载时调用
 */
adapter.onTableChange(table, cb);
```

**事件负载**：

| 字段 | 含义 |
|---|---|
| `table` | 物理表名（与订阅键一致） |
| `count` | 本次批量变更行数（bulkInsert 500 行 = 1 条事件，count=500）；**`-1` 表示全量失效提示**——完备层兜底触发（外部写者/无法识别表的写入），收到 `-1` 应重查该表全部数据 |
| `ts` | 发射时间戳（Unix 毫秒） |

- **幂等**：同实例同表同回调重复订阅安全（Set 去重）；退订函数可重复调用。
- **线程**：回调在 JS 主线程执行；node-api-dotnet 的 .NET→JS 委托编组失败时由完备层兜底，仅响应性降级。
- 参数校验：`table` 非空字符串、`cb` 为函数，否则抛 `TypeError`。

### 9.3 实例边界：订阅挂载点 = adapter 实例

订阅挂在 **adapter 实例**上（"实例即边界"），事件按 `conn` 路由到对应实例：

| 实例 | 来源 | 收到的事件 |
|---|---|---|
| 默认单例（主库） | `import { adapter } from '@/services/database/adapter'` | `conn = 'default'` 的事件 |
| 外部实例 | `createAdapter({ connection: 'sqlite:///D:/data/ext.db' })` | `conn = connectionString` 的事件 |
| 无对应实例的连接 | — | 事件被丢弃 |

- 多账号天然隔离：账号前缀不同的表是不同物理表，各实例只收自己的事件。
- 外部实例（如 push/pull 引擎的 src/dst adapter）只收自己连接的事件，不会收到主库事件。

### 9.4 物理表名：userTable(prefix, name)

```js
adapter.userTable('abc', 'feed_gps');  // SQLite/MySQL → 'abc_feed_gps'
pgAdapter.userTable('abc', 'feed_gps'); // PostgreSQL → 'account_abc.feed_gps'
```

### 9.5 快速示例

```js
import { adapter } from '@/services/database/adapter';

const unsubscribe = adapter.onTableChange(adapter.userTable(prefix, 'feed_gps'), (evt) => {
    if (evt.count === -1) {
        feedStore.invalidateAll(prefix);  // 全量失效：重查全部数据
    } else {
        feedStore.invalidate(prefix);     // 增量失效：重查（count 仅提示）
    }
});
unsubscribe(); // Store/组件卸载时（与 Vue watch stop 同构）
```

与 TanStack Query 衔接：收到事件后 `invalidateQueries` 对应 query key——本接口即"下移到 DB 层的 refetchInterval"。

### 9.6 行为语义要点

- **订阅即启停**：首个订阅自动开启 C# 写漏斗与轮询定时器（`CHANGE_POLL_MS = 5000`）；全部退订自动关闭。**无消费者时写路径近零开销**（仅表名提取正则与门控布尔读）——无需手动管理，也不要手动轮询。
- **事务**：回滚不通知（仅 COMMIT 成功后发射）；事务内同表的批量写入合并为该表 COMMIT 后的一条事件（多表事务每表各一条）。
- **完备层兜底**：订阅期间每 5s 比对原生计数器（SQLite `PRAGMA data_version` / MySQL `performance_schema`），版本前进且无对应漏斗事件时触发 `count=-1` 全量失效——外部进程写库、绕过漏斗的直写也能被发现（最坏 ~5s）。首轮只建立基线、不触发（订阅方通常自会做初始拉取）。
- **PG 例外**：外部写者由 trigger + NOTIFY 原生推送表级实时覆盖（见 §9.7 引擎矩阵），计数器轮询仅作安全网（监听通道故障/未装触发器时兜底）。
- **桥不可用降级**：通道绑定失败/编组失败静默，完备层兜底保证不漏，仅响应性降级。
- **引擎未实现计数器**：`_readChangeCounter()` 默认返回 `null` → 完备层不运行，onTableChange 退化为纯实时层。

### 9.7 引擎支持矩阵

| 引擎 | 实时层 | 完备层 | 表名形态 |
|---|---|---|---|
| SQLite | ✅ C# 漏斗 | `PRAGMA data_version` 轮询兜底（DB 级） | `prefix_name` |
| MySQL | ✅ C# 漏斗 | `performance_schema` 轮询兜底（表级源 → DB 级信号） | `prefix_name` |
| PostgreSQL | ✅ C# 漏斗 | ✅ **trigger + NOTIFY 原生推送**（表级，含外部写者；需消费方安装触发器，默认仍计数器轮询）→ `pg_stat_user_tables` 行级计数兜底 | `account_prefix.name` |

三端接口语义同构；检测机制允许引擎异构（上层接口统一）。PG 的 schema 限定表名与漏斗事件直配（`ExtractTable` 正则支持 `[\w.-]+` 限定名）。

**PG 原生推送说明**：`SetChangeEnabled(true)`（首个订阅）时建立专用 `LISTEN vrcx_change` 连接，随门控关闭（全部退订）断开。触发器由消费方经 `PostgreSQL.CreateChangeTrigger(table)` 安装（每张 watched 表一个 `FOR EACH STATEMENT` 触发器，先 `EnsureChangeFunction()` 一次）。自写去重：漏斗发射时间戳在 dv 读/COMMIT 之前记录，监听侧 500ms 窗口内的 NOTIFY 视为自写镜像丢弃；窗口误杀的外部写由计数器轮询（≤5s）补上——去重不会造成漏报。NOTIFY 事件的 dv 读自池中独立连接（监听连接 Waiting 态不可查询），失败时事件携带 dv=null，由计数器轮询兜底。`ListChangeTriggers()` / `DropChangeTrigger(table)` 管理已装触发器。

### 9.8 边界与限制

- **粒度**：表级（无行级订阅；行级被设计明确否定——负载一旦带行数据就变成数据管道，漏一行即数据不一致）。
- **外部进程写库**：非支持场景（单进程应用，DB 归其所有）；完备层兜底检测。PG 由 trigger + NOTIFY 原生覆盖（需消费方安装触发器）。
- **DBMerger 裸连接**（`Merger.cs` 升级合并工具）：不产生通知，无需处理。
- **未实现**：拉式降级接口 `getPendingChanges(sinceId)`（设计备选，**未实现**，不要依赖）；PG/MySQL 的 trigger outbox 轮询形态（Phase 4 备选，未实施——PG 已走 NOTIFY 推送，MySQL 维持计数器轮询）。
- **DDL 动词层泛化**：`createTrigger`/`dropTrigger`/`listTriggers` 三端统一形态（当前 PG 已实现对应方法，MySQL/SQLite 待需求）。

### 9.9 内部机制速览（实现方参考）

| 成员 | 说明 |
|---|---|
| `_changeSubs` | `Map<物理表名, Set<回调>>` 订阅注册表 |
| `_changeTimer` | 共享轮询定时器（有订阅才运行，`CHANGE_POLL_MS = 5000`） |
| `_changeBaseline` | 计数器基线（最近漏斗事件 dv 或轮询观察值） |
| `_pollChangeCounter()` | `@protected` 完备层一拍：版本前进且无对应漏斗事件 → `_fireAllTables()` |
| `_syncChangeBaseline(version)` | `@protected` 漏斗事件推进基线（自写吸收） |
| `_onFunnelEvent(evt)` | 半公开：adapter 路由层（`index.js wireFunnelEvents`）按 conn 分发后调用，消费方不应直接调用 |
| `_fireAllTables()` | `@private` 全部订阅表 `count=-1` 失效 |
| `_readChangeCounter()` | `@protected` 读引擎原生计数器；默认 `null` = 不启用兜底 |
| `setChangeGateHook(hook)` | 注入 C# 门控钩子（`index.js` 加载时一次；注入即重置订阅计数，保证测试可重复安装）。跨实例订阅计数 0→1 开 C# 写漏斗、归零关闭；无消费者时 C# `EmitChange` 首行早退，写路径零成本 |

## 10. 维护

| 方法 | 签名 | 引擎差异 |
|---|---|---|
| `vacuum` | `() => Promise<number>` | SQLite `VACUUM`；PG `VACUUM ANALYZE`；MySQL `OPTIMIZE TABLE` |
| `optimize` | `() => Promise<number>` | SQLite `PRAGMA optimize`；PG `ANALYZE`；MySQL `ANALYZE TABLE` |
