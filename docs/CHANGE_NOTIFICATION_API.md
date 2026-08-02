# 数据库变更通知 API 使用指南（面向消费方开发者）

> 状态：Phase 1-3 已实施（2026-08-02）。本文档面向需要订阅数据库变更的开发者，
> 描述**已实现**的接口与语义。内部机制（C# 写漏斗、观察连接、双通道施工图、
> 设计决策记录）见各实现文件的代码注释，原始设计文档保留在 git 历史
> （`git show 07ebdba2:docs/CHANGE_NOTIFICATION_DESIGN.md`）。

## 1. 这是什么

统一的三引擎（SQLite / MySQL / PostgreSQL）**表级变更订阅接口**，挂在
`EngineAdapter` 基类上。消费方订阅一张物理表，在表被写入时收到"失效提示"。

核心语义（务必先理解）：

- **事件是失效提示（invalidate hint），不是数据管道**——事件负载**不带行数据**，
  收到事件后应重新查询数据。漏事件最多延迟一次 UI 刷新，永不导致数据不一致。
- **检测层对消费方透明**——实时层（C# 写漏斗事件，毫秒级）+ 完备层
  （计数器轮询兜底，最坏 ~5s）自动组合，消费方无感。
- **自写去重**——本进程自己的写入会经实时层正常触发对应表回调（毫秒级失效提示，属预期刷新信号）；完备层基线同步吸收自写，不会因自写再触发一次 count=-1 全量失效，无需防御。
- 当前尚无生产消费方（接口就绪，等待首个接入，如多账号 Store 热替换）。

## 2. 接口契约

```js
/**
 * 订阅某张物理表的变更。
 * @param {string} table 物理表名（以 userTable(prefix, name) 计算，见 §3）
 * @param {(evt: { table: string, count: number, ts: number }) => void} cb
 * @returns {() => void} unsubscribe —— Store/组件卸载时调用
 */
onTableChange(table, cb)
```

- **@optional**：基类提供默认实现（no-op）；未实现的 adapter 行为与现状完全一致，
  不强制任何实现方改动。
- **事件负载**：

| 字段 | 含义 |
|---|---|
| `table` | 物理表名（与订阅键一致） |
| `count` | 本次批量变更行数（bulkInsert 500 行 = 1 条事件，count=500）；**`-1` 表示全量失效提示**——完备层兜底触发（外部写者/无法识别表的写入），或漏斗无法确定行数的写入；收到 `-1` 应重查该表全部数据 |
| `ts` | 发射时间戳（Unix 毫秒） |

- **幂等**：同实例同表同回调重复订阅安全（Set 去重）；退订函数可重复调用。
- **线程**：回调在 JS 主线程执行（CefSharp 事件编组 / Electron IPC 透传；其中 node-api-dotnet 的 .NET→JS 委托编组为外部调研结论、未经本项目实测，编组失败时由完备层兜底，仅响应性降级）。

## 3. 获取实例：订阅挂载点 = adapter 实例

订阅挂在 **adapter 实例**上（"实例即边界"），事件按 `conn` 路由到对应实例：

| 实例 | 来源 | 收到的事件 |
|---|---|---|
| 默认单例（主库） | `import { adapter } from '@/services/database/adapter'`（或 `initAdapter(mode)` 后） | `conn = 'default'` 的事件 |
| 外部实例 | `createAdapter({ connection: 'sqlite:///D:/data/ext.db' })` | `conn = connectionString` 的事件 |
| 无对应实例的连接 | — | 事件被丢弃 |

- 多账号天然隔离：账号前缀不同的表是不同物理表，各实例只收自己的事件。
- 实例级隔离意味着：外部实例（如 push/pull 引擎的 src/dst adapter）只收自己
  连接的事件，不会收到主库事件。

## 4. 物理表名：userTable(prefix, name)

`table` 参数是**物理表名**，用实例方法 `userTable(prefix, name)` 计算
（前缀随账号）：

```js
// SQLite / MySQL:prefix_name
adapter.userTable('abc', 'feed_gps'); // → 'abc_feed_gps'
// PostgreSQL:schema 限定名
pgAdapter.userTable('abc', 'feed_gps'); // → 'account_abc.feed_gps'
```

## 5. 快速示例

```js
import { adapter } from '@/services/database/adapter';

// 订阅某账号的 feed_gps 表（prefix 为该账号前缀）
const unsubscribe = adapter.onTableChange(adapter.userTable(prefix, 'feed_gps'), (evt) => {
    if (evt.count === -1) {
        // 全量失效：重查该表全部数据
        feedStore.invalidateAll(prefix);
    } else {
        // 增量失效：重查该表（count 仅为提示，实际以查询结果为准）
        feedStore.invalidate(prefix);
    }
});

// 组件/Store 卸载时退订（与 Vue watch stop 同构）
unsubscribe();
```

与 TanStack Query 衔接：收到事件后 `invalidateQueries` 对应 query key——
本接口即"下移到 DB 层的 refetchInterval"。

## 6. 行为语义要点

- **订阅即启停**：首个订阅自动开启 C# 写漏斗与轮询定时器；全部退订自动关闭。
  **无消费者时写路径近零开销**（仅表名提取正则与门控布尔读；无序列化、无 dv 快照、无事件派发）——无需手动管理，也不要手动轮询。
- **事务**：回滚不通知（仅 COMMIT 成功后发射）；事务内同表的批量写入合并为该表 COMMIT 后的一条事件（多表事务每表各一条）。
- **完备层兜底**：订阅期间每 5s 比对原生计数器（SQLite `data_version` /
  MySQL `performance_schema`），版本前进且无对应漏斗事件时触发
  `count=-1` 全量失效——外部进程写库、绕过漏斗的直写也能被发现（最坏 ~5s）。
  **PG 例外**：外部写者由 trigger + NOTIFY 原生推送表级实时覆盖（见 §8），
  计数器轮询仅作安全网（监听通道故障/未装触发器时兜底）。
- **桥不可用降级**：通道绑定失败/编组失败静默，完备层兜底保证不漏，仅响应性降级。

## 7. 边界与限制

- **粒度**：表级（无行级订阅；行级被设计明确否定——负载一旦带行数据就变成
  数据管道，漏一行即数据不一致）。
- **外部进程写库**：非支持场景（单进程应用，DB 归其所有）；完备层兜底检测。
  PG 由 trigger + NOTIFY 原生覆盖（需消费方安装触发器，见 §8）。
- **DBMerger 裸连接**（`Merger.cs` 升级合并工具）：不产生通知，无需处理。
- **未实现**：拉式降级接口 `getPendingChanges(sinceId)`（设计备选，**未实现**，
  不要依赖）；PG/MySQL 的 trigger outbox 轮询形态（Phase 4 备选，未实施——
  PG 已走 NOTIFY 推送，MySQL 维持计数器轮询）。

## 8. 引擎支持矩阵

| 引擎 | 实时层 | 完备层 | 表名形态 |
|---|---|---|---|
| SQLite | ✅ C# 漏斗 | `PRAGMA data_version` 轮询兜底（DB 级） | `prefix_name` |
| MySQL | ✅ C# 漏斗 | `performance_schema` 轮询兜底（表级源 → DB 级信号） | `prefix_name` |
| PostgreSQL | ✅ C# 漏斗 | ✅ **trigger + NOTIFY 原生推送**（表级，含外部写者；需消费方安装触发器，默认仍计数器轮询）→ `pg_stat_user_tables` 行级计数兜底 | `account_prefix.name` |

三端接口语义同构；检测机制允许引擎异构（上层接口统一）。PG 的 schema
限定表名与漏斗事件直配（`ExtractTable` 正则支持 `[\w.-]+` 限定名）。

**PG 原生推送说明**：`SetChangeEnabled(true)`（首个订阅）时建立专用
`LISTEN vrcx_change` 连接，随门控关闭（全部退订）断开。触发器由消费方
经 `PostgreSQL.CreateChangeTrigger(table)` 安装（每张 watched 表一个
`FOR EACH STATEMENT` 触发器，先 `EnsureChangeFunction()` 一次）。
自写去重：漏斗发射时间戳在 dv 读/COMMIT 之前记录，监听侧 500ms 窗口内
的 NOTIFY 视为自写镜像丢弃；窗口误杀的外部写由计数器轮询（≤5s）补上
——去重不会造成漏报。NOTIFY 事件的 dv 读自池中独立连接（监听连接
Waiting 态不可查询），失败时事件携带 dv=null，由计数器轮询兜底。
`ListChangeTriggers()` / `DropChangeTrigger(table)` 管理已装触发器。

## 9. 后续规划（未实施）

- **PG trigger + NOTIFY 推送形态**：✅ 已实施（2026-08-02）。早前"被否
  （三端无法对称）"的理由不成立——上层 `onTableChange` 接口统一，检测
  机制允许引擎异构；实现成本仅每表一个 statement 级触发器 + 一条随门控
  启停的专用监听连接（与 SQLite 观察连接同构），自写镜像由 500ms 去重
  窗口丢弃（漏斗时间戳在 dv 读/COMMIT 之前落账），计数器轮询保留为
  安全网；NOTIFY 事件 dv 读自池中独立连接（2026-08-02 修复）。
- **MySQL 原生推送**：无 NOTIFY 等价物，维持计数器轮询兜底（无改动空间）。
- **DDL 动词层泛化**：`createTrigger`/`dropTrigger`/`listTriggers` 三端
  统一形态（当前 PG 已实现对应方法，MySQL/SQLite 待需求）。
