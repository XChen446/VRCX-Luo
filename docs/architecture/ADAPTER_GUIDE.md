# 适配器编写指南（如何实现一个新 EngineAdapter）

> 面向**实现方**开发者的步骤化教程：从零为一个新数据库引擎编写 `EngineAdapter` 子类并接入 VRCX-K。本文回答"怎么写"；方法签名、语义与方言差异的完整契约见 `ADAPTER_API.md`；PostgreSQL 引擎的完整设计案例见 `PGSQL_DESIGN.md`（1242 行，含类型映射表、失败模式、切片划分）；MySQL 引擎可参考同一模式（`MySQLAdapter.js`）。
>
> **现状基线**（2026-08）：三引擎已落地——SQLite（`SQLiteAdapter.js`，默认）、PostgreSQL（`PgSQLAdapter.js`，1760 行）、MySQL/MariaDB（`MySQLAdapter.js`，1229 行，`mariadb` 为 `mysql` 别名）。接口冻结于 **42 abstract + 3 optional**，健康检查 3 抽象（`isConnected`/`getHealth`/`getPoolStats`）与事务重构（`withTransaction`/`_txStack`）为冻结后破例（详见 §1.2）。

---

## 1. 架构与设计约束

### 1.1 分层位置

```
JS 业务层:18 个 database/* 模块(feed.js/gameLog.js/...)  ← 338 处 adapter 调用,零改动
                    │ import { adapter } from '@/services/database/adapter'
adapter/index.js:引擎工厂(initAdapter / createAdapter / _engineSpec 惰性注册表)
   ├── SQLiteAdapter.js  ├── PgSQLAdapter.js  └── MySQLAdapter.js
                    │ globalThis.SQLite / globalThis.PostgreSQL / globalThis.MySQL
C# 后端:SQLite.cs / PostgreSQL.cs / MySQL.cs(连接管理 + 参数绑定 + 事务 pin + 健康检查)
```

**核心不变量（新引擎必须遵守）**：

| ID | 约束 | 说明 |
|----|------|------|
| D1 | **业务模块零改动** | 业务模块只写 `@key` 命名参数 + 调结构化方法（insert/select/...）。方言差异全部收敛在适配器内部（参数绑定、冲突处理、DDL、SQL 片段） |
| D2 | **迁移跳过语义** | 对非 sqlite 引擎，`database.after: "sqlite"` 锁定的 .map 必须被跳过而非报错（`checkDatabaseCompatibility` 返回 skip，调度入口 continue + warn） |
| D3 | **配置驱动连接** | 连接参数从 `VRCX_Database.{mode, host, port, username, password, name}` 读取（bootstrap 见 `CONFIG_REFACTOR.md`），字段级校验防连接串注入 |
| D4 | **元数据返回限定名** | `listTables` 返回可直接用于 SQL 的完整限定名（SQLite/MySQL 平铺名，PG `account_{prefix}.{name}`） |
| D5 | **不建跨账号聚合视图** | 多账号查询维持 `withPrefix` 串行单 prefix 模式 |

### 1.2 接口冻结政策

- 基类冻结于 **42 abstract + 3 optional**（2026-07-16 冻结）。**新增抽象方法需要破例流程**：设计文档说明理由 → review 通过 → 基类 + 全部现有子类同步实现。
- 冻结后已有两次破例（可作参考模板）：
  1. **2026-07-25**：事务接口 `begin()/commit()/rollback()` 改名为 `beginTransaction()/commit(connId)/rollback(connId)`，新增 `withTransaction(fn)` 默认实现 + `_txStack` 实例字段（原因：PG 池化设计导致跨调用事务断裂，需 JS 层维护事务上下文栈）。
  2. **2026-07-26**：`isConnected()`/`getHealth()`/`getPoolStats()` 提升为基类抽象（三引擎对称，commit `c08c62e1`）；`getPoolStats().poolIdle` 改名 `availableCapacity`（commit `9429cca8`）。
- **引擎特有扩展**（如 PG 的 `dropUserSchema`）不加入基类，作为子类特有方法，调用方按 `typeof adapter.x === 'function'` 能力检测。
- `engineType` getter 是元数据（默认 `'unknown'`），不属于 42+3 接口——子类必须覆写，否则迁移兼容性检查会暴露未覆写问题（`'unknown'` 不会静默冒充 sqlite）。

---

## 2. 编写步骤总览

```
步骤 0  C# 后端封装(连接管理/事务/健康检查) + 4 处桥注册
步骤 1  继承 EngineAdapter,实现全部 @abstract(47 个)
步骤 2  参数绑定方言(@key → 引擎占位符)
步骤 3  DDL 类型映射(createTable / initSchema)
步骤 4  SQL fragments(5 个 @engine-specific 方法)
步骤 5  事务钩子(_doBegin/_doCommit/_doRollback/_doKeepAlive)
步骤 6  注册进 adapter/index.js(_engineSpec + initAdapter + createAdapter)
步骤 7  迁移运行器兼容(database 引擎锁语义)
步骤 8  测试(契约测试/方言单测/集成测试/CI matrix)
步骤 9  文档与验收
```

---

## 3. 步骤 0：C# 后端封装与桥注册

每个引擎有一个 C# 封装类（`Dotnet/SQLite.cs` / `PostgreSQL.cs` / `MySQL.cs`），JS 侧通过 `globalThis` 全局对象调用。**适配器不直接碰驱动，全部经 C# 桥**。

### 3.1 必须提供的能力

| 能力 | C# 方法（约定） | 说明 |
|------|----------------|------|
| 初始化 | `Init()` | 读 `VRCX_Database.*` 字段拼连接串（D3），字段级校验（`ValidateField`/`ValidatePassword` 白名单+黑名单：拒绝 `;` `'` `"` `\0` `\n` `\r`）；连接池化 |
| 查询 | `ExecuteJson(sql, args)` → JSON 字符串 | 行结果序列化为 JSON 数组（`object[][]`），JS 侧 `JSON.parse` |
| 写入 | `ExecuteNonQuery(sql, args)` → number | 影响行数 |
| 事务 | `BeginTransaction()` → connId / `CommitTransaction(connId)` / `RollbackTransaction(connId)` / `KeepAliveTransaction(connId)` | **PG 必须返回真实 connId 并 pin**（池化）；SQLite/MySQL 单连接可发 SQL 返回 0（见步骤 5） |
| 健康 | `Ping()` → bool / `GetHealth()` → JSON / `GetPoolStats()` → JSON / `ClearIdleConnections()` | `isConnected` 必须 await（双运行时见 §4.10） |
| 变更通知 | `SetChangeEnabled(bool)`、事件 `DatabaseChanged` | 写漏斗门控；无消费者时 `EmitChange` 首行早退零成本（见 `ADAPTER_API.md` §9） |

### 3.2 4 处桥注册（一个都不能少）

| 文件 | 改动 |
|------|------|
| `Dotnet/Cef/JavascriptBindings.cs` | `repository.Register("MySQL", MySQL.Instance);`（CefSharp 同步桥） |
| `Dotnet/Program.cs` | 引擎初始化分支：`else if (mode == "mysql") { MySQL.Instance.Init(); }` |
| `src-electron/main.js` | 同上 Electron 分支（`interopApi.getDotNetObject('MySQL').Init()`） |
| `vitest.setup.js` | `globalThis.MySQL = new Proxy({}, { get: () => noopAsync });`（测试 stub，保证 import 不报 ReferenceError） |

> **双运行时注意**：CefSharp 下桥方法同步返回；Electron 下 `InteropApi` Proxy 把所有调用包成 Promise。JS 侧统一 `await`（await 同步值立即返回，await Promise 等待解析）。`isConnected()` 声明为 `async` 正是为此——`Boolean(Ping())` 在 Electron 下恒为 `true`。

---

## 4. 步骤 1：实现全部 @abstract 方法

继承 `EngineAdapter`（构造器有 `new.target` 防实例化保护）。基类方法全部 `throw new Error('abstract')`，**漏实现会在运行时调用时立即报错**。

按类别实现（47 个）：

| 类别 | 方法 | 方言差异重点 |
|------|------|--------------|
| 原始执行 | `execute(callback, sql, args)` / `executeNonQuery(sql, args)` | 参数绑定入口（见步骤 2）；`execute` 逐行回调 positional array |
| CRUD | `insert` / `bulkInsert` / `update` / `updateWhere` / `delete` / `deleteAll` / `deleteWhere` / `increment` / `upsertPartial` | 冲突处理：SQLite `INSERT OR IGNORE/REPLACE`；PG `ON CONFLICT DO NOTHING/UPDATE`；MySQL `INSERT IGNORE/REPLACE INTO` / `ON DUPLICATE KEY UPDATE`。**SQL 生成与 SQLiteAdapter 同构**（`@key` 格式），仅方言关键字不同 |
| SELECT | `selectOne` / `select` / `selectWhere` / `selectJoin` / `selectWhereIn` / `selectUnion` / `selectGroupBy` | `selectUnion` 用派生表包装 `SELECT * FROM (branch)` 三端通用（PG 原生支持分支括号但为保持同构沿用包装） |
| COUNT | `count` / `countWhere` | — |
| DDL | `createTable` / `createIndex` / `alterTableAddColumn` / `alterTableDropColumn` / `alterTableRename` / `dropTable` | 类型映射（见步骤 3）；`createTable` 的 columns 参数支持 `[{ name, type, constraints? }]` 或裸字符串 |
| 事务钩子 | `_doBegin` / `_doCommit` / `_doRollback` / `_doKeepAlive` | 见步骤 5 |
| 维护 | `vacuum` / `optimize` | SQLite `VACUUM`/`PRAGMA optimize`；PG `VACUUM ANALYZE`/`ANALYZE`；MySQL `OPTIMIZE TABLE`/`ANALYZE TABLE` |
| Schema | `initUserSchema(prefix)` / `initGlobalSchema()` | **自带完整 DDL**（不复用其他子类元数据），类型映射后翻译；用户表前缀规则见下 |
| 元数据 | `listTables` / `getTableColumns` / `listTablesTypes` | `listTables` 返回完整限定名（D4）；`listTablesTypes` 返回结构化对象 `{tableName, columns: [{name, type, notNull, defaultValue, isPK, isHidden}]}`（`vrcx.js` 唯一消费方） |
| 命名 | `userTable(prefix, name)` | SQLite/MySQL `{prefix}_{name}`；PG `account_{prefix}.{name}` |
| SQL 片段 | `sqlToUnixMs` / `sqlExtractWorldId` / `sqlHasInstanceId` / `sqlDate` / `sqlEnterTime` | 见步骤 4 |
| 健康探针 | `getPoolStats` / `clearIdleConnections` / `isConnected` / `getHealth` | 见 §4.10 |

**用户表前缀规则**（`src/services/database/index.js`）：prefix 由 userId 去掉 `-`/`_` 生成，数字开头补 `_`——恰好满足 PG schema 命名规则，新引擎沿用即可。

**SQL 逃生口纪律**：`execute`/`executeNonQuery` 是逃生口，生产模块应优先使用结构化方法；新引擎实现时以 `SQLiteAdapter.js` 为蓝本逐方法对照。

---

## 5. 步骤 2：参数绑定方言（核心）

业务模块写 **`@key` 命名占位符** + `{key: val}` 参数对象。三引擎三种转换方式：

| 引擎 | 机制 | 说明 |
|------|------|------|
| SQLite | `_normalizeArgs` 加 `@` 前缀传命名 map | C# `IDictionary` 命名参数 |
| PostgreSQL | `_bind(sql, args)` 扫描 SQL 文本 | `@key` → `$N` 位置占位符 + positional array（见下） |
| MySQL | `_normalizeArgs` 转数组 | `?` 位置占位符 |

### PG `_bind` 参考实现（新引擎最复杂模式）

```js
// 正则:/@([A-Za-z_][A-Za-z0-9_]*)/g 贪婪匹配完整标识符
// 规则:
//  1. @user_id 不会误匹配 @user(整串匹配)
//  2. 重复 @key 复用同一 $N,values 只放一次
//  3. 不在 args 中的 @ident 保留原样(触发 PG 报错暴露漏传参数,比静默错绑安全)
//  4. 字符串字面量内的 @identifier 会被匹配(与 SQLite 同构的已知边界)
```

关键验收点（契约测试会覆盖）：
- `_bind('WHERE @user_id = @user', { user_id: 1, user: 'x' })` → `WHERE $1 = $2`, `[1, 'x']`
- `_bind('@a AND @a', { a: 1 })` → `$1 AND $1`, `[1]`

---

## 6. 步骤 3：DDL 类型映射

`createTable`/`initUserSchema`/`initGlobalSchema` 接收 SQLite 风格类型，适配器内部映射（`PgSQLAdapter._mapColumnType` 模式，**最长匹配优先**）：

| SQLite 类型 | PostgreSQL | MySQL |
|-------------|-----------|-------|
| `TEXT` | `TEXT` | `TEXT` |
| `INTEGER` | `BIGINT`（8 字节防溢出） | `BIGINT` |
| `INTEGER PRIMARY KEY` | `BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY` | `BIGINT AUTO_INCREMENT PRIMARY KEY` |
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY`（**必须 BY DEFAULT 非 ALWAYS**——搬迁管道会显式复制原 id，ALWAYS 拒绝搬迁） | 同上 |

**必须按最长匹配优先替换**（先匹配 AUTOINCREMENT 再匹配 PRIMARY KEY），否则 `INTEGER PRIMARY KEY` 先被替换后残留 `AUTOINCREMENT` 后缀。

**initSchema 自带 DDL**：每个子类的 `initUserSchema`/`initGlobalSchema` 携带完整引擎 DDL（不复用其他子类元数据——SQLite 的 DDL 是内联字符串非结构化元数据，且接口未定义表元数据抽象）。以 `SQLiteAdapter.js` L900-1049 的 22 用户表 + 18 全局表为蓝本翻译。

**索引策略**：
- 全局表索引名保持原名（如 `idx_gamelog_location_world_created`），schema 内唯一
- 用户表索引名：SQLite 带 prefix 全局唯一；PG 去 prefix（schema 内唯一，且规避 63 字节限制）

---

## 7. 步骤 4：SQL fragments（5 个 @engine-specific）

| 方法 | 语义 | SQLite | PostgreSQL | MySQL |
|------|------|--------|-----------|-------|
| `sqlToUnixMs(col)` | ISO 时间 → Unix 毫秒 | `strftime('%s', col) * 1000` | `EXTRACT(EPOCH FROM col::timestamptz) * 1000` | `UNIX_TIMESTAMP(col) * 1000` |
| `sqlExtractWorldId(col)` | `"wrld_x:12345"` → `"wrld_x"` | `SUBSTR(col, 1, INSTR(col, ':') - 1)` | `SUBSTRING(col FROM 1 FOR POSITION(':' IN col) - 1)` | `SUBSTRING_INDEX(col, ':', 1)` |
| `sqlHasInstanceId(col)` | 含 `:` | `INSTR(col, ':') > 0` | `POSITION(':' IN col) > 0` | `LOCATE(':', col) > 0` |
| `sqlDate(col)` | 取日期部分 | `date(col)` | `col::date` | `DATE(col)` |
| `sqlEnterTime(ts, ms)` | enter = leave − duration | `strftime('%Y-%m-%dT%H:%M:%SZ', ts, '-' \|\| (ms/1000.0) \|\| ' seconds')` | `to_char(ts::timestamptz - (ms/1000.0) * INTERVAL '1 second', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')` | `DATE_SUB(ts, INTERVAL (ms/1000) SECOND)` |

> **格式一致性是硬要求**：`sqlEnterTime` 返回值参与 `BETWEEN` 字典序比较（gameLog.js 唯一调用点，严格假设 ISO `YYYY-MM-DDTHH:MM:SSZ`）。PG 曾用 `::text` 方案因格式不一致（空格分隔 +00 时区）被否决，改用 `to_char` 严格对齐——新引擎实现后必须用集成测试验证格式。

---

## 8. 步骤 5：事务钩子

**生产代码只用 `withTransaction(fn)`**（基类默认实现）。子类只实现 4 个 `@protected` 钩子：

| 钩子 | SQLite/MySQL（单连接） | PostgreSQL（池化） |
|------|----------------------|-------------------|
| `_doBegin()` | 发 `BEGIN`，返回 `0` | 调 C# `BeginTransaction()`，返回**真实 connId** |
| `_doCommit(connId)` | 发 `COMMIT`（忽略 connId） | `CommitTransaction(connId)` |
| `_doRollback(connId)` | 发 `ROLLBACK` | `RollbackTransaction(connId)` |
| `_doKeepAlive(connId)` | 调 C# 对应方法 | `KeepAliveTransaction(connId)` |

**机制**：
- 基类维护 `_txStack`（connId 栈）；`execute`/`executeNonQuery` 读栈顶决定走 pinned 连接还是默认池——**事务内写入自动走 pin，调用方无感**。
- C# 侧 60s idle 超时（`TX_IDLE_MS = 60000`，三引擎对称的 `_pinned` + InFlight/TimedOut 竞态防御）。超时回滚后继续用该 connId 会抛错——`keepAlive()` 是逃生舱（长交互前续命），但推荐把交互拆到事务外。
- 不支持嵌套：栈非空时 `withTransaction`/`beginTransaction` 抛错。
- 详细设计见 `TRANSACTION_DESIGN.md`。

---

## 9. 步骤 6：注册进 adapter/index.js

```js
// _engineSpec 注册表(新引擎加一条,一行改动)
const _engineSpec = {
    postgresql: { load: () => import('./PgSQLAdapter.js'), className: 'PgSQLAdapter' },
    mysql:      { load: () => import('./MySQLAdapter.js'),  className: 'MySQLAdapter' }
    // 新引擎:  { load: () => import('./XxxAdapter.js'),  className: 'XxxAdapter' }
};
```

**必须惰性加载**（literal-path loader 函数）：
- 静态 import 会让 sqlite 模式测试被迫 transform 重型适配器模块（PgSQL 实测 transform 时间 ~11x、import ~3.3x，拖垮无关测试超时）。
- 必须用**字面量路径** `import('./XxxAdapter.js')`：Rolldown 静态分析变量路径会退化为运行时网络 fetch，打包后在 CefSharp/Electron 内 404。
- `createAdapter({ connection })` 同步扩展 URI scheme：`sqlite://`、`postgresql://host:port/db`、`mysql://`、`mariadb://`（别名归一化）。
- `initAdapter(mode)` 由 `interopApi.js` 启动时调用（读 `VRCX_Database.mode` 一次传入）；`mariadb` 归一化为 `mysql`。
- 新实例若携带 `connectionString`，会注册进 `_changeInstances` 路由写漏斗事件（conn = connectionString）。

---

## 10. 步骤 7：迁移运行器兼容

迁移运行器（`src/services/database/migrations/index.js`）按 `.map` 声明执行（模板见 `migrations/_template.map`，266 行完整语法参考）：

- **引擎检测**：`getDatabaseEngine()` 读 `adapter.engineType`（不重复读配置，与 `initAdapter(mode)` 构造的实例保持同步）。
- **引擎锁语义**：`.map` 可声明 `database: { before, after }`；`after: "sqlite"` 的 .map（如 v16）在非 sqlite 引擎上返回 **skip**（不抛错），调度入口 `console.warn('[迁移] 跳过 ...')` + continue。
- **checkpoint**：skip 的 .map 视为已满足（新引擎 initSchema DDL 已含最新结构），`recordCheckpoint` 仍记录目标版本。
- **JSON Schema 校验**：`.map` 结构在运行前校验（7.9）；`--dry-run` 预演模式（7.10）。
- **事务保护**：每个 version+type 独立事务（BEGIN/COMMIT/ROLLBACK），操作幂等，失败可重试。
- **`.map` 数量现状**：全仓仅 `16/schema.map` + `16/data.map`（均 `after: "sqlite"` 锁定）。新引擎首次启动：v16 被 skip，checkpoint 记 LATEST。

**新引擎需要配置的 C# 初始化**：`Program.cs`（Cef）+ `src-electron/main.js`（Electron）引擎分支 + `JavascriptBindings.cs` 注册 + `vitest.setup.js` stub——共 4 处（步骤 0 §3.2）。

---

## 11. 步骤 8：测试

### 11.1 分层策略

| 层 | 覆盖 | 环境 |
|----|------|------|
| 契约测试 | `runAdapterContractTests(adapterFactory, name)`（`test/contract/adapter-contract.js`）：三引擎共用的接口行为（execute/CRUD/SELECT/COUNT/事务栈契约） | SQLite 内存库（默认跑）；远程引擎 wrapper 仅在容器可用时跑 |
| 方言单测 | `_bind`/类型映射/SQL fragments/userTable 的字符串输出 | 无需真实引擎 |
| 集成测试 | initSchema 建表、CRUD 语义、listTables 限定名、搬迁行数校验 | 真实引擎容器（CI service / 本地 docker） |
| 业务回归 | 现有 SQLiteAdapter 测试 + 业务模块测试在 stub 下全绿（**新引擎 stub 不得破坏 sqlite 模式**） | vitest |

### 11.2 CI 集成（参考现有配置）

- PG 16/17：`ikalnytskyi/action-setup-postgres@v8`（Linux/macOS/Windows，无需 Docker service container），env `PG_TEST_HOST/PORT/USER/PASSWORD/DB/VERSION`，测试用 `describe.skipIf(!process.env.PG_TEST_HOST)` 跳过无容器环境。
- MySQL 8.0/8.4：`shogo82148/actions-setup-mysql@v1`。
- 本地开发：`docker run -d --name vrcx-pg -e POSTGRES_PASSWORD=vrcx -e POSTGRES_USER=vrcx -e POSTGRES_DB=vrcx -p 5432:5432 postgres:16`（MySQL 同理）。

### 11.3 契约测试去方言化技巧

- 用例 SQL 保持 `@named` 参数——PG `_bind` 自动转 `$N`，MySQL 转 `?`，对契约测试透明。
- `INTEGER PRIMARY KEY` 由各引擎类型映射处理。
- 引擎特有结构（如 `getTableColumns` 的 PRAGMA 列形状）需镜像用例或仅引擎内测试。

---

## 12. 步骤 9：文档与验收

1. **更新 `ADAPTER_API.md`**：方法签名表补方言差异列；引擎支持矩阵（§9.7）加新引擎行。
2. **更新 `docs/README.md`** 导航。
3. **设计文档**：按 `PGSQL_DESIGN.md` 模板（范围界定/文件级改动/接口设计/类型映射/迁移路径/测试策略/不变量/失败模式/切片/验收）产出一份。
4. **tasklist（Issue #3）**：按 Phase 9 模式登记子任务（本仓库约定，需执行者授权才可勾选）。

### 12.1 检查清单（DoD）

- [ ] C# 封装 + 4 处桥注册 + `dotnet build` 两 csproj 通过
- [ ] 47 个 @abstract 全部实现；`engineType` 覆写为引擎标识
- [ ] 业务模块 338 处调用零改动（git diff 确认）
- [ ] `initAdapter(mode)` / `createAdapter(scheme)` 可选中新引擎
- [ ] 迁移运行器：sqlite 锁 .map 正确 skip，checkpoint 记录
- [ ] 契约测试通过；方言单测覆盖 _bind/类型映射/fragments
- [ ] 集成测试在真实容器全绿；CI matrix 加入
- [ ] `ADAPTER_API.md` + 设计文档 + 导航更新
- [ ] 健康检查三方法可用（StatusBar 池监控消费 `getPoolStats` 基础字段）
- [ ] 写漏斗事件路由就绪（wireFunnelEvents 桥名加入 `CHANGE_BRIDGES`）

---

## 13. 常见陷阱（三引擎实现中踩过的）

| 陷阱 | 说明 |
|------|------|
| `_bind` 边界匹配 | `@user_id` 撞 `@user` 会错绑——贪婪完整标识符正则 + 单测覆盖 |
| 字符串字面量 `@` | `'foo@bar.com'` 中 `@bar` 会被当参数——与 SQLite 同构的已知边界，现有代码隐含假设无冲突 |
| LIKE 下划线通配 | PG/MySQL 的 `_` 是单字符通配——`account_%` 会匹配 `accountX`，需 `ESCAPE '\'` 转义 |
| 保留字 | PG `user`/`order` 等是保留字；VRCX 用 `user_id`/`type`/`time` 均非保留字，新引擎需扫描 50+20 表 DDL |
| 大小写折叠 | PG 未加引号标识符折叠小写；VRCX 表名均小写蛇形，DDL 不加引号与 SQLite 一致 |
| GENERATED ALWAYS vs BY DEFAULT | 搬迁管道显式复制自增 id，ALWAYS 拒绝——必须 BY DEFAULT |
| sqlEnterTime 格式 | BETWEEN 字典序比较依赖严格 ISO `YYYY-MM-DDTHH:MM:SSZ`——to_char/格式化对齐 |
| 事务 60s 超时 | 事务内长 await 会被静默回滚；`keepAlive()` 续命或拆到事务外 |
| 惰性 import 变量路径 | Rolldown 打包后 404——必须字面量路径 |
| 双运行时 await | CefSharp 同步 / Electron Promise——统一 `await`，`isConnected` 必须 async |
| 连接串注入 | host/password 含 `;`/`'` 可注入额外键值对——字段级白名单/黑名单校验 |
| 参数上限 | PG 单语句参数上限 65535——bulkInsert 分批（默认 500 行/批） |
