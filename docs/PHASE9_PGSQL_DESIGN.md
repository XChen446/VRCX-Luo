# Design Document — Phase 9 PostgreSQL 适配器

> **版本**:v1.2(并入 PR #13 review #3 的健康检查 async 化 + 连接池 `poolIdle` → `availableCapacity` 语义修正)· **分支**:`database-refactor-AsyncEvent-fix` · **日期**:2026-07-26
> **覆盖范围**:Issue #3 Phase 9 task 9.2–9.16(共 15 个子任务)
> **设计约束**:D1–D5(用户已拍板,不可违背)
> **接口基线**:EngineAdapter.js 42 abstract + 3 optional + 健康检查 3 抽象(`isConnected()`/`getHealth()`/`getPoolStats()`,2026-07-26 破例提升入基类)
>
> **v1.1 更新(2026-07-18)**:8 项待核实事项已全部核实(详见 §11.3 结尾"核实结论"附录)。3 项修订实现条款(§4.1.5 insert replace 分层、§4.1.7 session_id 用 BY DEFAULT、§4.1.12 sqlEnterTime 改 to_char);3 项印证假设关闭风险(R4/R13/§3.2.11);2 项重新定性(R14 待产品决策、搬迁 UI 必须新建于 AdvancedTab)。
>
> **v1.2 更新(2026-07-26)**:PR #13 第三轮 review 后的修正:
>   1. **接口冻结破例**:`isConnected()` / `getHealth()` 从 PgSQLAdapter 扩展方法提升为 EngineAdapter 基类抽象方法(三引擎对称 commit `c08c62e1`)。原 §4.1.15 / §11.1 / §11.2 / §11.3 末尾的"不入基类"决定撤销。
>   2. **`isConnected()` 改 async**:Electron 下 C# 桥返回 `Promise<boolean>`,`Boolean(Ping())` 恒 true 会导致探针失真。统一 `async isConnected()` + 调用方 `await`(commit `9dedc048`,fixup 到 `762b8943`)。
>   3. **`GetPoolStats().poolIdle` 语义修正**:旧公式 `_totalBorrowed - _pinned.Count` 算的是"非 pinned 借出连接数"而非"池中空闲连接数",误导 StatusBar 绿色波线。改名 `availableCapacity` + 公式改 `_maxPoolSize - _totalBorrowed`(commit `9429cca8`)。
>   4. **`getHealth()` payload 字段订正**:C# 实际返回 `{ connected, latencyMs, lastHealthCheck }`,**无 `poolSize` 字段**(原 §4.1.15 JSDoc 笔误,代码从未生成过该字段)。

---

## 0. 摘要

本设计为 VRCX-Luo 新增 PostgreSQL 后端能力,使现有 18 个 `database/*` 业务模块的 338 处 adapter 调用**零改动**地运行在 PgSQL 之上。核心机制是新建 `PgSQLAdapter`(继承 EngineAdapter),其内部 `_bind(sql, args)` 方法扫描 SQL 文本把 `@key` 命名占位符替换为 PgSQL 位置占位符 `$N` 并把 `{key:val}` 转为 positional array(D1),对业务模块完全透明。PgSQL 采用**每账号一个 schema**的隔离方案(`account_{prefix}.{table}`),`userTable()` 返回带 schema 的二段式限定名,`listTables()` 返回带 schema 的完整限定名(D4)。PgSQL 作为新引擎无历史库,`initUserSchema/initGlobalSchema` 直接建 PG 版表,迁移运行器对非 sqlite 引擎跳过 `database.after:"sqlite"` 锁死的 .map(D2)。C# 端 `PostgreSQL.cs.Init()` 改为读 `VRCX_Database.host/port/username/password/name` 字段拼装 Npgsql 连接串(D3)。Phase 9 仅做单账号 schema 隔离,不新建跨账号 UNION ALL 聚合视图(D5)。配套补齐 C#→JS 桥注册 4 处缺口、vitest PostgreSQL stub、CI PG service container、docker-compose.pgsql.yml、SQLite→PgSQL 数据搬迁管道。

---

## 1. 范围界定

### 1.1 In Scope(task 9.2–9.16 逐项)

| Task | 标题(Issue #3 原文) | 本设计覆盖点 |
|------|----------------------|---------------|
| **9.2** | NpgsqlDataSource 连接池实现,自动重连机制 | §4.2 PostgreSQL.cs Init 改造 + 连接池 + 重连 |
| **9.3** | 新建 `src/services/database/adapter/PgSQLAdapter.js` | §4.1 全章(类骨架 + `_bind` + execute/executeNonQuery + CRUD) |
| **9.4** | 方言适配:参数风格(`$1`)、冲突处理(`ON CONFLICT`)、DDL 类型映射 | §4.1(_bind 算法 + insert/upsert 方言) + §5.1 类型映射表 |
| **9.5** | SQL 片段:`sqlToUnixMs`/`sqlDate`/`sqlExtractWorldId` 等 | §4.1 SQL fragments 小节(5 个方法) |
| **9.6** | Schema 隔离:`userTable(prefix,name)` → `account_{prefix}.{name}` | §4.1 userTable + §8 不变量 INV-01 |
| **9.7** | `initUserSchema(prefix)`:先 `CREATE SCHEMA` 再建表 | §4.1 initUserSchema + §5.2 用户表 DDL |
| **9.8** | `initGlobalSchema()`:全局表放 `public` schema | §4.1 initGlobalSchema + §5.3 全局表 DDL |
| **9.9** | `listTables` → pg_catalog,`getTableColumns` → information_schema | §4.1 元数据三方法 + §8 INV-02 |
| **9.10** | 跨 Schema 查询:`aggregatedView.js` 使用全限定名 | §1.2/§10 按 D5 降级为"验证现有 aggregatedView.js 透明适配" |
| **9.11** | Schema 清理:删除用户时 `DROP SCHEMA ... CASCADE` | §4.1 dropUserSchema(PgSQL 扩展方法) |
| **9.12** | `migrations/index.js` 硬编码 SQL 片段按引擎分发 | §4.5 迁移运行器兼容性(D1+D2) |
| **9.13** | 数据搬迁管道支持 SQLite → PgSQL 引擎间转换 | §6.2 搬迁管道设计 |
| **9.14** | 连接健康检查与状态暴露(`isConnected()`/`getHealth()`) | §4.1 健康检查扩展 + §4.2 C# 端 |
| **9.15** | GitHub Actions 添加 PostgreSQL 16/17 集成测试 | §7.5 CI 配置(`action-setup-postgres`,采纳 review 后修订) |
| **9.16** | ~~编写 `docker-compose.pgsql.yml` 本地开发配置~~ **降级**(PR #7 review 采纳):docker-compose 移除,本地开发用 `docker run postgres:16` 一行启动 | §7.6 本地开发 PG 容器 |

**配套横切**(不在 9.2-9.16 编号内但为前置必要工作,归入对应切片):
- C#→JS 桥注册 4 处缺口(Context Brief H)→ 归入切片 9.2
- `vitest.setup.js` 加 `globalThis.PostgreSQL` stub → 归入切片 9.3
- `adapter/index.js` 引擎选择改造 → 归入切片 9.3(使 PgSQLAdapter 可被选中)

### 1.2 Out of Scope(明确排除项)

| 排除项 | 理由 |
|--------|------|
| **跨账号 UNION ALL 聚合视图** | D5:Phase 9 仅单账号 schema 隔离,`withPrefix` 串行单 prefix 透明适配 |
| **9.10 新建聚合视图/改写 aggregatedView.js** | 按 D5,9.10 降级为验证现有实现(Phase 4.3 已删硬编码 UNION ALL 复用 feed 接口)在 PgSQL 全限定名下透明工作 |
| **密码加密 / VRCX_Database.password 安全存储** | 属 Issue #5 范围,Phase 9 仅读 password 字段拼连接串 |
| **MySQL/MariaDB 适配器** | Phase 8 范围(task 8.2-8.11 未完成),Phase 9 不涉及 |
| **v16 .map 的 PgSQL 方言重写** | D2:PgSQL 跳过 v16,无需重写 `SUBSTR(...INSTR(...))` 等 SQLite 片段 |
| **业务模块(18 个 database/*)SQL 改写** | D1:_bind 对业务模块透明,338 处调用零改动 |
| **EngineAdapter 基类签名变更** | 接口已冻结(42+3),PgSQL 扩展方法走 @optional/特有,不破冻结 |
| **多账号并发写入压测** | 属 Phase 11(11.10),Phase 9 仅提供能力 |
| **C# 测试项目建立** | 属 Phase 10.1/10.2 范围,Phase 9 的 C# 改动靠集成测试覆盖 |

### 1.3 依赖与前置

- **9.1 已完成**:`Dotnet/PostgreSQL.cs` 骨架 + Npgsql 9.0.0 包已加入两个 csproj(已核实 `PostgreSQL.cs` L1-201,含 Execute/ExecuteNonQuery/ExecuteJson 基础实现,但 Init 不符 D3)
- **Phase 3 EngineAdapter 抽象层**:已冻结 42 abstract + 3 optional(已核实 `EngineAdapter.js` L13 注释)
- **Phase 4/5 全量模块迁移**:18 个 `database/*` 模块已全部走 adapter 出口,338 处调用面已稳定
- **Phase 8 MySQL 关系**:并行参考,不依赖。Phase 8 未完成(8.2-8.11 待做),但 `adapter/index.js` 引擎选择改造(task 8.7)与本设计 task 9.3 配套的 `adapter/index.js` 改造**同一文件同一逻辑**,实际由 Phase 9 先落地,Phase 8 后续复用
- **CONFIG_REFACTOR(D3 依据)**:`VRCX_Database.{mode,name,host,port,username,password,options}` 7 字段 bootstrap 已就绪(由 VRCXStorage.cs L70-86 创建)

---

## 2. 架构总览

### 2.1 分层位置

```
┌──────────────────────────────────────────────────────────────┐
│  JS 业务层:18 个 database/* 模块(feed.js/gameLog.js/...)    │
│  写 @key 命名参数 + 调 adapter 结构化方法(338 处,不改)      │
└────────────────────────┬─────────────────────────────────────┘
                         │ import { adapter } from '@/services/database/adapter'
┌────────────────────────▼─────────────────────────────────────┐
│  adapter/index.js  ← 运行时读 VRCX_Database.mode 选择引擎    │
│  ┌──────────────────┐    ┌──────────────────┐                │
│  │ SQLiteAdapter    │    │ PgSQLAdapter(新) │                │
│  │  @key → SQLite   │    │  @key → $N(_bind)│                │
│  │  prefix_table    │    │  account_p.table │                │
│  └────────┬─────────┘    └────────┬─────────┘                │
└───────────┼───────────────────────┼──────────────────────────┘
            │ globalThis.SQLite      │ globalThis.PostgreSQL(新)
┌───────────▼───────────┐  ┌────────▼──────────────────────────┐
│ C# SQLite.cs          │  │ C# PostgreSQL.cs(改造 Init)       │
│  IDictionary 命名参数 │  │  object[] 位置参数 $1/$2          │
│  Microsoft.Data.Sqlite│  │  Npgsql 9.0 + NpgsqlDataSource    │
└───────────────────────┘  └───────────────────────────────────┘
```

### 2.2 与 SQLiteAdapter 的并行关系

- **同构面**:PgSQLAdapter 与 SQLiteAdapter 都继承 EngineAdapter,实现相同的 42+3 方法签名,业务模块调用方式完全一致
- **差异面**:
  1. 参数绑定:SQLite `_normalizeArgs` 加 `@` 前缀传命名 map;PgSQL `_bind` 扫描 SQL 把 `@key` 替换为 `$N` + 输出 positional array
  2. 表命名:SQLite `prefix_table`(平铺);PgSQL `account_prefix.table`(schema 隔离)
  3. 冲突处理:SQLite `INSERT OR IGNORE/REPLACE`;PgSQL `ON CONFLICT DO NOTHING/UPDATE`
  4. DDL 类型:SQLite `TEXT/INTEGER`;PgSQL `TEXT/BIGINT/BIGINT GENERATED ... AS IDENTITY`
  5. 元数据:SQLite `sqlite_schema/PRAGMA`;PgSQL `pg_catalog/information_schema`
  6. SQL fragments:5 个方言方法(见 §4.1)
- **桥接边界**:SQLite 走 `globalThis.SQLite`(CefSharp 注册),PgSQL 走 `globalThis.PostgreSQL`(新增注册,见 §4.4)

---

## 3. 文件级改动清单(file-by-file scope)

### 3.1 新增文件

| 文件路径 | 用途 | 任务 |
|----------|------|------|
| `src/services/database/adapter/PgSQLAdapter.js` | PgSQL 方言适配器(继承 EngineAdapter,实现 42+3 方法 + `_bind`/`dropUserSchema` PgSQL 特有扩展 + v1.2 提升入基类的 `isConnected`/`getHealth`/`getPoolStats` 健康检查抽象) | 9.3-9.9, 9.11, 9.14 |
| `.github/workflows/ci.yaml`(扩展 test_pgsql job) | CI 集成测试 PG matrix,使用 `ikalnytskyi/action-setup-postgres` action | 9.15 |
| `test/contract/adapter-contract.pgsql.js`(或扩展现有契约,见 §7.2) | PgSQL 镜像契约测试 wrapper | 9.3/10.3 |

> **9.16 docker-compose.pgsql.yml 已移除**(PR #7 review 采纳,2026-07-19):CI 改用 `action-setup-postgres` 不依赖 docker-compose;本地开发用 `docker run postgres:16` 一行启动(见 §7.6)。

### 3.2 修改文件

#### 3.2.1 `Dotnet/PostgreSQL.cs`(C# 后端)

| 锚点 | 现状 | 改动性质 | 任务 |
|------|------|----------|------|
| L44-61 `Init()` | 读 `VRCX_Database.name` 当完整连接串,`NpgsqlDataSourceBuilder(connectionString).Build()` | **重写**:改为读 `VRCX_Database.{host,port,username,password,name}` 5 字段,拼装 `Host=...;Port=...;Username=...;Password=...;Database=...`,字段级校验防注入(见 §4.2),`name` 默认 `"vrcx"`(schema 名/库名) | 9.2/D3 |
| L24-27 字段 | `_dataSource`/`_connection`/`_connectionLock`/`_initialized` | **增强**:保留 `NpgsqlDataSource` 池化(已就绪),移除单 `_connection` 改为每次 `CreateConnection()` 借池连接(更符合 Npgsql 最佳实践),加重连/健康检查字段 | 9.2/9.14 |
| L106-118 `Execute(sql, args)` | 借 `_connection` 读锁,调 `ExecuteCore` | **调整**:改为 `_dataSource.OpenConnection()` 借池连接,`using` 包裹,位置参数 `$N` 绑定逻辑不变(L176-189 `AddWithValue(null, arg)` 顺序绑已正确) | 9.2 |
| L123-139 `ExecuteNonQuery` | 同上写锁 | **调整**:同 Execute,改借池连接 | 9.2 |
| L67-73 `Exit()` | Close+Dispose | **保留**,适配新字段 | 9.2 |
| 新增方法 | — | **新增** `IsConnected()` / `GetHealth()` 返回连接状态 JSON(供 JS `adapter.getHealth()` 调用) | 9.14 |
| 新增方法 | — | **新增** `Ping()`:执行 `SELECT 1` 探活,失败触发重连 | 9.2/9.14 |
| 新增私有 | — | **新增** `ValidateConnectionStringField(field, value, allowChars)` 防连接串注入(拒绝 `;`/`'`/`"`/`\0` 等) | 9.2 |

#### 3.2.2 `src/services/database/adapter/index.js`(JS 引擎工厂)

| 锚点 | 现状 | 改动性质 | 任务 |
|------|------|----------|------|
| L3 `const ENGINE = 'sqlite';` | 硬编码 | **改为运行时读**:从 `VRCXStorage.Get('VRCX_Database.mode')` 读 mode(默认 `'sqlite'`),惰性导入 PgSQLAdapter | 9.3 |
| L6-10 `if (ENGINE === 'sqlite')` | 仅 sqlite 分支 | **扩展 else if**:mode === 'postgresql' → `new PgSQLAdapter()`,其他抛错 | 9.3 |
| L20-34 `createAdapter(config)` | 仅支持 `sqlite://` scheme | **扩展**:`postgresql://` scheme → `new PgSQLAdapter(config)`,解析 URI 为 host/port/db/user/password | 9.3 |

#### 3.2.3 `Dotnet/Cef/JavascriptBindings.cs`(CefSharp 桥注册)

| 锚点 | 现状 | 改动性质 | 任务 |
|------|------|----------|------|
| L13 `repository.Register("SQLite", SQLite.Instance);` | 仅注册 SQLite | **新增一行**:`repository.Register("PostgreSQL", PostgreSQL.Instance);` | 9.2(桥) |

#### 3.2.4 `src-electron/main.js`(Electron 引擎初始化)

| 锚点 | 现状 | 改动性质 | 任务 |
|------|------|----------|------|
| L121-124 `if (mode === 'sqlite') { SQLite.Init(); }` | 仅 sqlite 分支无 else | **新增 else if**:`else if (mode === 'postgresql') { interopApi.getDotNetObject('PostgreSQL').Init(); }` | 9.2(桥) |

#### 3.2.5 `Dotnet/Program.cs`(Cef 模式引擎初始化)

| 锚点 | 现状 | 改动性质 | 任务 |
|------|------|----------|------|
| L241-244 `if (...mode == "sqlite") { SQLite.Instance.Init(); }` | 仅 sqlite 分支无 else | **新增 else if**:`else if (...mode == "postgresql") { PostgreSQL.Instance.Init(); }` | 9.2(桥) |

#### 3.2.6 `vitest.setup.js`(测试 stub)

| 锚点 | 现状 | 改动性质 | 任务 |
|------|------|----------|------|
| L18 `globalThis.SQLite = new Proxy({}, { get: () => noopAsync });` | 仅 stub SQLite | **新增一行**:`globalThis.PostgreSQL = new Proxy({}, { get: () => noopAsync });` | 9.3(测试) |

#### 3.2.7 `src/services/database/migrations/index.js`(迁移运行器)

| 锚点 | 现状 | 改动性质 | 任务 |
|------|------|----------|------|
| L210-212 `getDatabaseEngine()` 固定返回 `'sqlite'` | 硬编码 | **改为运行时读**:`return VRCXStorage.Get('VRCX_Database.mode') ?? 'sqlite';`(或从 adapter 暴露 engine 标识) | 9.12 |
| L219-237 `checkDatabaseCompatibility(database, engine)` | 不匹配则抛错 | **调整**:对非 sqlite 引擎,遇 `database.after === 'sqlite'` 或 `database.before === 'sqlite'` 时**跳过该 .map**(返回 skip 标志而非抛错),实现 D2 | 9.12 |
| L477-500 `executeRawSql` | `adapter.executeNonQuery(sql)` 无参数 | **不改**:按 D1,若 sql 含 `@key` 由 PgSQLAdapter._bind 处理;v16 按 D2 跳过,其余 .map 的 execute_sql 需核实是否含 SQLite 特有语法(见 §6.3 风险) | 9.12 |
| L671-693 `executeUpdate` | `UPDATE ${table} SET ${buildSetClause} WHERE ${where}` + `flattenArgs`(含 `@col`) | **不改**:按 D1,`@col` 由 PgSQLAdapter._bind 在 executeNonQuery 内统一替换 | 9.12 |
| L843-858 `executeWithParams` | `adapter.execute(callback, sql, args)` | **不改**:按 D1,`@key` 由 _bind 处理 | 9.12 |
| L868-878 `buildSetClause` | 生成 `col = @col` | **不改**:按 D1 | 9.12 |
| 迁移调度入口(需核实精确行号) | 顺序执行 .map | **新增跳过逻辑**:checkDatabaseCompatibility 返回 skip 时,`console.warn` 记录跳过并 continue,不执行该 .map | 9.12 |

#### 3.2.8 `src/services/database/adapter/SQLiteAdapter.js`

**不改**。PgSQLAdapter 是独立新文件,不复用也不修改 SQLiteAdapter。`initUserSchema` 的 50 张表 DDL 作为 PgSQL DDL 生成的参照蓝本(见 §5.2)。

#### 3.2.9 业务模块(18 个 `database/*.js` + `coordinators/feed.js` 等)

**不改**。按 D1,_bind 对业务模块透明;按 D5,`withPrefix` 串行单 prefix 透明适配。已核实 `feed.js` L600 `adapter.withPrefix(prefixOverride, () => this.lookupFeedDatabase(...))` 无需改写。

#### 3.2.10 `src/services/database/index.js`

| 锚点 | 现状 | 改动性质 | 任务 |
|------|------|----------|------|
| L54-61 `initUserTables(userId)` | prefix 生成 `userId.replaceAll('-','').replaceAll('_','')`,数字开头补 `_` | **不改**:prefix 生成规则恰好符合 PG schema 命名规则(字母/下划线开头,含字母数字下划线) | — |
| L75-81 `vacuum()`/`optimize()` | 转发 adapter | **不改** | — |

#### 3.2.11 `aggregatedView.js`(9.10 验证目标)

**不改(按 D5)**。**已核实(2026-07-18)**:`aggregatedView.js` 实际位于 `src/services/aggregatedView.js`(156 行,非 `src/services/database/`),不导入 adapter,不含任何硬编码表名拼接。跨账号聚合通过循环 `prefix` 调 `database.lookupFeedDatabase` + JS 层 `parseDbRow` + `sort`/`slice` 合并完成(非 SQL 层 UNION ALL)。feed.js 的 `lookupFeedDatabase` 经 `adapter.userTable()` 动态解析表名 + `adapter.withPrefix()` 切换 schema 上下文。PgSQL 下 `userTable` 返回 `account_{prefix}.table` 自动适配,9.10 仅需验证 feed.js 的 selectUnion 在 PgSQL schema 隔离下透明工作,不改 aggregatedView.js。

---

## 4. 接口设计

### 4.1 PgSQLAdapter 类(继承 EngineAdapter)

**文件**:`src/services/database/adapter/PgSQLAdapter.js`
**签名**:`class PgSQLAdapter extends EngineAdapter`
**实现**:42 abstract + 3 optional 全部实现,另加 2 个 PgSQL 特有扩展方法(`_bind`/`dropUserSchema`)。`isConnected()` / `getHealth()` / `getPoolStats()` 在 v1.2 已提升为 EngineAdapter 基类抽象方法,三引擎对称实现(详见 §4.1.15)。

#### 4.1.1 核心参数绑定:`_bind(sql, args)`(D1 核心,R1 风险点)

**职责**:把业务模块写的 `@key` 命名占位符 SQL + `{key: val}` 参数对象,转换为 PgSQL 的 `$N` 位置占位符 SQL + `Array<val>` 位置参数数组。

**调用时机**:仅由 PgSQLAdapter 内部的 `execute`/`executeNonQuery` 调用。所有 CRUD 方法(insert/update/select 等)生成 `@key` 格式 SQL 后调 executeNonQuery/execute,由 _bind 统一转换。**业务模块和 CRUD 方法都不感知 _bind**。

**签名**:
```
@private
_bind(sql: string, args: object|Array|null) → { sql: string, args: Array|null }
```

**算法伪代码**:
```
_bind(sql, args):
  # 情况 1:null/undefined 参数 → SQL 原样返回,参数 null
  if args == null or args == undefined:
    return { sql, args: null }

  # 情况 2:已是位置数组 → 假设 SQL 已是 $N 格式(由调用方保证),原样返回
  if Array.isArray(args):
    return { sql, args }

  # 情况 3:命名参数对象 → 扫描替换
  if typeof args === 'object':
    # 步骤 A:规范化 key(统一去 @ 前缀,兼容带/不带 @ 的 key)
    normArgs = {}
    for (k, v) of Object.entries(args):
      key = k.replace(/^@/, '')        # '@col' → 'col', 'col' → 'col'
      normArgs[key] = v

    # 步骤 B:扫描 SQL,把 @identifier 替换为 $N
    keyToIndex = new Map()             # key → $N 序号(1-based)
    values = []                        # 位置参数值,按 $N 顺序排列

    newSql = sql.replace(
      /@([A-Za-z_][A-Za-z0-9_]*)/g,    # ★ 边界匹配正则(见下文说明)
      (match, ident) => {
        # 只有 ident 在 normArgs 中才替换;否则保留原 @ident(非参数,如字面量)
        if !normArgs.hasOwnProperty(ident):
          return match                 # 保留原样,不替换
        if !keyToIndex.has(ident):
          keyToIndex.set(ident, keyToIndex.size + 1)   # 分配新 $N
          values.push(normArgs[ident])                 # 按序放值
        return '$' + keyToIndex.get(ident)             # 复用已分配的 $N
      }
    )

    return { sql: newSql, args: values }
```

**★ 边界匹配正则 `/@([A-Za-z_][A-Za-z0-9_]*)/g` 说明(R1 正面回答)**:

1. **贪婪完整标识符匹配**:正则 `[A-Za-z_][A-Za-z0-9_]*` 匹配一个完整的 SQL 标识符。对 `@user_id`,它匹配到 `user_id`(整串),**不会**在 `user` 处停止。因此 `@user_id` 和 `@user` 是两个互不干扰的 token。
2. **撞列名场景验证**:
   - 若 args = `{user_id: 1}`,SQL = `WHERE @user_id = @user_id`:两次匹配都得 `user_id`,keyToIndex 复用 `$1`,输出 `WHERE $1 = $1`,values = `[1]`。✓ 正确
   - 若 args = `{user: 'x', user_id: 1}`,SQL = `@user @user_id`:匹配 `@user` → `$1`(values=['x']),`@user_id` → `$2`(values=['x',1])。**不会**把 `@user_id` 误匹配为 `@user` + `_id`。✓ 正确
   - 若 args = `{user: 'x'}`(无 user_id),SQL = `@user_id`:匹配得 `user_id`,但 `user_id` 不在 normArgs,保留 `@user_id` 原样(此时会触发 PG 语法错误,暴露调用方漏传参数的 bug,比静默错绑更安全)。✓ 正确
3. **重复 key 复用**:同一 `@key` 在 SQL 中出现 N 次,只分配一个 `$N`,values 中只放一次值。PG 位置参数 `$N` 可在 SQL 中多次引用,语义正确。
4. **非标识符 `@` 不匹配**:正则要求 `@` 后首字符为 `[A-Za-z_]`,因此 `@` 后跟数字/空格/标点(如 email `'foo@bar.com'` 中的 `@bar`)——`@bar` 会被匹配为 `bar`。**这是已知边界**(见 §9 R3),与 SQLite 的 `@key` 占位符行为同构(SQLite 下 `@bar` 也会被当命名参数),现有 338 处调用已隐含假设 raw SQL 中无此类冲突字面量。
5. **字符串字面量内的 `@`**:正则会匹配字符串字面量内的 `@identifier`(如 `'@host'`)。**这是已知边界**(见 §9 R3),与 SQLite 同构。Phase 9 最小实现不做字符串字面量跳过(增加解析器复杂度),沿用现有隐含假设。

**输出契约**:
- `args` 始终是 `Array` 或 `null`,匹配 C# `PostgreSQL.Execute(string sql, object[] args)` 签名(L106)
- `sql` 中所有 `@key`(key ∈ args)被替换为 `$N`;不在 args 中的 `@ident` 保留原样(会触发 PG 报错,暴露 bug)

#### 4.1.2 `_normalizeArgs(args)`(@optional override)

**不重写**(继承 EngineAdapter 默认 identity)。PgSQLAdapter 的参数转换在 `_bind` 中完成(需要 sql 上下文),`_normalizeArgs` 无 sql 上下文无法独立完成。为防止误用,可在 PgSQLAdapter 中重写为抛错:`_normalizeArgs() { throw new Error('PgSQLAdapter uses _bind, not _normalizeArgs'); }`。**最终选择:保留默认 identity,在 execute/executeNonQuery 中不调用它,直接调 _bind**。

#### 4.1.3 `execute(callback, sql, args)`(abstract #1)

```
async execute(callback, sql, args):
  const { sql: pgSql, args: pgArgs } = this._bind(sql, args)
  const json = await PostgreSQL.ExecuteJson(pgSql, pgArgs)   # C# 池化执行,返回 JSON 行数组
  const items = JSON.parse(json)
  items.forEach(item => callback(item))
```

**与 SQLiteAdapter.execute(L145-175)差异**:
- 不调 `_normalizeArgs`,改调 `_bind`
- 不区分 connectionString / LINUX Map 转换(PG 统一 object[] 位置参数)
- 不调 `handleSQLiteError`(PG 错误处理见 §4.2 / §9)

#### 4.1.4 `executeNonQuery(sql, args)`(abstract #2)

```
async executeNonQuery(sql, args):
  const { sql: pgSql, args: pgArgs } = this._bind(sql, args)
  return await PostgreSQL.ExecuteNonQuery(pgSql, pgArgs)
```

#### 4.1.5 CRUD 方法(insert/bulkInsert/update/upsertPartial 等)

**设计原则**:CRUD 方法的 SQL 生成逻辑与 SQLiteAdapter 同构(生成 `@key` 格式 SQL + `{key: val}` 参数),仅方言关键字不同。所有 `@key` 最终经 executeNonQuery → _bind 转 `$N`。

**逐方法方言差异**:

| 方法 | SQLiteAdapter 实现 | PgSQLAdapter 差异 |
|------|-------------------|-------------------|
| `insert(table, data, conflict)` (L216-228) | `INSERT ${OR IGNORE\|OR REPLACE\|空} INTO ... VALUES (@col)` | `_insertClause(conflict)`:'ignore' → `ON CONFLICT DO NOTHING`,'replace' → `ON CONFLICT (pk) DO UPDATE SET ...`(需 pk 列,**简化方案见下**) |
| `bulkInsert(table, rows, conflict)` (L236-257) | 多行 VALUES,`@col_${i}` 行号后缀 | 同构,`@col_${i}` 由 _bind 转 `$N`;conflict 同上 |
| `update(table, data, where)` (L265-279) | `SET set_col=@set_col WHERE where_col=@where_col` | **完全同构**,`@set_col`/`@where_col` 由 _bind 转 `$N` |
| `updateWhere(table, data, whereClause, params)` (L288-297) | `SET set_col=@set_col WHERE ${whereClause}` | **完全同构** |
| `delete(table, where)` (L304-314) | `WHERE col=@col` | **完全同构** |
| `deleteAll`/`deleteWhere`/`dropTable` | 直发 | **完全同构** |
| `increment(table, col, amt, where)` | `SET col = col + @amt WHERE ...` | **完全同构** |
| `upsertPartial(table, ins, upd, conflictCol)` | `INSERT ... ON CONFLICT(col) DO UPDATE SET ...` | **SQLite/PgSQL 语法兼容**(SQLite 3.24+ 支持 ON CONFLICT),PgSQLAdapter 实现**与 SQLiteAdapter 几乎一致**,仅冲突列引用方式相同 |
| `selectOne`/`select`/`selectWhere`/`selectJoin`/`selectWhereIn`/`selectUnion`/`selectGroupBy` | 生成 `@key` SQL + params | **完全同构**,`@key` 由 _bind 转 `$N` |
| `count`/`countWhere` | 生成 `@key` SQL | **完全同构** |

**`insert` 的 `conflict='replace'` 分层方案(已核实 2026-07-18)**:
- SQLite `INSERT OR REPLACE` = 删除冲突行后插入新行
- PgSQL 无直接等价;`ON CONFLICT DO UPDATE` 需指定更新列与冲突列
- **核实结果**:生产代码共 27 处 `insert/bulkInsert(..., 'replace')` 调用。23 处的 PK 可从 data keys 推断(20 单列 PK + 3 复合 PK,如 memos.js:29 的 `user_id`、mutualGraph.js:97 的 `friend_id` 等),是真正的 replace 语义(冲突时更新)。4 处的 PK 是 `INTEGER PRIMARY KEY` 自增且不在 data 中(avatarFavorites.js:140、worldFavorites.js:33、friendFavorites.js:12、activityV2.js:335),SQLite 现行行为本就无冲突可触发(等价普通 INSERT)。
- **分层实现(修订原"简化方案")**:
  - **默认路径**:PgSQLAdapter 维护 `table → PK columns` 元数据映射(在 `initUserSchema`/`initGlobalSchema` 建表时填充,复用 §5.2/5.3 的表定义)。`conflict='replace'` 且 PK 可解析且 PK 列 ∈ data keys 时,生成 `INSERT INTO ... VALUES (@col) ON CONFLICT (pk_cols) DO UPDATE SET ${非 pk 列 = EXCLUDED.非 pk 列}`。覆盖 23 处真 replace。
  - **降级路径(fallback)**:PK 不可解析或 PK 列 ∉ data keys(4 处自增 PK 调用)时,降级 `ON CONFLICT DO NOTHING` + `console.warn`。SQLite 现行行为本就无冲突,降级等价。
- **不采用**"调用方改用 upsertPartial"方案(需改 23 处调用点,侵入性大)。
- **R12 风险等级下调为"低"**(有明确技术路径,无需改调用方)。

**`selectUnion` 简化机会**:
- SQLiteAdapter L503-549 用派生表包装(`SELECT * FROM (branch)`)绕 SQLite compound-select 限制
- PgSQL 原生支持 `(SELECT ...) UNION ALL (SELECT ...)` 分支括号 + 分支内 ORDER BY/LIMIT
- **Phase 9 最小实现:沿用派生表包装**(对 PgSQL 也合法,无需简化,减少差异面)。在注释标注"PgSQL 原生支持分支括号,此处沿用派生表包装以保持与 SQLiteAdapter 同构"

#### 4.1.6 `userTable(prefix, name)`(abstract #39,9.6)

```
userTable(prefix, name):
  const p = this._prefixOverride ?? prefix
  return `${this._schemaPrefix(p)}.${name}`     # account_{p}.{name}

_schemaPrefix(prefix):
  return `account_${prefix}`
```

**与 SQLiteAdapter(L887-890)差异**:返回 `account_{prefix}.{name}` 二段式限定名,而非 `{prefix}_{name}` 平铺名。`_prefixOverride`(withPrefix)行为一致。

**不变量 INV-01**:返回值必须是合法 PG `schema.table` 二段式标识符,schema 名 `account_{prefix}` 符合 PG 标识符规则(字母/下划线开头)。prefix 生成逻辑(database/index.js L56-58:去 `-`/`_`,数字开头补 `_`)恰好保证合规。

#### 4.1.7 `initUserSchema(prefix)`(abstract #40,9.7)

```
async initUserSchema(prefix):
  # 步骤 1:创建账号 schema
  await this.executeNonQuery(
    `CREATE SCHEMA IF NOT EXISTS ${this._schemaPrefix(prefix)}`
  )
  # 步骤 2:在 schema 下建 50 张用户表(PG DDL,见 §5.2)
  await this.executeNonQuery(
    `CREATE TABLE IF NOT EXISTS ${this.userTable(prefix, 'feed_gps')} (id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, created_at TEXT, user_id TEXT, ...)`
  )
  # ... 其余 49 张表 + 索引
```

**与 SQLiteAdapter(L900-979)差异**:
1. 先 `CREATE SCHEMA IF NOT EXISTS account_{prefix}`
2. 表名用 `userTable(prefix, name)` 得 `account_{prefix}.table`
3. 类型映射(见 §5.1):`INTEGER PRIMARY KEY` → `BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY`,`TEXT` → `TEXT`,`INTEGER` → `BIGINT`
4. `INTEGER PRIMARY KEY AUTOINCREMENT`(如 activity_sessions_v2 L923)→ `BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY`(**已核实 2026-07-18 修订**:运行时 session_id 从不手动赋值,但搬迁管道 `vrcx.js:492-513 copyTableData` 会显式复制原 session_id 值,`GENERATED ALWAYS` 会拒绝搬迁。改为 `BY DEFAULT` 与普通 INTEGER PK 映射统一,兼容搬迁。R6 缓解措施(a)确认)
5. 索引名:schema 内唯一即可,去掉 prefix,用 `table_col_idx`(见 §5.4)

#### 4.1.8 `initGlobalSchema()`(abstract #41,9.8)

```
async initGlobalSchema():
  # 全局表放 public schema(默认 search_path 含 public)
  await this.executeNonQuery(
    `CREATE TABLE IF NOT EXISTS public.gamelog_location (id BIGINT ..., UNIQUE(created_at, location))`
  )
  # ... 其余 19 张全局表 + 索引(见 §5.3)
```

**与 SQLiteAdapter(L985-1049)差异**:
1. 表名显式加 `public.` 前缀(确保不受 search_path 影响)
2. 类型映射同 §5.1
3. 索引名保持原名(如 `idx_gamelog_location_world_created`),public schema 内唯一

#### 4.1.9 `listTables(likePattern)`(abstract #42,9.9,D4)

```
async listTables(likePattern):
  # likePattern 形如 '%_feed_gps'(SQLite 风格通配符)
  # PgSQL 查 pg_catalog.pg_tables,schemaname LIKE 'account_%' 过滤账号 schema
  # tablename LIKE likePattern 的后缀部分(去 '%_' 前缀)
  #
  # 但 SQLiteAdapter 的 likePattern 是完整表名 '%_feed_gps',
  # PgSQL 表名不含 prefix(在 schema 内),需调整匹配:
  #   方案:把 '%_suffix' 拆成 schema LIKE 'account_%' + tablename LIKE 'suffix'
  #
  # 然而 D4 要求返回 'account_abc.feed_gps' 完整限定名,
  # 且 expandWildcard(migrations L725-736)把返回值直接当表名用于后续 ALTER,
  # 故 listTables 必须返回 schema.table 二段式

  const tables = []
  await this.execute(
    (row) => tables.push(`${row[0]}.${row[1]}`),
    `SELECT schemaname, tablename FROM pg_catalog.pg_tables
     WHERE schemaname LIKE @schemaPattern AND tablename LIKE @tablePattern`,
    { schemaPattern: 'account\\_%', tablePattern: this._stripWildcardPrefix(likePattern) }
  )
  return tables
```

**`_stripWildcardPrefix('%_feed_gps')` → `'feed_gps'`**:去 `'%_'` 前缀得纯表名模式。若 likePattern 不以 `%_` 开头(如 `'gamelog_location'`),则查 public schema。

**D4 对齐**:返回 `['account_abc.feed_gps', 'account_xyz.feed_gps']`,可直接用于 SQL 标识符,与 SQLite 返回完整表名行为对齐,后续 `ALTER TABLE ${table}` 无需补前缀。

**LIKE 转义**:PG LIKE 中 `_` 是单字符通配符。`account_%` 会匹配 `accountX`(无下划线)。需用 `account\_%`(转义 `_`)并加 `ESCAPE '\'` 子句,或用 `schemaname LIKE 'account\_%' ESCAPE '\'`。**实现时必须加 ESCAPE 子句**。

#### 4.1.10 `getTableColumns(table)`(abstract #43,9.9)

```
async getTableColumns(table):
  # table 可能是 'account_xxx.feed_gps' 或 'public.gamelog_location'
  # 拆分 schema.table
  const [schema, name] = this._splitQualified(table)
  const rows = []
  await this.execute(
    (row) => rows.push(row),
    `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = @schema AND table_name = @name
     ORDER BY ordinal_position`,
    { schema, name }
  )
  return rows
```

**与 SQLiteAdapter(L627-634 `PRAGMA table_xinfo`)差异**:返回列结构不同(PG 返回 `column_name/data_type/is_nullable/column_default`,SQLite 返回 `cid/name/type/notnull/dflt_value/pk/hidden`)。**已核实(2026-07-18)**:`getTableColumns` 在生产代码中**零调用**(仅 adapter 测试与基类/实现引用)。R4 风险**不成立**,PgSQLAdapter **无需做结构对齐**,可直接返回 information_schema 行。关联的 `listTablesTypes`(唯一生产调用 `vrcx.js:455`)消费结构化对象 `{tableName, columns: [{name, isHidden, ...}]}`(非位置数组),§4.1.11 已规定返回同构结构化形状,已覆盖。

#### 4.1.11 `listTablesTypes()`(abstract #44,9.9)

```
async listTablesTypes():
  # 枚举所有 account_* schema 的表 + 每表列元数据
  # 返回结构化对象(与 SQLiteAdapter L644-671 同构):
  #   [{ tableName: 'account_xxx.feed_gps',
  #      columns: [{ name, type, notNull, defaultValue, isPK, isHidden }] }]
  const tables = await this.listTables('%')   # 所有账号表
  const result = []
  for (const table of tables):
    const cols = await this._describeColumns(table)   # 信息_schema + pk 查询
    result.push({ tableName: table, columns: cols })
  return result
```

**`_describeColumns(table)`**:查 `information_schema.columns` + `pg_catalog.pg_index` 判断 pk,映射为 SQLiteAdapter listTablesTypes 的结构化对象(`{name, type, notNull, defaultValue, isPK, isHidden}`)。`isHidden` 在 PG 无等价概念,恒为 `false`。

#### 4.1.12 SQL fragments(5 个 @abstract @engine-specific,9.5)

| 方法 | SQLiteAdapter 实现 | PgSQLAdapter 实现 |
|------|-------------------|-------------------|
| `sqlToUnixMs(col)` (L765) | `strftime('%s', col) * 1000` | `EXTRACT(EPOCH FROM ${col}::timestamptz) * 1000` |
| `sqlExtractWorldId(col)` (L775) | `SUBSTR(col, 1, INSTR(col, ':') - 1)` | `SUBSTRING(${col} FROM 1 FOR POSITION(':' IN ${col}) - 1)` |
| `sqlHasInstanceId(col)` (L786) | `INSTR(col, ':') > 0` | `POSITION(':' IN ${col}) > 0` |
| `sqlDate(col)` (L796) | `date(col)` | `${col}::date` |
| `sqlEnterTime(tsCol, msCol)` (L826) | `strftime('%Y-%m-%dT%H:%M:%SZ', ts, '-' \|\| (ms/1000.0) \|\| ' seconds')` | `to_char(${tsCol}::timestamptz - (${msCol} / 1000.0) * INTERVAL '1 second', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`(**已核实 2026-07-18 修订**:原 `::text` 方案不安全) |

**说明**:
- `sqlEnterTime` 需返回 ISO 8601 字符串(与 SQLite strftime 格式对齐)。**已核实(2026-07-18)**:gameLog.js:1594 唯一生产调用,sqlEnterTime 返回值用于 `BETWEEN @utc_start_date AND @utc_end_date` 字符串字典序比较,边界值是 `dayjs.tz().toISOString()` 产出的严格 ISO `YYYY-MM-DDTHH:MM:SS.sssZ`,created_at 列是 TEXT 存 ISO 字符串。PG `::text` 默认格式 `YYYY-MM-DD HH:MM:SS+00`(空格分隔、+00 时区)与 SQLite strftime `YYYY-MM-DDTHH:MM:SSZ`(T 分隔、Z 后缀)字节不一致,会破坏 BETWEEN 字典序比较。**必须改用 `to_char(..., 'YYYY-MM-DD"T"HH24:MI:SS"Z"')` 严格对齐**。R5 确认为真实风险,已在上表修订实现。
- `sqlToUnixMs`:`EXTRACT(EPOCH FROM ...)` 返回 `numeric`,`* 1000` 后仍为 numeric,调用方若需整数需 `::bigint`。**需核实调用方是否依赖整数类型**(留待实现时核实,影响低:numeric 在 JS 层 JSON.parse 后即为 number)。

#### 4.1.13 DDL 方法(createTable/createIndex/alterTableAddColumn 等)

| 方法 | SQLiteAdapter | PgSQLAdapter 差异 |
|------|---------------|-------------------|
| `createTable(name, columns)` | `CREATE TABLE IF NOT EXISTS` | **同构**,列定义 type 需类型映射(由调用方传 PG 类型或 adapter 内映射?**最小方案:调用方传 SQLite 风格 type,adapter 内做类型映射**) |
| `createIndex(name, table, cols, unique)` | `CREATE INDEX IF NOT EXISTS` | **同构**,索引名 schema 内唯一 |
| `alterTableAddColumn(table, colDef)` | `ALTER TABLE ADD COLUMN ${colDef}` | **同构**,colDef 含类型需映射 |
| `alterTableDropColumn`/`alterTableRename`/`dropTable` | 直发 | **同构** |

**`createTable` 类型映射策略**:契约测试(adapter-contract.js L49-53)传 `{ type: 'INTEGER PRIMARY KEY' }`。PgSQLAdapter.createTable 内部需把 `'INTEGER PRIMARY KEY'` 映射为 `'BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY'`。**设计:在 PgSQLAdapter 内加私有 `_mapColumnType(sqliteType)` 方法,做 §5.1 映射表的字符串替换**。这样契约测试用 SQLite 风格 type 也能跑 PgSQL。

#### 4.1.14 事务与维护(begin/commit/rollback/vacuum/optimize)

| 方法 | SQLiteAdapter (L1052-1074) | PgSQLAdapter |
|------|---------------------------|---------------|
| `begin` | `executeNonQuery('BEGIN')` | **同构**(`BEGIN` 在 PgSQL 合法) |
| `commit` | `COMMIT` | **同构** |
| `rollback` | `ROLLBACK` | **同构** |
| `vacuum` | `VACUUM` | `VACUUM ANALYZE`(PgSQL 需在事务外执行,与 SQLite 同) |
| `optimize` | `PRAGMA optimize` | `ANALYZE`(全 schema 统计信息更新) |

#### 4.1.15 PgSQL 扩展方法 + 已提升入基类的健康检查抽象

> **v1.1 原稿**:把 `isConnected()` / `getHealth()` 作为 PgSQLAdapter 特有扩展方法,"不入基类"。
> **v1.2 修订(commit `c08c62e1`)**:为三引擎对称(PgSQL/MySQL/SQLite),`isConnected()` / `getHealth()` / `getPoolStats()` 已从 PgSQL 特有扩展**提升为 EngineAdapter 基类抽象方法**。原"不入基类"决定撤销。下表保留 v1.1 原文以便追溯,以 v1.2 实际代码为准。

| 方法 | 签名(v1.2) | 用途 | 任务 | v1.1 原签名 | 备注 |
|------|--------------|------|------|-------------|------|
| `dropUserSchema(prefix)` | `(prefix: string) => Promise<number>` | `DROP SCHEMA IF EXISTS account_${prefix} CASCADE`,删用户时清理 | 9.11 | 同 | 仍为 PgSQL 特有扩展,不入基类 |
| `isConnected()` | `() => Promise<boolean>` | `await C# PostgreSQL.Ping()`(SELECT 1)探活,不是只看初始化的 `IsConnected()`。async 是为兼容 Electron 的 `Promise<boolean>` 返回(CefSharp 下是同步 bool,await 是 no-op) | 9.14 | `() => boolean`(号称调 `PostgreSQL.IsConnected()`) | **v1.2 改 async + 调 Ping**。原签名描述错误(v1.1 曾写"调 IsConnected",但实际一直调 Ping;且把 boolean 同步返回错揭为不 await 化的同步类型,Electron 下 `Boolean(Promise)` 恒 true) |
| `getHealth()` | `() => Promise<{ connected: boolean, latencyMs?: number, lastHealthCheck?: string \| null }>` | 调 C# `PostgreSQL.GetHealth()`(SELECT 1 + Stopwatch) | 9.14 | `() => Promise<object>` 返回 `{ connected, poolSize, latencyMs }` | **v1.2 字段订正**:C# 实际返回 `{ connected, latencyMs, lastHealthCheck }`,**无 `poolSize` 字段**(原 JSDoc 笔误,代码从未生成过该字段)。见 PgSQLAdapter.js:1142-1148 F-13.1 注释 |
| `getPoolStats()` | `() => Promise<{ active: number, pinnedIdle: number, availableCapacity: number, max: number }>` | C# `PostgreSQL.GetPoolStats()` 三态快照,纯内存计数器,不探网络 | 9.14(v1.2 新增) | — | **v1.2 新增**。三态语义:`active` = 正在执行 SQL、`pinnedIdle` = 事务持有但未执行 SQL、`availableCapacity` = `_maxPoolSize - _totalBorrowed`(可用容量 = 池空闲 + 未用配额)。原连接池监控 PR 起初用 `poolIdle`(公式 `_totalBorrowed - _pinned.Count`,实为"非 pinned 借出",误导),经 PR #13 review #3 改名为 `availableCapacity` + 公式改 `_maxPoolSize - _totalBorrowed`(commit `9429cca8`) |

**接口冻结说明(v1.2 修订)**:`dropUserSchema` 仍为 PgSQLAdapter 特有方法,不加入基类(只 PG 有 schema)。`isConnected()` / `getHealth()` / `getPoolStats()` **已提升入 EngineAdapter 基类抽象方法**(v1.1 原稿的"不入基类"决定撤销,见顶部 v1.2 更新条目 1)。三引擎必须实现这三个抽象方法,实现内部允许 `noopAsync` 走空值 fallback。调用方按引擎能力检测:
```
if (typeof adapter.dropUserSchema === 'function') {
  await adapter.dropUserSchema(prefix);
} else {
  // SQLite 侧逐表 dropTable(需核实删除用户的调用点)
}
```
**需进一步核实**:删除用户的调用点(accountSession.js 或用户管理 UI),以确定 dropUserSchema 的接入位置。SQLite 侧等价行为需同步设计(逐表 dropTable vs PgSQL drop schema)。

### 4.2 PostgreSQL.cs 改造(9.2/9.14)

#### 4.2.1 Init() 改造(D3)

**现状**(L44-61):读 `VRCX_Database.name` 当完整连接串,`NpgsqlDataSourceBuilder(connectionString).Build()`。**不符 D3**。

**改造后**:
```
public void Init():
  #if LINUX
    Instance = this;
  #endif

  var host = VRCXStorage.Instance.Get("VRCX_Database.host")?.Trim();
  var portStr = VRCXStorage.Instance.Get("VRCX_Database.port")?.Trim();
  var username = VRCXStorage.Instance.Get("VRCX_Database.username")?.Trim();
  var password = VRCXStorage.Instance.Get("VRCX_Database.password");
  var name = VRCXStorage.Instance.Get("VRCX_Database.name")?.Trim();

  # 字段级校验(防连接串注入)
  host = ValidateField("host", host, allowChars: "[A-Za-z0-9._-]");
  port = ValidatePort(portStr, default: 5432);
  username = ValidateField("username", username, allowChars: "[A-Za-z0-9._-]");
  # password 不 Trim,允许特殊字符,但拒绝 ; ' " \0
  password = ValidatePassword(password);
  name = ValidateField("name", name ?? "vrcx", allowChars: "[A-Za-z0-9_]");

  var connStr = $"Host={host};Port={port};Username={username};Password={password};Database={name}";

  var builder = new NpgsqlDataSourceBuilder(connStr);
  _dataSource = builder.Build();
  _initialized = true;
```

**`ValidateField` 防注入规则**(参照 CONFIG_REFACTOR 安全加固):
- 拒绝 `;` `'` `"` `\0` `\n` `\r`(防注入额外键值对/引号截断)
- 字段级白名单正则(如 host 仅 `[A-Za-z0-9._-]`)
- 空 host 抛 `InvalidOperationException("VRCX_Database.host is not set")`
- name 默认 `"vrcx"`(D3:name = schema 名/库名)

**连接池**:NpgsqlDataSource 自带连接池(默认 max=100)。`_dataSource.OpenConnection()` 借池连接,`using` 自动归还。移除单 `_connection` 字段(改为每次借池)。

#### 4.2.2 重连与健康检查(9.2/9.14)

```
private DateTime _lastHealthCheck;
private readonly TimeSpan _healthCheckInterval = TimeSpan.FromSeconds(30);

public bool IsConnected():
  return _initialized && _dataSource != null;

public string GetHealth():
  var health = new { connected = IsConnected(), poolStats = ... };
  return JsonSerializer.Serialize(health);

public bool Ping():
  try:
    using var conn = _dataSource.OpenConnection();
    using var cmd = conn.CreateCommand();
    cmd.CommandText = "SELECT 1";
    cmd.ExecuteScalar();
    _lastHealthCheck = DateTime.Now;
    return true;
  catch:
    return false;
```

**自动重连**:NpgsqlDataSource 自带连接失效检测与重建。`Execute`/`ExecuteNonQuery` 借池连接时,若连接失效 Npgsql 自动重新建。无需额外重连逻辑(Phase 9 最小方案)。若需更激进重连,可在 `ExecuteCore` 外包 try/catch + 一次重试。

#### 4.2.3 错误处理

- `ExecuteCore` 抛 NpgsqlException,JS 侧 PgSQLAdapter.execute 不做 SQLite 式 `handleSQLiteError`(PG 无 disk malformed 等错误分类)
- 可选:加 `handlePgError(e)`,识别 `23505`(unique_violation)、`42P01`(undefined_table)、`42701`(duplicate_column)等 PG 错误码,映射为友好提示。**Phase 9 最小方案:直接抛错,错误码细化留后续**

### 4.3 adapter/index.js 引擎选择改造(9.3)

**现状**(L1-36):`const ENGINE = 'sqlite'` 硬编码,仅 sqlite 分支。

**改造后**:
```
import { SQLiteAdapter } from './SQLiteAdapter.js';

const ENGINE = VRCXStorage.Get('VRCX_Database.mode') || 'sqlite';

let adapter;
if (ENGINE === 'sqlite') {
  adapter = new SQLiteAdapter();
} else if (ENGINE === 'postgresql') {
  const { PgSQLAdapter } = await import('./PgSQLAdapter.js');   # 惰性导入,避免 sqlite 模式加载 Npgsql 相关
  adapter = new PgSQLAdapter();
} else {
  throw new Error(`Unsupported database engine: ${ENGINE}`);
}

# createAdapter 同理扩展 postgresql:// scheme
```

**注意**:`VRCXStorage` 在 ES 模块顶层可用(CefSharp 全局绑定)。惰性 import 确保 sqlite 模式不加载 PgSQLAdapter(Vitest sqlite 测试不受影响)。

### 4.4 C#→JS 桥注册(4 处缺口)

| 文件 | 锚点 | 改动 |
|------|------|------|
| `Dotnet/Cef/JavascriptBindings.cs` | L13 后 | 新增 `repository.Register("PostgreSQL", PostgreSQL.Instance);` |
| `src-electron/main.js` | L121-124 | `if (mode === 'sqlite') {...} else if (mode === 'postgresql') { interopApi.getDotNetObject('PostgreSQL').Init(); }` |
| `Dotnet/Program.cs` | L241-244 | 同上,加 `else if (mode == "postgresql") { PostgreSQL.Instance.Init(); }` |
| `vitest.setup.js` | L18 后 | 新增 `globalThis.PostgreSQL = new Proxy({}, { get: () => noopAsync });` |

### 4.5 迁移运行器兼容性(9.12,D1+D2)

#### 4.5.1 getDatabaseEngine() 改为运行时读

**现状**(migrations/index.js L210-212):`return 'sqlite'` 硬编码。
**改造**:`return VRCXStorage.Get('VRCX_Database.mode') ?? 'sqlite';`

#### 4.5.2 checkDatabaseCompatibility 对非 sqlite 引擎跳过(D2)

**现状**(L219-237):不匹配抛错。
**改造**:返回 `{ compatible: boolean, skip: boolean }` 或改为:对非 sqlite 引擎,遇 `database.before/after === 'sqlite'` 时**不抛错而是返回 skip 标志**,调用方跳过该 .map。

```
function checkDatabaseCompatibility(database, engine):
  if !database or typeof database != 'object': return { compatible: true, skip: false }
  const check = (key) => {
    const val = database[key];
    if val && typeof val === 'string' && val.toLowerCase() != engine.toLowerCase():
      # 引擎不匹配:若是 sqlite 锁死且当前非 sqlite → 跳过(D2)
      if val.toLowerCase() === 'sqlite' && engine.toLowerCase() != 'sqlite':
        return 'skip';
      # 反向或其他情况 → 抛错
      throw new Error(`数据库引擎不匹配: ${key}="${val}", 当前="${engine}"`);
    return 'ok';
  }
  const before = check('before');
  const after = check('after');
  if before === 'skip' or after === 'skip': return { compatible: false, skip: true }
  return { compatible: true, skip: false }
```

**调用方**:迁移调度入口(需核实精确行号)在 checkDatabaseCompatibility 返回 `skip: true` 时,`console.warn('[迁移] 跳过 ${engine} 锁定的 .map: v${version}-${type}')` 并 continue,不执行。

#### 4.5.3 三个硬编码 SQL 逃生口(按 D1 不改运行器)

| 逃生口 | 锚点 | 现状 | D1 处理 |
|--------|------|------|---------|
| `executeRawSql` | L477-500 | `adapter.executeNonQuery(sql)` 无参数 | 若 sql 含 `@key` 由 _bind 处理;v16 按 D2 跳过;其余 .map 的 execute_sql 需核实是否含 SQLite 特有语法 |
| `executeUpdate` | L671-693 | `UPDATE ${table} SET ${buildSetClause} WHERE ${where}` + `flattenArgs`(`@col`) | `@col` 由 _bind 在 executeNonQuery 内替换,**运行器不改** |
| `executeWithParams` | L843-858 | `adapter.execute(callback, sql, args)` | `@key` 由 _bind 处理,**运行器不改** |

**`buildSetClause`(L868-878)不改**:生成 `col = @col`,`@col` 由 _bind 转 `$N`。

**v16 data.map L17 `SUBSTR(...INSTR(...))` SQLite 特有**:按 D2,PgSQL 跳过 v16,此片段无需处理。

**已核实(2026-07-18)**:全仓仅 3 个 .map 文件(`16/schema.map`、`16/data.map`、`_template.map`)。**唯一实际 `execute_sql`** 在 `16/schema.map` L37,SQL 为可移植标准 UPDATE(`UPDATE gamelog_location SET group_name = groupName WHERE ...`),无 SQLite 特有语法,且该 .map 已有 `database.after:"sqlite"` 锁。SQLite 特有 `INSTR` 出现在 `16/data.map` L17 的 `sql_embed` 参数(非 execute_sql,属第二逃生口 executeUpdate),且 data.map 已有 `database.after:"sqlite"` 锁。`_template.map` 是注释模板(266 行纯 `//`),不加载。**需补加引擎锁的 .map 清单:空集 ∅**。R13 风险**已由现有锁完全覆盖,风险等级下调为"已缓解"**。切片 S8 DoD ⑤"扫描加锁"子项无需任何文件改动,可标记完成。

---

## 5. 数据模型与类型映射

### 5.1 SQLite → PostgreSQL 类型映射表

| SQLite 类型(原始 DDL) | PostgreSQL 类型 | 说明 |
|------------------------|-----------------|------|
| `TEXT` | `TEXT` | PG TEXT 等价无长度限制 VARCHAR,语义一致 |
| `INTEGER` | `BIGINT` | SQLite INTEGER 是 8 字节;PG INTEGER 仅 4 字节(-2^31..2^31-1),用 BIGINT(8 字节)避免溢出 |
| `INTEGER PRIMARY KEY` | `BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY` | SQLite `INTEGER PRIMARY KEY` = rowid,允许外部赋值 + 自动递增;PG `GENERATED BY DEFAULT AS IDENTITY` 同构(未赋值则自增,赋值则用赋值) |
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY` | **已核实 2026-07-18 修订**(原映射为 `GENERATED ALWAYS`):SQLite AUTOINCREMENT 保证单调递增不复用;运行时 session_id 从不手动赋值,但搬迁管道 `vrcx.js:492-513 copyTableData` 显式复制原值,`GENERATED ALWAYS` 会拒绝搬迁。改用 `BY DEFAULT` 与普通 INTEGER PK 映射统一,兼容搬迁。R6 缓解措施(a)确认 |
| `TEXT PRIMARY KEY` | `TEXT PRIMARY KEY` | 直接映射(如 user_id、avatar_id、id 等 VRChat 外部 ID) |
| `PRIMARY KEY(col1, col2)` | `PRIMARY KEY(col1, col2)` | 复合主键直接映射 |
| `UNIQUE(col1, col2)` | `UNIQUE(col1, col2)` | 唯一约束直接映射 |
| `NOT NULL DEFAULT ''` | `NOT NULL DEFAULT ''` | 直接映射 |
| `NOT NULL DEFAULT 0` | `NOT NULL DEFAULT 0` | 直接映射 |
| `DEFAULT ''`(可空) | `DEFAULT ''` | PG 默认可空,与 SQLite 一致 |
| `INTEGER NOT NULL DEFAULT 0` | `BIGINT NOT NULL DEFAULT 0` | INTEGER→BIGINT |
| `INTEGER`(无约束,可空) | `BIGINT` | 可空整数 |
| `pending_session_start_at INTEGER`(可空) | `pending_session_start_at BIGINT` | 可空,直接映射 |

**`_mapColumnType(sqliteType)` 私有方法**(用于 createTable/alterTableAddColumn):
```
_mapColumnType(sqliteType):
  # 按上表做字符串替换:
  # 'INTEGER PRIMARY KEY AUTOINCREMENT' → 'BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY'(修订:原 ALWAYS,搬迁兼容)
  # 'INTEGER PRIMARY KEY' → 'BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY'
  # 'INTEGER' → 'BIGINT'
  # 'TEXT' → 'TEXT'
  # 其他(NOT NULL/DEFAULT/PRIMARY KEY(...) 等修饰)保留
```
**实现注意**:需按"最长匹配优先"顺序替换(先匹配 AUTOINCREMENT 再匹配 PRIMARY KEY),避免 `INTEGER PRIMARY KEY` 被先替换为 `BIGINT ... PRIMARY KEY` 后又撞 AUTOINCREMENT。

### 5.2 50 张用户表的 PG DDL 生成策略

**策略**:PgSQLAdapter.initUserSchema **自带完整 PG DDL**(与 SQLiteAdapter L900-979 同构但类型映射后),不复用 SQLiteAdapter 的表定义元数据。

**理由**:
- SQLiteAdapter 的 DDL 是内联字符串(L900-979),非结构化元数据,无法跨引擎复用
- 类型映射需逐表逐列处理,直接写 PG DDL 比抽元数据更清晰
- EngineAdapter 接口未定义表元数据抽象,抽元数据需新增接口(破冻结)

**生成方式**:手动把 SQLiteAdapter L900-979 的 50 张表 DDL 翻译为 PG 版本(类型按 §5.1 映射,表名用 `userTable(prefix, name)`,索引名去 prefix)。

**DDL 模板示例**(feed_gps,对应 SQLiteAdapter L901-903):
```
CREATE TABLE IF NOT EXISTS ${this.userTable(prefix, 'feed_gps')} (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  created_at TEXT, user_id TEXT, display_name TEXT, location TEXT,
  world_name TEXT, previous_location TEXT, time BIGINT, group_name TEXT
)
```

**索引模板示例**(对应 L916-918):
```
CREATE INDEX IF NOT EXISTS feed_online_offline_user_created_idx
  ON ${this.userTable(prefix, 'feed_online_offline')} (user_id, created_at)
```
索引名去 prefix(schema 内唯一),`ON account_{prefix}.table`。

**50 张表清单**(据 SQLiteAdapter L900-979 核实,实际为 ~25 张表 + 若干索引,Brief 称 50 张含索引计数):
feed_gps, feed_status, feed_bio, feed_avatar, feed_online_offline(+索引), activity_sync_state_v2, activity_sessions_v2(+2索引), activity_bucket_cache_v2, friend_log_current, friend_log_history(+索引), notifications, notifications_v2, moderation, avatar_history, notes, mutual_graph_friends, mutual_graph_links, mutual_graph_links_old, mutual_graph_friends_old, mutual_graph_meta, tracked_nonfriends, manual_relations_MANUEL

### 5.3 20 张全局表的 PG DDL

**策略**:PgSQLAdapter.initGlobalSchema 自带 PG DDL,表放 `public` schema。

**DDL 模板示例**(gamelog_location,对应 SQLiteAdapter L986-988):
```
CREATE TABLE IF NOT EXISTS public.gamelog_location (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  created_at TEXT, location TEXT, world_id TEXT, world_name TEXT,
  time BIGINT, group_name TEXT,
  UNIQUE(created_at, location)
)
```

**索引**:保持原名(如 `idx_gamelog_location_world_created`),`ON public.gamelog_location`。

**全局表清单**(据 L985-1049):gamelog_location(+2索引), gamelog_join_leave(+3索引), gamelog_portal_spawn, gamelog_video_play, gamelog_resource_load, gamelog_event, gamelog_external, cache_avatar, cache_world, favorite_world, favorite_avatar, favorite_friend, memos, world_memos, avatar_memos, avatar_tags

### 5.4 索引策略

| 维度 | SQLite | PgSQL |
|------|--------|-------|
| 全局表索引名 | 全局唯一(含 `idx_` 前缀) | 保持原名,public schema 内唯一 |
| 用户表索引名 | `${prefix}_table_col_idx`(含 prefix,全局唯一) | `table_col_idx`(去 prefix,schema 内唯一) |
| 索引名长度 | 无限制 | PG 最长 63 字节;去 prefix 后通常 <63,安全 |
| CREATE INDEX 语法 | `CREATE INDEX IF NOT EXISTS` | **同构** |
| UNIQUE INDEX | `CREATE UNIQUE INDEX IF NOT EXISTS` | **同构** |

**理由**:PgSQL 索引名在 schema 内唯一即可。用户表索引放 `account_{prefix}` schema,去 prefix 后名更短,避免超 63 字节限制。

---

## 6. 迁移路径

### 6.1 PgSQL 全新建表路径(D2)

**场景**:PgSQL 作为新引擎,无历史 SQLite 库需迁移。新用户首次启动 PgSQL 模式。

**路径**:
1. `PostgreSQL.Init()` 读配置建连接池(§4.2)
2. `adapter.initGlobalSchema()` 建 public schema 下 20 张全局表(§4.1.8)
3. `runMigrations(currentVersion=0, targetVersion=LATEST)`:
   - PgSQL 的 `currentVersion` 从 configs 表读 `VRCX_databaseVersion`(首次为 0)
   - 迁移运行器遍历 .map,`checkDatabaseCompatibility` 对 `database.after:"sqlite"` 的 .map 返回 skip(D2)
   - v16 schema.map/data.map 被跳过(都有 `database.after:"sqlite"`)
   - 其余非 sqlite 锁的 .map 执行(若有的话)
4. 用户登录后 `adapter.initUserSchema(prefix)` 建 `account_{prefix}` schema + 50 张用户表(§4.1.7)
5. `recordCheckpoint(LATEST)` 写 configs 表

**v16 ALTER 对 PgSQL 的意义**:v16 是给 SQLite 历史库补 group_name 列等。PgSQL 的 initUserSchema PG DDL **已直接包含 group_name 列**(因 DDL 是最新版翻译),故 v16 ALTER 对 PgSQL 无意义,跳过正确。

### 6.2 SQLite → PgSQL 数据搬迁管道(9.13)

**场景**:现有 SQLite 用户想切换到 PgSQL,需把 SQLite 库的数据搬到 PgSQL。

**设计要点**:

1. **双 adapter 实例**:
   - 源 adapter:`new SQLiteAdapter({ connection: 'sqlite:///old.db' })`(或用 C# `SQLite.ExecuteJsonOnConnection(connectionString, ...)` 直读)
   - 目标 adapter:`new PgSQLAdapter()`(已 Init)
   - 跨引擎读 SQLite 写 PgSQL

2. **搬迁流程**:
   ```
   for each 全局表 in 20张:
     rows = srcAdapter.select(table, '*')
     for batch in rows(N行一批):
       dstAdapter.bulkInsert(table, batch, 'ignore')   # ON CONFLICT DO NOTHING
     verify: dstAdapter.count(table) == srcAdapter.count(table)

   for each 账号 prefix:
     dstAdapter.initUserSchema(prefix)                  # 建 schema + 表
     for each 用户表 in 50张:
       srcTable = `${prefix}_${name}`                   # SQLite 平铺名
       dstTable = dstAdapter.userTable(prefix, name)    # account_prefix.name
       rows = srcAdapter.select(srcTable, '*')
       for batch in rows:
         dstAdapter.bulkInsert(dstTable, batch, 'ignore')
       verify count
   ```

3. **类型转换**:
   - SQLite `INTEGER` 值 → PgSQL `BIGINT` 列:JS number 范围足够,直接传
   - SQLite `TEXT` → PgSQL `TEXT`:直接传
   - **关键**:用户表 id 若为外部赋值(VRChat feed 的 id),PG `GENERATED BY DEFAULT` 接受;activity_sessions_v2 的 `AUTOINCREMENT` → PG `GENERATED BY DEFAULT`(已核实 2026-07-18 修订,原 ALWAYS 会拒绝搬迁管道 `vrcx.js:492-513 copyTableData` 显式复制的 session_id 原值)。**统一用 BY DEFAULT,搬迁管道直接 copyTableData 即可,无需 OVERRIDING SYSTEM VALUE 或 replica role**。

4. **分批**:bulkInsert 每批 N 行(N 可配,默认 500),避免单 SQL 过大(PG 参数上限 65535,50 列 × 500 行 = 25000 参数,安全)

5. **校验**:
   - 行数校验:`count(dst) == count(src)` 每表
   - 抽样校验:随机抽 K 行对比关键字段
   - 时间戳范围校验:`MIN(created_at)`/`MAX(created_at)` 一致

6. **搬迁入口(已核实 2026-07-18)**:新增 `src/services/database/migrateEngine.js`,提供 `migrateSqliteToPgsql(srcConnStr, dstConfig)`。**UI 入口确定**:当前无任何引擎配置/切换/搬迁 UI,必须新建。入口放 **AdvancedTab.vue**(L177 现有"数据库"组后)新增"数据库引擎" `SettingsGroup`:引擎模式 `Select`(SQLite/PostgreSQL)+ PgSQL 连接字段(host/port/username/password/name)`Input` + "测试连接"`Button`(调 `adapter.isConnected()`/`getHealth()` 或 C# `Ping()`)+ "迁移数据并切换"`Button`(触发 `migrateEngine.migrateSqliteToPgsql`)。搬迁进度复用现有 `DatabaseUpgradeDialog.vue`(已有 `fromVersion = -1` "迁移中"状态)。**首次切引擎引导对话框建议留作后续,Phase 9 不做**。可参考 `vrcx.js:421-486 migrateFromOldDb` 的同引擎搬迁代码模式(枚举表 → bulkInsert ignore → 跑 fixes),但跨引擎需独立模块。

### 6.3 v16 .map 跳过逻辑对运行器的影响

**影响 1**:checkDatabaseCompatibility 返回 skip 标志(§4.5.2),迁移调度入口需处理 skip(continue + warn 日志)。

**影响 2**:PgSQL 的 `currentVersion` 从 configs 表读。首次 PgSQL 启动 configs 表为空,`currentVersion = 0`,运行器会尝试执行所有 .map。v16 被 skip,其余 .map(若有非 sqlite 锁的)执行。**需核实**:除 v16 外是否还有其他 .map 带 `database.after:"sqlite"`。已核实 v16 schema.map/data.map 都有(§3.2.7),其余 .map 需扫描确认。

**影响 3**:skip 后 `recordCheckpoint` 仍需记录版本号(否则下次重复尝试 skip)。**设计**:skip 的 .map 视为"已满足"(PgSQL initSchema 已含最新结构),recordCheckpoint 记录 targetVersion。

---

## 7. 测试策略

### 7.1 PgSQL mock 基础设施(vitest.setup.js)

**最小改造**(vitest.setup.js L18 后加一行):
```
globalThis.PostgreSQL = new Proxy({}, { get: () => noopAsync });
```
使 PgSQLAdapter 在 vitest 下不抛 `ReferenceError`。但 noopAsync 返回空字符串,`JSON.parse('')` 会报错。**需增强 stub**:提供最小可用的 `ExecuteJson`/`ExecuteNonQuery` mock,或 PgSQLAdapter 单测用真实 PG 容器(§7.7)。

**方案选择**(§7.7):PgSQLAdapter 单测**不走 noop stub**,而走"真实 PG 容器 + 集成测试"路径。noop stub 仅保证 import 不报错(单元测试不涉及 PG 调用时)。

### 7.2 契约测试去方言化

**现状**:`test/contract/adapter-contract.js` 接口已参数化(`runAdapterContractTests(adapterFactory, name)`),但用例 SQL 含:
- `@named` 参数(L71 `WHERE id = @id`)
- `INTEGER PRIMARY KEY`(L50)
- `PRAGMA table_xinfo` 假设(getTableColumns 用例)

**改造方案(最小)**:契约测试用例 SQL 保持 `@named`(PgSQLAdapter._bind 自动转 `$N`,对契约测试透明)。`INTEGER PRIMARY KEY` 由 PgSQLAdapter._mapColumnType 转 PG 类型。`PRAGMA table_xinfo` 用例需拆分或为 PgSQL 写镜像用例。

**具体**:
- **保留**:大部分用例(execute/insert/update/select/count 等)的 `@named` 参数和 `INTEGER PRIMARY KEY` 由 _bind + _mapColumnType 透明处理,SQLite/PgSQL 共用
- **拆分**:`getTableColumns`/`listTablesTypes` 用例(依赖 PRAGMA 结构)需为 PgSQL 写镜像用例(断言 information_schema 列结构)
- **新增 wrapper**:`test/contract/adapter-contract.pgsql.js`(或加到现有 SQLite wrapper),`runAdapterContractTests(() => new PgSQLAdapter(...), 'PgSQL')`,仅在 PG 容器可用时跑

### 7.3 方言差异点测试(task 10.3)

| 测试点 | 验证内容 | 测试方式 |
|--------|----------|----------|
| 参数绑定(_bind) | `@user_id` 不误匹配 `@user`;重复 `@key` 复用 `$N`;不在 args 的 `@ident` 保留 | 纯单元测试(不需 PG,测 _bind 字符串输出) |
| schema 隔离 | `userTable('abc', 'feed_gps')` → `'account_abc.feed_gps'` | 纯单元测试 |
| 类型映射 | `_mapColumnType('INTEGER PRIMARY KEY AUTOINCREMENT')` → 正确 PG 类型 | 纯单元测试 |
| SQL fragments | 5 个 fragment 生成正确 PG 语法 | 纯单元测试(断言字符串) |
| INSERT ON CONFLICT | `insert(t, d, 'ignore')` 生成 `ON CONFLICT DO NOTHING` | 集成测试(PG 容器验证语义) |
| initUserSchema | `CREATE SCHEMA` + 50 表建成功 | 集成测试 |
| listTables D4 | 返回 `account_xxx.feed_gps` 限定名 | 集成测试 |
| 跨 .map 跳过 | v16 .map 对 PgSQL skip | 集成测试(mock engine + .map) |

### 7.4 跨引擎迁移测试(task 10.7)

- 用 `createTestAdapter`(vitest.setup.js L97-104,SQLite 内存库)作为源
- 用 PG 容器 adapter 作为目标
- 执行 §6.2 搬迁流程,校验行数 + 抽样
- **需新增**:`migrateEngine.test.js`,skip 若无 PG 容器(`describe.skipIf(!process.env.PG_TEST_HOST)`)

### 7.5 CI PostgreSQL setup(task 9.15,采纳 review 后修订)

**GitHub Actions workflow** 使用 [`ikalnytskyi/action-setup-postgres`](https://github.com/marketplace/actions/setup-postgresql-for-linux-macos-windows) 在 runner 上直接 provision PG(支持 Linux/macOS/Windows,无需 Docker service container):
```yaml
jobs:
  test_pgsql:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        pg:
          - { version: "16" }
          - { version: "17" }
    steps:
      - checkout
      - name: Setup PostgreSQL
        uses: ikalnytskyi/action-setup-postgres@c4dda34aae1c821e3a771b68b73b13af3198a7ee # v8
        id: postgres
        with:
          postgres-version: ${{ matrix.pg.version }}
          username: vrcx
          password: vrcx
          database: vrcx
          port: 5432
      - setup-node 24
      - npm ci
      - name: Run PgSQL integration tests
        run: npm test -- --include '**/*.pgsql.test.js'
        env:
          PG_TEST_HOST: localhost
          PG_TEST_PORT: 5432
          PG_TEST_USER: vrcx
          PG_TEST_PASSWORD: vrcx
          PG_TEST_DB: vrcx
          PG_TEST_VERSION: ${{ matrix.pg.version }}
          PGSERVICE: ${{ steps.postgres.outputs.service-name }}
```

**修订理由**(2026-07-19 PR #7 review 采纳):
- service container 模式仅支持 Linux runner,`action-setup-postgres` 支持 Linux/macOS/Windows 三平台
- 无需 Docker,runner 启动更快
- action 经 GitHub Marketplace 审核,可用 SHA pin 防供应链攻击
- 移除独立的 docker-compose 文件(开发阶段过渡工具,长期保留意义不大;开发者本地需 PG 可 `docker run postgres:16` 一行启动)

### 7.6 本地开发 PG 容器(task 9.16,采纳 review 后降级)

**原设计** `docker-compose.pgsql.yml` 经 PR #7 review 后**移除**。开发者本地需要 PG 16/17 时,直接使用:
```bash
docker run -d --name vrcx-pg -e POSTGRES_PASSWORD=vrcx -e POSTGRES_USER=vrcx -e POSTGRES_DB=vrcx -p 5432:5432 postgres:16
# 或 PG 17:postgres:17
pg_isready -h localhost -p 5432 -U vrcx
```

CI 不依赖 docker-compose(改用 §7.5 的 `action-setup-postgres`),仓库内不保留 compose 文件。

### 7.7 测试基础设施缺口:Node 无内置 PG

**问题**:Node 无内置 PG 驱动(不像 `node:sqlite`)。PgSQLAdapter 单测/集成测试需选方案:

| 方案 | 优点 | 缺点 | 适用 |
|------|------|------|------|
| **pg-mem**(JS 内存 PG 模拟) | 无需容器,快 | SQL 兼容性不全(尤其 information_schema/pg_catalog) | 纯单元测试(_bind/类型映射/fragment 字符串) |
| **真实 PG 容器**(docker/CI service) | 100% 兼容 | 需 docker,慢 | 集成测试(DDL/CRUD/迁移) |
| **仅集成测试**(不单测 PgSQLAdapter) | 最小改造 | 单测覆盖低 | 最小路径 |

**Phase 9 最小方案**:
- **纯单元测试**(_bind、_mapColumnType、userTable、SQL fragments、_stripWildcardPrefix):不需 PG,直接断言字符串输出。用 vitest 默认环境。
- **集成测试**(initUserSchema/listTables/CRUD 语义/搬迁):用真实 PG(CI 由 `action-setup-postgres` action provision,本地用 `docker run postgres:16`),`describe.skipIf(!process.env.PG_TEST_HOST)` 跳过无 PG 环境。
- **不用 pg-mem**:避免引入新依赖 + 兼容性陷阱。_bind 等纯逻辑用单元测试覆盖,DDL/语义用真实 PG 覆盖。

---

## 8. 不变量与契约

| ID | 不变量 | 验证方式 |
|----|--------|----------|
| **INV-01** | `userTable(prefix, name)` 返回值必须是合法 PG `schema.table` 二段式标识符,格式 `account_{prefix}.{name}`,符合 PG 标识符规则 | 单元测试:`userTable('abc','feed_gps') === 'account_abc.feed_gps'`;`userTable('_123','t') === 'account__123.t'` |
| **INV-02** | `listTables(pattern)` 返回值必须是带 schema 的完整限定名(D4),如 `['account_abc.feed_gps']`,可直接用于 SQL 标识符,后续 ALTER 无需补前缀 | 集成测试:建 schema + 表后调 listTables,断言每项含 `.` 且 `.` 前部分匹配 `account_*` |
| **INV-03** | `_bind` 对业务模块透明:业务模块继续写 `@key`,338 处调用零改动 | 集成测试:现有 SQLiteAdapter 契约测试用例 + 业务模块测试在 PgSQL 模式下通过(去方言化部分) |
| **INV-04** | PgSQL 引擎下 v16 .map 不执行(D2):`checkDatabaseCompatibility` 返回 skip,调度入口 continue | 单元测试:mock engine='postgresql' + v16 .map,断言 skip |
| **INV-05** | `Init()` 读 7 字段配置(D3):host/port/username/password/name,不把 name 当完整连接串 | C# 集成测试:设 5 字段 → Init 成功;name 含 `;` → 拒绝 |
| **INV-06** | 跨账号聚合保持 `withPrefix` 串行单 prefix 模式(D5):不新建 UNION ALL 聚合视图,`feed.js` L600 透明适配 | 集成测试:多账号 schema 建表后,`withPrefix` 切换查询单账号数据正确 |
| **INV-07** | `_bind` 边界匹配:`@user_id` 不误匹配 `@user`,反之亦然 | 单元测试(§7.3):`_bind('WHERE @user_id=@user', {user_id:1,user:'x'})` → `WHERE $1=$2`,values=[1,'x'] |
| **INV-08** | 重复 `@key` 复用同一 `$N`,positional array 不重复放值 | 单元测试:`_bind('@a AND @a', {a:1})` → `$1 AND $1`,values=[1] |
| **INV-09** | PgSQL 全局表在 `public` schema,用户表在 `account_{prefix}` schema,两者隔离 | 集成测试:initGlobalSchema + initUserSchema 后,查 pg_tables 断言 schemaname 分布 |
| **INV-10** | 类型映射不丢精度:`INTEGER` → `BIGINT`(8 字节),避免 PG INTEGER(4 字节)溢出 | DDL 审查 + 集成测试:插入大数(>2^31)成功 |

---

## 9. 失败模式与风险

| ID | 风险 | 影响 | 概率 | 缓解措施 |
|----|------|------|------|----------|
| **R1** | `_bind` 的 `@key` 扫描误匹配(如 `@user_id` 撞 `@user`) | 数据错绑/查询错误 | 低(正则贪婪匹配已消除) | §4.1.1 边界匹配正则 + INV-07 单元测试覆盖 |
| **R2** | 连接串注入(host/password 含 `;`/`'`) | 安全漏洞/连接失败 | 中 | §4.2.1 ValidateField 白名单 + 字符黑名单(`;`/`'`/`"`/`\0`) |
| **R3** | `_bind` 正则匹配字符串字面量内的 `@identifier`(如 `'foo@bar.com'`) | 误替换字面量 | 低(与 SQLite 同构,现有代码隐含无冲突) | §4.1.1 沿用 SQLite 隐含假设;若后续发现冲突,加字符串字面量跳过解析器(Phase 9 不做) |
| **R4** | ~~`getTableColumns` 返回结构差异~~ **已核实不成立(2026-07-18)**:生产代码零调用 | 无影响 | — | §4.1.10 已核实:`getTableColumns` 无生产调用方,R4 关闭。PgSQLAdapter 无需结构对齐 |
| **R5** | `sqlEnterTime` 返回格式 PG `::text` 与 SQLite `strftime` 不一致 | gameLog.js 时间计算错误 | **已确认(2026-07-18)** | §4.1.12 已修订:gameLog.js:1594 严格假设 ISO `YYYY-MM-DDTHH:MM:SSZ`,必须用 `to_char(..., 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,已在上表落实 |
| **R6** | ~~`GENERATED ALWAYS` 搬迁时无法保留原 id~~ **已修订(2026-07-18)**:改为 `BY DEFAULT` | activity_sessions_v2 搬迁兼容 | 已缓解 | §4.1.7 + §5.1 + §6.2 统一改为 `GENERATED BY DEFAULT AS IDENTITY`,搬迁管道直接 copyTableData 即可 |
| **R7** | PG 大小写敏感:未加引号的标识符折叠为小写,SQLite 不折叠 | 表名/列名大小写不匹配 | 低(VRCX 表名均小写蛇形) | DDL 不加引号(默认折叠小写),与 SQLite 小写表名一致;若遇大小写混合列名需 `"` 引号 |
| **R8** | PG 保留字冲突(如 `user`/`order`/`type` 是 PG 保留字) | DDL/查询语法错误 | 中(VRCX 有 `type`/`time` 列) | `type`/`time` 在 PG 是非保留字(可作列名);`user` 是保留字但 VRCX 用 `user_id` 不是 `user`。**需扫描 50+20 表 DDL 确认无 PG 保留字列名** |
| **R9** | schema 创建失败(权限不足) | initUserSchema 失败 | 低(假设 vrcx 用户有 CREATE SCHEMA 权限) | 文档要求 DBA 预授权;Init 失败提示权限要求 |
| **R10** | 事务隔离级别差异:SQLite 值 Serializable,PG 默认 Read Committed | 并发场景行为差异 | 低(VRCX 单进程) | Phase 9 不调隔离级别,沿用 PG 默认 Read Committed;若需 Serializable 显式 `SET TRANSACTION ISOLATION LEVEL` |
| **R11** | `listTables` LIKE 中 `_` 单字符通配符 | `account_%` 匹配 `accountX`(无下划线) | 中 | §4.1.9 加 `ESCAPE '\'` + `account\_%` 转义下划线 |
| **R12** | ~~`insert(..., 'replace')` 无 pk 降级 ignore~~ **已修订(2026-07-18)**:分层方案 | 23 处真 replace 需 ON CONFLICT DO UPDATE | **低**(已落实路径) | §4.1.5 已修订:默认路径用 `table→PK` 元数据映射生成 `ON CONFLICT (pk) DO UPDATE SET`,仅 4 处自增 PK 降级 ignore(等价 SQLite)。风险等级"中"→"低" |
| **R13** | ~~除 v16 外其他 .map 含 SQLite 特有 execute_sql~~ **已核实(2026-07-18)**:无遗漏 | 无风险 | — | §4.5.3 已核实:全仓仅 1 个 execute_sql(16/schema.map L37,可移植 UPDATE,已锁定 sqlite);INSTR 在 16/data.map sql_embed(已锁定 sqlite);`_template.map` 不加载。需补加锁的 .map 为空集 ∅。R13 已缓解 |
| **R14** | 删除用户调用点未接入 dropUserSchema | PgSQL 残留 account_xxx schema | 中(**待产品决策**) | §4.1.15 已核实:**当前无既有"删除用户数据"流程**。`deleteSavedLogin`(auth.js:689)仅删凭据 JSON,DB 数据永久保留(有意设计,重新登录可恢复)。`dropTable` 生产零调用。dropUserSchema 是全新能力,接入待产品决策是否提供"彻底删除账号"功能。SQLite 侧"逐表 drop 双实现"仅在产品决定时才需。9.11 验收第 ③ 点降级为"方法存在 + 集成测试通过;调用点接入待产品决策" |
| **R15** | Node 无内置 PG,测试基础设施不足 | PgSQLAdapter 测试覆盖低 | 中 | §7.7 纯单元测试(_bind/映射/fragment)+ 真实 PG 容器集成测试,不引入 pg-mem |
| **R16** | NpgsqlDataSource 在 Linux/Mono 下行为差异 | LINUX 模式 PgSQL 不可用 | 低 | Phase 9 聚焦 Windows + CI ubuntu;LINUX 手动验证留 Phase 11.4 |

---

## 10. 实现切片划分(atomic verifiable slices)

### 10.1 切片依赖图

```
                    9.2 (C# Init + 池 + 桥注册 4 处)
                     │
                     ▼
                    9.3 (PgSQLAdapter 骨架 + _bind + execute/executeNonQuery + adapter/index.js + vitest stub)
                     │
       ┌─────────────┼─────────────┬────────────┐
       ▼             ▼             ▼            ▼
       9.4          9.5           9.6          (9.16 已降级, 可并行)
   (方言:insert   (SQL           (userTable
    /upsert/类型)  fragments)     schema 隔离)
       │             │             │
       │             │             ├──────► 9.7 (initUserSchema DDL)
       │             │             ├──────► 9.8 (initGlobalSchema DDL)
       │             │             ├──────► 9.9 (listTables/getTableColumns/listTablesTypes)
       │             │             ├──────► 9.11 (dropUserSchema)
       │             │             └──────► 9.10 (验证 aggregatedView, 按 D5 降级)
       │             │             │
       └─────────────┴─────────────┘
                     │
                     ▼
                    9.12 (迁移运行器: getDatabaseEngine + checkCompatibility skip)
                     │
                     ▼
                    9.13 (SQLite→PgSQL 搬迁管道)
                     │
                     ▼
                    9.14 (健康检查 isConnected/getHealth, C# Ping)  ◄── 也可与 9.2 并行
                     │
                     ▼
                    9.15 (CI PG service container + 集成测试)
```

### 10.2 切片明细(按建议执行顺序)

#### 切片 S1 — task 9.2 + 桥注册(C# 基础)
- **任务**:9.2 NpgsqlDataSource 连接池 + 自动重连 + 4 处桥注册
- **改动文件**:
  - `Dotnet/PostgreSQL.cs`(L44-61 Init 重写 + L106-118/L123-139 改借池连接 + 新增 IsConnected/GetHealth/Ping/ValidateField)
  - `Dotnet/Cef/JavascriptBindings.cs`(L13 后加 PostgreSQL 注册)
  - `src-electron/main.js`(L121-124 加 else if postgresql)
  - `Dotnet/Program.cs`(L241-244 加 else if postgresql)
- **验证证据**:
  - `dotnet build Dotnet/VRCX-Cef.csproj` + `VRCX-Electron.csproj` 编译通过
  - 手动设 `VRCX_Database.{mode=postgresql,host,port,username,password,name=vrcx}` 启动,日志显示 PostgreSQL.Init 成功
  - name 含 `;` 时 Init 抛错(注入防护)
- **残留风险**:R2(注入防护需 C# 单测,Phase 9 靠手动验证)、R9(权限)
- **依赖**:9.1 已完成

#### 切片 S2 — task 9.3 + 9.4 + 9.5(PgSQLAdapter 核心)
- **任务**:9.3 PgSQLAdapter 骨架 + 9.4 方言适配(参数/冲突/类型) + 9.5 SQL fragments
- **改动文件**:
  - `src/services/database/adapter/PgSQLAdapter.js`(新建:EngineAdapter 继承 + _bind + execute/executeNonQuery + 全部 CRUD + _mapColumnType + 5 SQL fragments + userTable(先返回平铺名,9.6 改 schema))
  - `src/services/database/adapter/index.js`(L3 改运行时读 mode + L6-10 加 else if postgresql + createAdapter 加 postgresql://)
  - `vitest.setup.js`(L18 后加 globalThis.PostgreSQL stub)
- **验证证据**:
  - `_bind` 单元测试:边界匹配(INV-07)、重复 key(INV-08)、不在 args 保留
  - `_mapColumnType` 单元测试:5.1 映射表全覆盖
  - SQL fragments 单元测试:5 个方法字符串输出正确
  - `npm run typecheck:js && npm run lint` 通过
  - 现有 SQLiteAdapter 测试不受影响(stub 不影响 sqlite 模式)
- **残留风险**:R1(由 _bind 单测覆盖)、R3、R5、R7、R8、R12
- **依赖**:S1(C# PostgreSQL 可调)

#### 切片 S3 — task 9.6(schema 隔离)
- **任务**:9.6 userTable → `account_{prefix}.{name}` + `_schemaPrefix`
- **改动文件**:`PgSQLAdapter.js`(userTable + _schemaPrefix)
- **验证证据**:单元测试 INV-01(`userTable('abc','t') === 'account_abc.t'`);withPrefix 嵌套仍正确
- **残留风险**:prefix 生成规则依赖 database/index.js L56-58(已合规)
- **依赖**:S2

#### 切片 S4 — task 9.7 + 9.8(initSchema DDL)
- **任务**:9.7 initUserSchema(CREATE SCHEMA + 50 表 PG DDL)+ 9.8 initGlobalSchema(public schema 20 表 PG DDL)
- **改动文件**:`PgSQLAdapter.js`(initUserSchema + initGlobalSchema,翻译 SQLiteAdapter L900-1049)
- **验证证据**:
  - 集成测试(PG 容器):initUserSchema('abc') 后 `SELECT * FROM pg_tables WHERE schemaname='account_abc'` 返回 50 表
  - initGlobalSchema 后 `SELECT * FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'gamelog_%'` 返回 20 表
  - 类型映射:插入大数(>2^31)到 BIGINT 列成功(INV-10)
- **残留风险**:R6 已缓解(activity_sessions_v2 改用 GENERATED BY DEFAULT)、R8(保留字扫描)
- **依赖**:S3(userTable)

#### 切片 S5 — task 9.9(元数据方法)
- **任务**:9.9 listTables(pg_catalog) + getTableColumns(information_schema) + listTablesTypes + _stripWildcardPrefix + _splitQualified + _describeColumns
- **改动文件**:`PgSQLAdapter.js`
- **验证证据**:
  - 集成测试:listTables('%_feed_gps') 返回 `['account_abc.feed_gps']`(INV-02/D4)
  - LIKE 转义:account_ 下划线转义正确(R11)
  - getTableColumns 直接返回 information_schema 行(R4 已核实无生产调用方,无需结构对齐)
- **残留风险**:R4 已关闭、R11
- **依赖**:S4(需先建表才能查元数据)

#### 切片 S6 — task 9.11(Schema 清理)
- **任务**:9.11 dropUserSchema(prefix) → `DROP SCHEMA IF EXISTS account_${prefix} CASCADE`
- **改动文件**:`PgSQLAdapter.js`(dropUserSchema)。**已核实(2026-07-18)**:无既有删除用户数据流程可接入,dropUserSchema 作为预留能力存在,暂不接入 UI 调用点
- **验证证据**:集成测试:建 schema 后 dropUserSchema,`SELECT * FROM pg_tables WHERE schemaname='account_abc'` 返回空
- **残留风险**:R14(待产品决策是否提供"彻底删除账号"功能;当前 DB 数据永久保留是有意设计)
- **依赖**:S3

#### 切片 S7 — task 9.10(aggregatedView 验证,按 D5 降级)
- **任务**:9.10 验证 feed.js 的 `lookupFeedDatabase`/`selectUnion` 在 PgSQL schema 隔离下经 `adapter.userTable()` + `withPrefix()` 透明工作。**已核实(2026-07-18)**:`aggregatedView.js` 位于 `src/services/`(非 `database/`),不含硬编码表名,经 `database.lookupFeedDatabase` 间接获表名,无需改动
- **改动文件**:**不改**
- **验证证据**:集成测试:PgSQL 模式下 aggregatedView 经 feed 接口查询多账号数据正确(通过 withPrefix 串行)
- **残留风险**:无(已核实印证假设)
- **依赖**:S5(userTable 全限定名)

#### 切片 S8 — task 9.12(迁移运行器兼容)
- **任务**:9.12 getDatabaseEngine 运行时读 + checkDatabaseCompatibility skip 逻辑 + 调度入口处理 skip
- **改动文件**:`src/services/database/migrations/index.js`(L210-212 + L219-237 + 调度入口)
- **验证证据**:
  - 单元测试:engine='postgresql' + v16 .map → skip(INV-04)
  - 集成测试:PgSQL 首次启动 runMigrations,v16 跳过,checkpoint 记录 LATEST
  - ~~扫描所有 .map execute_sql,SQLite 特有的加 engine 锁(R13)~~ **已核实(2026-07-18):无需任何文件改动,全仓 .map 锁已覆盖**
- **残留风险**:R13 已缓解
- **依赖**:S2(_bind)/S5(listTables for expandWildcard)

#### 切片 S9 — task 9.13(数据搬迁管道 + UI 入口)
- **任务**:9.13 SQLite → PgSQL 搬迁管道(§6.2)+ 搬迁 UI 入口(AdvancedTab 新增"数据库引擎"组)
- **改动文件**:
  - 新增 `src/services/database/migrateEngine.js`(提供 `migrateSqliteToPgsql`)
  - 扩展 `src/views/Settings/components/Tabs/AdvancedTab.vue`(L177 后新增"数据库引擎" `SettingsGroup`:引擎模式 Select + PgSQL 连接字段 Input + 测试连接 Button + 迁移并切换 Button)
  - 复用 `src/components/dialogs/DatabaseUpgradeDialog.vue`(已有 `fromVersion = -1` "迁移中"状态展示搬迁进度)
  - 可能新增 `src/stores/settings/advanced.js` 的 `databaseEngine` 状态 + setter(写 `VRCX_Database.*`)
- **验证证据**:集成测试:SQLite 内存库 → PG 容器,20 全局表 + 50 用户表行数一致 + 抽样校验;UI 手动触发搬迁流程通过
- **残留风险**:R6 已缓解(session_id 用 BY DEFAULT,搬迁管道直接 copyTableData)
- **依赖**:S4(目标 schema 建表)/S8(运行器)

#### 切片 S10 — task 9.14(健康检查)
- **任务**:9.14 isConnected/getHealth(PgSQLAdapter)+ C# Ping/IsConnected/GetHealth
- **改动文件**:`PgSQLAdapter.js` + `Dotnet/PostgreSQL.cs`(S1 已部分含,此处完善)
- **验证证据**:集成测试:isConnected() 返回 true;断开 PG 后 getHealth() 反映断开
- **残留风险**:无
- **依赖**:S1(可与 S1 部分合并)

#### 切片 S11 — task 9.16(本地 PG 容器,采纳 review 后降级)
- **任务**:9.16 原设计 docker-compose.pgsql.yml,经 PR #7 review 后**移除**;开发者本地需 PG 用 `docker run -d --name vrcx-pg -e POSTGRES_PASSWORD=vrcx -e POSTGRES_USER=vrcx -e POSTGRES_DB=vrcx -p 5432:5432 postgres:16` 一行启动
- **改动文件**:无(原 `docker-compose.pgsql.yml` 已删除)
- **验证证据**:`docker run postgres:16` + `pg_isready -h localhost -p 5432 -U vrcx` 通过
- **残留风险**:无
- **依赖**:无(可与 S2 并行)

#### 切片 S12 — task 9.15(CI PG setup via action)
- **任务**:9.15 GitHub Actions PG 16/17 集成测试矩阵,使用 `ikalnytskyi/action-setup-postgres@c4dda34` action(支持 Linux/macOS/Windows,无需 Docker service container)
- **改动文件**:`.github/workflows/ci.yaml`(扩展 test_pgsql job)
- **验证证据**:CI 在 PG 16/17 上跑集成测试(S4/S5/S8/S9)全绿
- **残留风险**:无
- **依赖**:S2-S10(集成测试就绪)

### 10.3 建议执行顺序

```
S1 (9.2+桥) ──► S2 (9.3+9.4+9.5) ──► S3 (9.6) ──► S4 (9.7+9.8) ──► S5 (9.9)
                                                                  │
S11 (9.16) ────────────── 可并行 ─────────────────────────────────►│
                                                                  ▼
                          S6 (9.11) ──► S7 (9.10) ──► S8 (9.12) ──► S9 (9.13)
                                                                      
S10 (9.14) 可与 S1 合并或紧随 S1
                                                                      
S12 (9.15) 最后,依赖全部集成测试就绪
```

**关键路径**:S1 → S2 → S3 → S4 → S5 → S8 → S9 → S12(11 步,含 S6/S7 并行)

---

## 11. 验收标准

### 11.1 逐 task Definition of Done

| Task | DoD(可检验) |
|------|--------------|
| **9.2** | ① `PostgreSQL.cs.Init()` 读 5 字段拼连接串(D3),name 默认 vrcx;② host/port/username/password/name 字段级校验拒 `;`/`'`/`"`/`\0`;③ NpgsqlDataSource 池化,Execute/ExecuteNonQuery 借池连接;④ 4 处桥注册就绪(CefSharp/Electron/Program/vitest);⑤ `dotnet build` 两 csproj 通过 |
| **9.3** | ① `PgSQLAdapter.js` 存在,`new PgSQLAdapter() instanceof EngineAdapter`;② `adapter/index.js` mode='postgresql' 时返回 PgSQLAdapter 实例;③ vitest `globalThis.PostgreSQL` stub 就绪;④ 现有 SQLiteAdapter 测试全绿(stub 不影响) |
| **9.4** | ① `_bind` 单元测试:边界匹配(INV-07)+ 重复 key(INV-08)+ 不在 args 保留;② `insert(t,d,'ignore')` 生成 `ON CONFLICT DO NOTHING`;③ `insert(t,d,'replace')` 默认路径生成 `ON CONFLICT (pk) DO UPDATE SET`(PK 可解析时),降级路径生成 `DO NOTHING` + warn(PK 不可解析时);④ `_mapColumnType` 5.1 映射表全覆盖(含 AUTOINCREMENT → BY DEFAULT 优先匹配);⑤ 集成测试:insert ignore/upsert/replace 语义正确 |
| **9.5** | ① 5 个 SQL fragments 单元测试字符串输出正确(`EXTRACT(EPOCH FROM)`/`SUBSTRING`/`POSITION`/`::date`/`to_char`);② 集成测试:sqlToUnixMs 对已知时间戳返回正确毫秒;③ **R5 已确认必须用 to_char**:sqlEnterTime 用 `to_char(..., 'YYYY-MM-DD"T"HH24:MI:SS"Z"')` 产出严格 ISO,与 gameLog.js:1594 的 BETWEEN 字典序比较兼容 |
| **9.6** | ① `userTable('abc','feed_gps')` === `'account_abc.feed_gps'`(INV-01);② `withPrefix('xyz', ...)` 内 userTable 返回 `account_xyz.*`;③ 集成测试:PgSQL 模式 feed.js L600 withPrefix 查询单账号数据正确(INV-06) |
| **9.7** | ① `initUserSchema('abc')` 后 `pg_tables WHERE schemaname='account_abc'` 返回 50 表;② 类型 BIGINT(非 INTEGER);③ AUTOINCREMENT 表(activity_sessions_v2)用 `GENERATED BY DEFAULT AS IDENTITY`(R6 缓解,兼容搬迁);④ 索引名去 prefix,schema 内唯一;⑤ `CREATE SCHEMA IF NOT EXISTS` 幂等 |
| **9.8** | ① `initGlobalSchema()` 后 `pg_tables WHERE schemaname='public' AND tablename IN (20表名)` 全部存在;② 全局索引保持原名;③ UNIQUE 约束生效(插入重复行报错) |
| **9.9** | ① `listTables('%_feed_gps')` 返回 `['account_abc.feed_gps', ...]`(INV-02/D4);② LIKE 下划线转义(R11);③ `getTableColumns('account_abc.feed_gps')` 返回 information_schema 列结构(**R4 已关闭:无生产调用方,无需对齐 PRAGMA**);④ `listTablesTypes()` 返回结构化对象含 isPK(vrcx.js:455 唯一调用消费此结构) |
| **9.10** | ① 按 D5 不新建聚合视图,aggregatedView.js 未改(已核实无硬编码表名);② 集成测试:PgSQL 模式 aggregatedView 经 feed 接口查询多账号数据正确;③ 验证 feed.js 的 selectUnion 在 PgSQL schema 隔离下透明工作 |
| **9.11** | ① `dropUserSchema('abc')` 执行 `DROP SCHEMA IF EXISTS account_abc CASCADE`;② 集成测试:建 schema 后 drop,pg_tables 查询返回空;③ **R14 待产品决策**:dropUserSchema 作为预留能力存在,暂不接入 UI 调用点(当前无既有"删除用户数据"流程,DB 数据永久保留是有意设计) |
| **9.12** | ① `getDatabaseEngine()` 运行时读 mode(非硬编码);② `checkDatabaseCompatibility` 对非 sqlite + `database.after:'sqlite'` 返回 skip;③ 调度入口处理 skip(continue + warn);④ 集成测试:PgSQL 首次 runMigrations,v16 跳过(INV-04),checkpoint 记录 LATEST;⑤ **R13 已缓解:无需补加任何 .map 引擎锁(全仓 .map 锁已覆盖,空集 ∅)** |
| **9.13** | ① 搬迁管道 `migrateSqliteToPgsql(srcConnStr, dstConfig)` 存在;② 集成测试:SQLite 内存库 20 全局表 + 50 用户表搬到 PG,行数一致 + 抽样校验 + 时间戳范围校验;③ 分批 bulkInsert 无 PG 参数超限;④ **R6 已缓解:activity_sessions_v2 用 GENERATED BY DEFAULT,搬迁管道直接 copyTableData 即可**;⑤ **UI 入口(已确定)**:AdvancedTab 新增"数据库引擎"组,含模式选择 + 连接字段 + 测试连接 + 迁移并切换按钮,进度复用 DatabaseUpgradeDialog |
| **9.14** | ① `adapter.isConnected()` 返回 `Promise<boolean>`,调用方 `await`(v1.2 改 async —— Electron 桥返回 Promise,同步 `Boolean(Ping())` 恒 true);② `adapter.getHealth()` 返回 `{ connected, latencyMs, lastHealthCheck }`(**v1.2 字段订正**:原稿写成 `{connected, poolStats, latencyMs}`,但 `poolSize`/`poolStats` 字段从未在 C# `GetHealth` 中生成过);③ C# `Ping()` 执行 `SELECT 1` 探活;④ 集成测试:断开 PG 后 `await adapter.isConnected()===false` |
| **9.15** | ① CI workflow 含 PG 16 + PG 17 matrix;② 使用 `ikalnytskyi/action-setup-postgres` action(无需 service container);③ CI 在 PG 16/17 上跑集成测试(S4/S5/S8/S9)全绿;④ `npm run test` 在 CI PG 环境通过 |
| **9.16** | **降级**(PR #7 review 采纳):① `docker-compose.pgsql.yml` 已移除;② 开发者本地用 `docker run postgres:16` + `pg_isready` 验证可连接;③ CI 不依赖 docker-compose(改用 action) |

### 11.2 整体验收门槛

1. **D1 透明性**:18 个 `database/*` 模块 338 处 adapter 调用**零改动**(git diff 确认业务模块文件无变更)
2. **D2 跳过**:PgSQL 模式启动,迁移日志含 `[迁移] 跳过 sqlite 锁定的 .map: v16-schema` + `v16-data`,无报错
3. **D3 配置**:设 `VRCX_Database.{mode=postgresql, host=localhost, port=5432, username=vrcx, password=vrcx, name=vrcx}` 启动成功;name 含 `;` 被拒
4. **D4 限定名**:`listTables('%_feed_gps')` 返回值每项含 `.` 且可直用于 `ALTER TABLE ${ret}`
5. **D5 透明**:`feed.js` L600 withPrefix 未改,多账号 PgSQL 查询正确
6. **接口冻结(v1.2 修订)**:EngineAdapter.js "42 abstract + 3 optional" 接口仍然冻结,但已破例将健康检查 3 抽象(`isConnected()`/`getHealth()`/`getPoolStats()`)提升入基类(commit `c08c62e1`,对称三个适配器实现);`dropUserSchema` 仍为 PgSQLAdapter 特有扩展不入基类。原 v1.1 的"三个扩展都不入基类"决定撤销
7. **回归**:现有 SQLiteAdapter 单测 + 契约测试 + 业务模块测试全绿(PgSQL stub 不影响 sqlite 模式)
8. **CI**:PG 16/17 集成测试矩阵全绿

### 11.3 待核实事项核实结论(2026-07-18 全部完成)

8 项待核实事项已全部基于实际代码核实完成。结论汇总:

| 项 | 核实结论 | 对设计影响 | 状态 |
|----|----------|-----------|------|
| ① `insert(..., 'replace')` 用法 | 27 处:23 处带可推断 PK(真 replace),4 处自增 PK 无冲突 | **修订 §4.1.5**:分层方案(默认 `ON CONFLICT (pk) DO UPDATE SET` + 降级 `DO NOTHING`)。R12 风险"中"→"低" | ✅ 已修订 |
| ② `getTableColumns` 调用方 | 生产代码零调用,仅测试/基类/实现引用 | **关闭 R4**:PgSQLAdapter 无需结构对齐,直接返回 information_schema 行 | ✅ 已关闭 |
| ③ `sqlEnterTime` 格式假设 | gameLog.js:1594 严格假设 ISO `YYYY-MM-DDTHH:MM:SSZ` 用于 BETWEEN 字典序比较 | **修订 §4.1.12**:sqlEnterTime 改用 `to_char(..., 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`。R5 确认必须修正 | ✅ 已修订 |
| ④ activity_sessions_v2 session_id | 运行时不手动赋值,但搬迁管道 `vrcx.js:492-513 copyTableData` 显式复制原值 | **修订 §4.1.7 + §5.1 + §6.2**:改用 `GENERATED BY DEFAULT AS IDENTITY`(统一映射,兼容搬迁)。R6 缓解措施(a)确认 | ✅ 已修订 |
| ⑤ 删除用户调用点 | 无既有"删除用户数据"流程。`deleteSavedLogin` 仅删凭据 JSON,DB 数据永久保留(有意设计)。`dropTable` 生产零调用 | **重新定性 R14**:dropUserSchema 是全新能力,接入待产品决策。9.11 验收第 ③ 点降级为"方法存在 + 集成测试通过;调用点接入待产品决策" | ✅ 已重新定性 |
| ⑥ aggregatedView.js 现状 | 文件位于 `src/services/`(非 `database/`),无硬编码表名,经 `database.lookupFeedDatabase` + `adapter.userTable()` 间接获表名 | **印证 §3.2.11**:9.10 仅验证 feed.js selectUnion 透明适配,不改 aggregatedView.js | ✅ 已印证 |
| ⑦ 其他 .map execute_sql SQLite 特有语法 | 全仓仅 1 个 execute_sql(16/schema.map L37,可移植 UPDATE,已锁定 sqlite);INSTR 在 16/data.map sql_embed(已锁定 sqlite);`_template.map` 不加载 | **印证设计**:需补加锁的 .map 为空集 ∅。R13 已由现有锁完全覆盖,风险等级"中"→"已缓解"。切片 S8 DoD ⑤ 无需任何文件改动 | ✅ 已印证 |
| ⑧ 搬迁管道 UI 入口 | 无任何现有引擎配置/切换/搬迁 UI;DatabaseUpgradeDialog 是进度展示非触发入口;`migrateFromOldDb` 是自动触发的 SQLite→SQLite 搬迁(非跨引擎) | **修订 §6.2 + §11.3**:必须新建 UI,入口放 AdvancedTab.vue L177 后新增"数据库引擎"组(模式 Select + 连接字段 Input + 测试连接 Button + 迁移并切换 Button),进度复用 DatabaseUpgradeDialog,搬迁模块新建 `migrateEngine.js`。首次切引擎引导对话框建议留作后续,Phase 9 不做 | ✅ 已修订 |

**整体影响**:8 项中,3 项修订实现条款(①③④,不改会导致数据丢失/时间计算错误/搬迁失败),3 项印证假设关闭风险(②⑥⑦),2 项重新定性(⑤⑧)。无任何一项阻塞 Phase 9 实现。

---

## Resume-Critical 设计事实(供 auto-compaction 恢复)

1. **D1 _bind 算法**:`/@([A-Za-z_][A-Za-z0-9_]*)/g` 贪婪匹配完整标识符,`@user_id` 不误匹配 `@user`;重复 key 复用 `$N`;不在 args 的 `@ident` 保留原样。_bind 在 PgSQLAdapter.execute/executeNonQuery 内调用,业务模块零改动。
2. **D2 v16 跳过**:checkDatabaseCompatibility 对非 sqlite + `database.after:'sqlite'` 返回 skip,调度入口 continue;PgSQL initSchema PG DDL 已含最新结构(含 group_name),v16 ALTER 无意义。
3. **D3 Init**:读 `VRCX_Database.{host,port,username,password,name}` 5 字段拼连接串,name 默认 vrcx,字段级校验防注入。
4. **D4 listTables**:返回 `account_abc.feed_gps` 带 schema 限定名,LIKE 下划线需 `ESCAPE '\'`。
5. **D5 withPrefix**:feed.js L600 串行单 prefix 透明适配,不新建跨账号聚合视图。
6. **类型映射**:TEXT→TEXT,INTEGER→BIGINT,`INTEGER PRIMARY KEY`→`BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY`,`...AUTOINCREMENT`→`BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY`(**v1.1 修订**:原 ALWAYS,搬迁管道 `vrcx.js:492-513 copyTableData` 显式复制 session_id 原值,ALWAYS 会拒绝,统一改 BY DEFAULT)。
7. **schema 隔离**:userTable → `account_{prefix}.{name}`;全局表 `public.`;用户索引名去 prefix(schema 内唯一)。
8. **接口冻结(v1.2 修订)**:EngineAdapter 42+3 不改;健康检查 3 抽象(`isConnected`/`getHealth`/`getPoolStats`)破例提升入基类;`dropUserSchema` 仍为 PgSQL 特有扩展不入基类。
9. **桥注册 4 处**:JavascriptBindings.cs L13 后,main.js L121-124,Program.cs L241-244,vitest.setup.js L18 后。
10. **切片顺序**:S1(9.2)→S2(9.3+9.4+9.5)→S3(9.6)→S4(9.7+9.8)→S5(9.9)→S6(9.11)→S7(9.10)→S8(9.12)→S9(9.13+UI)→S10(9.14)→S12(9.15),S11(9.16)并行。
11. **测试**:纯单元测试(_bind/映射/fragment,不需 PG)+ 真实 PG 集成测试(CI 由 `action-setup-postgres` action provision,本地 `docker run postgres:16`),不用 pg-mem。**docker-compose.pgsql.yml 经 PR #7 review 移除**(2026-07-19)。
12. **关键风险(v1.1 更新)**:R1(_bind 边界,已由正则解决)、R5(sqlEnterTime 格式,**已确认必须用 to_char 修正**)、R6(AUTOINCREMENT 搬迁,**已缓解改 BY DEFAULT**)、R12(insert replace,**已落实分层方案,风险降为低**)、R14(dropUserSchema 接入,**待产品决策**)。R4(getTableColumns)**已关闭**(无生产调用方)、R13(其他 .map SQLite 特有 SQL)**已缓解**(全仓 .map 锁已覆盖,空集 ∅)。
13. **v1.1 核实新增 — insert replace 分层(§4.1.5)**:PgSQLAdapter 维护 `table→PK columns` 元数据(建表时填充),`conflict='replace'` 默认路径生成 `ON CONFLICT (pk) DO UPDATE SET ${非pk=EXCLUDED.非pk}`(覆盖 23 处真 replace),降级路径 `DO NOTHING`+warn(覆盖 4 处自增 PK,等价 SQLite)。
14. **v1.1 核实新增 — 搬迁 UI(§6.2/§10.2 S9)**:必须新建,入口放 AdvancedTab.vue L177 后新增"数据库引擎"组(模式 Select + host/port/username/password/name Input + 测试连接 Button + 迁移并切换 Button),进度复用 DatabaseUpgradeDialog,搬迁模块新建 `src/services/database/migrateEngine.js`。首次切引擎引导对话框留作后续。

---

以上为 Phase 9 PostgreSQL 适配器完整 Design Document。第 3 章文件级改动清单已具体到行号锚点,第 4.1 章 `_bind` 的 `@key→$N` 扫描规则已给出可执行正则与边界匹配验证,第 5 章类型映射表覆盖 SQLite 全部原生类型,第 10 章切片划分含依赖图与建议顺序,第 11 章验收标准逐 task 可检验。未写任何实现代码,未修改任何文件。
