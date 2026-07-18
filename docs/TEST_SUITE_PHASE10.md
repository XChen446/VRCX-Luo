# Phase 10 测试体系文档 (2026-07)

本文档记录 Issue #3 Phase 10「测试体系完善」中本期完成的 5 个 task（10.1 / 10.2 / 10.6 / 10.8 / 10.9）的测试用例清单、设计决策与执行约定。供后续维护者快速定位测试覆盖范围与运行方式。

## 概览

| Task                                | 文件                                                                                                    | 用例数 | describe | 状态 |
| :---------------------------------- | :------------------------------------------------------------------------------------------------------ | :----: | :------: | :--- |
| 10.1 SQLiteAdapter 方法单测         | `src/services/database/adapter/__tests__/SQLiteAdapter.test.js`                                         |  103   |    11    | 完成 |
| 10.2 EngineAdapter 接口契约         | `test/contract/adapter-contract.js` + `src/services/database/adapter/__tests__/adapterContract.test.js` |   19   |    7     | 完成 |
| 10.6 事务保护测试                   | `src/services/database/migrations/__tests__/migrationTransactionProtection.test.js`                     |   9    |    3     | 完成 |
| 10.8 Vue 组件测试修复               | 3 个 `__tests__/` 下文件                                                                                |   —    |    —     | 完成 |
| 10.9 vitest.setup.js adapter helper | `vitest.setup.js` (+12 行)                                                                              |   —    |    —     | 完成 |

**合计新增测试用例**：131（103 + 19 + 9）。**全套规模**：202 文件 / 2320 测试通过。

---

## 1. Task 10.1 — SQLiteAdapter 方法单测

**文件**：`src/services/database/adapter/__tests__/SQLiteAdapter.test.js`

### 1.1 设计要点

- **载体**：`MemorySQLiteAdapter`（继承 `SQLiteAdapter`，仅 override `execute`/`executeNonQuery`，基于 Node `node:sqlite` `DatabaseSync(':memory:')`）。不经过 `adapter/index.js` 单例。
- **零 `vi.mock`**：直接实例化 adapter，每个 `beforeEach` 重建 `:memory:` db，`afterEach` close。
- **验证方式**：通过真实 SQLite 执行验证实际行为；对方言关键字（`INSERT OR IGNORE` / `INSERT OR REPLACE` / `@param` 前缀 / `strftime('%s', col) * 1000` / `SUBSTR` / `INSTR` / `date()` 等）同时用 `vi.spyOn(adapter, 'executeNonQuery')` 捕获生成 SQL 做字面断言。

### 1.2 describe 块与覆盖范围

|  #  | describe 块                  | 覆盖方法                                                                                                                    | 关键断言                                                                                                                                                       |
| :-: | :--------------------------- | :-------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|  1  | Raw execution                | `execute` / `executeNonQuery` / `_normalizeArgs`                                                                            | callback 收到 positional array；DDL/事务控制返回 0；`@param` 与裸 key 都接受，`_normalizeArgs` 给 key 加 `@` 前缀                                              |
|  2  | DML                          | `insert` / `bulkInsert` / `update` / `updateWhere` / `delete` / `deleteAll` / `deleteWhere` / `increment` / `upsertPartial` | 默认 / `'ignore'` / `'replace'` 三种 clause 字面 + 行为；空数组 `bulkInsert` 早返回 `undefined`；多条件 AND；`upsertPartial` 首次 insert / 第二次 update       |
|  3  | Query                        | `selectOne` / `select` / `selectWhere` / `selectJoin` / `selectWhereIn` / `selectUnion` / `selectGroupBy`                   | `selectOne` 无匹配返回 `null`；`selectWhere` `whereClause=null` 跳过 WHERE；`selectWhereIn` 空数组返回 `[]`；`selectUnion` 派生表包装                          |
|  4  | Count                        | `count` / `countWhere`                                                                                                      | 空表返回 0；条件计数一致性                                                                                                                                     |
|  5  | DDL                          | `createTable` / `createIndex` / `alterTableAddColumn` / `alterTableDropColumn` / `alterTableRename` / `dropTable`           | 字符串 vs 对象列定义；`IF NOT EXISTS` 幂等；`dropTable IF EXISTS` 不存在不抛错                                                                                 |
|  6  | Transaction                  | `begin` / `commit` / `rollback`                                                                                             | commit 持久化、rollback 不持久化、嵌套 begin 抛错                                                                                                              |
|  7  | Maintenance                  | `vacuum` / `optimize`                                                                                                       | 不抛错；走 `exec()` 路径                                                                                                                                       |
|  8  | Schema                       | `initUserSchema` / `initGlobalSchema` / `userTable`                                                                         | 创建 22 张 `${prefix}_*` 表 + 索引；全局 15 张表 + 4 个 `idx_gamelog_*` 索引；二次调用幂等；`userTable(prefix, name)` 拼接                                     |
|  9  | Metadata                     | `listTables` / `getTableColumns` / `listTablesTypes`                                                                        | LIKE 模式匹配；不含 `sqlite_%` 系统表；`PRAGMA table_xinfo` 返回 7 列位置结构                                                                                  |
| 10  | Naming                       | `userTable` / `withPrefix`                                                                                                  | 拼接规则；`withPrefix` 嵌套恢复 + 抛错时 `finally` 恢复                                                                                                        |
| 11  | SQL fragments + JS utilities | `sqlToUnixMs` / `sqlExtractWorldId` / `sqlHasInstanceId` / `sqlDate` / `sqlEnterTime` / `daysAgoISO`                        | 精确字符串匹配（`(strftime('%s', col) * 1000)` / `SUBSTR(col, 1, INSTR(col, ':') - 1)` / `INSTR(col, ':') > 0` / `date(col)` 等）；`daysAgoISO` 纯 JS 返回 ISO |

### 1.3 边界用例覆盖

- 空表 / 不存在的表 / `null` 与 `undefined` 参数 / 重复主键三路径 / 空数组 / 事务嵌套 / 幂等 DDL / 无匹配更新删除 / `withPrefix` 异常恢复

### 1.4 未覆盖（已知 gap，非阻塞）

- `handleSQLiteError`（私有，4 类 DB 错误 modal 路由）
- `_buildConnectionString`（私有，Windows/Linux/UNC 路径解析）
- `insert({})` 空对象 / `bulkInsert` 行间 key 不一致 / callback 抛错传播 / ALTER 错误路径 — 这些是错误路径，可选后续补强

---

## 2. Task 10.2 — EngineAdapter 接口契约测试

### 2.1 双路径设计（应对 vitest.config.js 约束）

`vitest.config.js` 的 `include: ['src/**/*.{test,spec}.js']` 仅扫描 `src/` 目录，不扫描 `test/`。为同时满足 issue #3 明确指定的路径 `test/contract/adapter-contract.js` 与 vitest 入口需求，采用双路径策略：

| 文件                                                              | 角色                    | 说明                                                                                                                             |
| :---------------------------------------------------------------- | :---------------------- | :------------------------------------------------------------------------------------------------------------------------------- |
| `test/contract/adapter-contract.js`                               | **纯库文件**            | `export function runAdapterContractTests(adapterFactory, name)`；**无顶层 `describe`/`test`/`it`**；可被任何引擎实现 import 复用 |
| `src/services/database/adapter/__tests__/adapterContract.test.js` | **vitest 入口 wrapper** | import 契约工厂 + 用 `MemorySQLiteAdapter` 作为参考实现跑一遍                                                                    |

### 2.2 契约点（6 个 describe 块）

|  #  | 契约 describe         | 测试数 | 覆盖语义                                                                                                                              |
| :-: | :-------------------- | :----: | :------------------------------------------------------------------------------------------------------------------------------------ |
|  1  | raw execution         |   3    | `execute` callback 收 positional array；`executeNonQuery` 返回 rows-affected for DML / 0 for DDL；命名参数带 `@` 与不带 `@` 都能 bind |
|  2  | transaction semantics |   3    | begin → insert → rollback 不持久化；begin → insert → commit 持久化；begin → error → rollback 不持久化 partial DDL                     |
|  3  | CRUD round-trip       |   5    | insert→selectOne 往返；`'ignore'` 重复 PK 返回 0；`upsertPartial` 首次 insert / 第二次 update；update/delete 多条件 where             |
|  4  | DDL → Metadata 闭环   |   4    | createTable→listTables、getTableColumns、listTablesTypes、dropTable→listTables                                                        |
|  5  | count consistency     |   2    | `count(where) == select(where).length`；`countWhere == count` 等价                                                                    |
|  6  | abstract enforcement  |   2    | `new EngineAdapter()` 抛 TypeError；subclass 缺方法抛 `/abstract/` 错误                                                               |

### 2.3 复用约定

未来实现 `MySQLAdapter` / `PgSQLAdapter` 时，只需在自己的 `*.test.js` 中：

```js
import { describe } from 'vitest';
import { runAdapterContractTests } from '../../../../../test/contract/adapter-contract.js';

describe('EngineAdapter contract — MySQLAdapter', () => {
    runAdapterContractTests(() => new MySQLAdapter(...), 'MySQLAdapter');
});
```

即可复用全部 19 个契约用例。

### 2.4 契约 vs 方言的边界

- **契约测试**：断言跨引擎不变语义（返回值、行数、事务回滚），不断言 `INSERT OR IGNORE` 等方言字面
- **方言测试**：由 Task 10.1 `SQLiteAdapter.test.js` 负责，断言 SQLite 特有语法字面

---

## 3. Task 10.6 — 事务保护测试

**文件**：`src/services/database/migrations/__tests__/migrationTransactionProtection.test.js`

### 3.1 vi.mock 模式（复用 `migrationEquivalence.test.js` 范式）

```js
vi.mock('../../adapter/index.js', () => ({
    get adapter() {
        return memAdapter;
    },
    createAdapter: () => memAdapter
}));
vi.mock('../../../config.js', () => ({
    default: {
        setInt: vi.fn(async (k, v) => configStore.set(k, String(v))),
        getInt: vi.fn(async (k, d) =>
            configStore.has(k) ? Number(configStore.get(k)) : d
        )
    }
}));
```

### 3.2 describe 块与用例

|  #  | describe 块                            | test 数 | 覆盖场景                                                                                                                                                                                                                                                             |
| :-: | :------------------------------------- | :-----: | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|  1  | explicit transaction semantics         |    4    | begin→commit 持久化；begin→rollback 不持久化；`rollback()` 无事务抛 `/no transaction/i`；`commit()` 无事务抛 `/no transaction/i`                                                                                                                                     |
|  2  | 单步迁移失败 → 之前步骤回滚            |    1    | 失败注入：`sql.includes('ALTER TABLE') && sql.includes('gamelog_location')` 时抛 `INJECTED_FAILURE`；验证 v16 schema 第 3 步失败时第 1-2 步的 `%_feed_gps` `group_name` 列也回滚；`configStore.get('VRCX_databaseVersion')` 仍为初始值（checkpoint 未持久化）        |
|  3  | runMigrations 中途抛错后数据库状态不变 |    4    | 失败后 DB 留在 pre-migration version；未留 half-applied schema；移除失败注入后 retry 到达 v16；**rollback 本身失败时不掩盖原始迁移错误**（patch rollback 抛 `ROLLBACK_BOOM`，断言 surfaced error 是 `迁移 v16.*INJECTED_FAILURE` 且 `not.toMatch(/ROLLBACK_BOOM/)`） |

### 3.3 失败注入策略

**用 SQL 字符串匹配，不用 callCount 计数**（更稳健）：

```js
const originalExecuteNonQuery = memAdapter.executeNonQuery.bind(memAdapter);
memAdapter.executeNonQuery = async (sql, args) => {
    if (
        typeof sql === 'string' &&
        sql.includes('ALTER TABLE') &&
        sql.includes('gamelog_location')
    ) {
        throw new Error('INJECTED_FAILURE');
    }
    return originalExecuteNonQuery(sql, args);
};
```

---

## 4. Task 10.8 — Vue 组件测试修复

修复 3 个 pre-existing 测试失败，使其与生产代码当前行为对齐：

| 文件                                                                                    | 改动                                                                                                                                                                                         | 根因                                                                                                                                          |
| :-------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/stores/__tests__/authLoginFailureToast.test.js` (+50 行)                           | 添加 4 个 `vi.mock`（manualRelations / trackedNonFriends / accountHub / accountSession）+ `NodeModule._load` 拦截 `require('...accountHub...')`                                              | `auth.js` 新依赖了这些 store；`auth.js:102` 用 CommonJS `require()` 加载 accountHub，`vi.mock` 无法拦截 `require()`，故用 `Module._load` 补丁 |
| `src/views/Favorites/components/__tests__/FavoritesWorldItem.test.js` (+21 行)          | 移除 `WorldActionMenuItems` stub，改为 `vi.mock('../../../../components/dialogs/NewInstanceDialog/NewInstanceDialog.vue', ...)` 用 watch 触发 `mocks.createNewInstance`                      | 原 stub 的 `WorldActionMenuItems` 已被组件重构；新实例创建逻辑改由 `NewInstanceDialog` 承担                                                   |
| `src/views/FriendsLocations/components/__tests__/FriendsLocationsCard.test.js` (+11 行) | `User` icon 改为带 class 的 span；`context-menu-separator` 断言从 `.exists()===false` 改为 `findAll().length===1`；`--join`→`--joinme`；`{active:true}`→`{'active-busy':true, active:false}` | 对齐生产代码：`FriendsLocationsCard.vue:109` 用 `--joinme`；line 102 优先匹配 `active-busy`；常驻 separator 由 Reka UI ContextMenu 渲染       |

**已知预存问题（非本期范围）**：`auth.js:102` 的 CommonJS `require()` 是代码异味，建议后续重构为 `await import()` 后移除 `Module._load` hack。

---

## 5. Task 10.9 — vitest.setup.js adapter helper

**文件**：`vitest.setup.js`（+12 行）

### 5.1 设计决策

**不全局 `vi.mock('@/services/database/adapter/index.js')`** —— 全局 mock 会污染 200+ 现有测试。改为**懒加载 helper 函数**：

```js
globalThis.createTestAdapter = async function createTestAdapter() {
    const { DatabaseSync } = await import('node:sqlite');
    const { MemorySQLiteAdapter } =
        await import('./src/services/database/migrations/__tests__/memoryAdapter.js');
    const db = new DatabaseSync(':memory:');
    const adapter = new MemorySQLiteAdapter(db);
    return { adapter, db };
};
```

### 5.2 懒加载的理由

初版用静态 `import { DatabaseSync }` + `import { MemorySQLiteAdapter }`，导致所有 202 个 fork worker 都加载 `node:sqlite` 原生绑定 + 1715 行类定义（即使 199 个不用）。Stage 5 performance-reviewer 标为 HIGH。改为懒加载后：

- **不用的 worker 零成本**：不触发 `node:sqlite` 加载
- **用到的 worker 首次调用时加载**：后续调用复用 Node 模块缓存
- **`async` 签名**：调用方需 `const { adapter, db } = await createTestAdapter()`

### 5.3 现有 stubs 全保留

`vitest.setup.js` 原有 stubs（AppApi / WebApi / VRCXStorage / SQLite / LogWatcher / Discord / AssetBundleManager / ResizeObserver / speechSynthesis / matchMedia / localStorage / Notification / worker-timers / i18n / sendInviteColumns）全部保留。新增 `createTestAdapter` 是新增 global，不覆盖任何现有。

### 5.4 当前使用情况

3 个新测试文件（Track A / B / C）都选择**直接 import `MemorySQLiteAdapter`** 而非用 helper（更明确）。`createTestAdapter` 供未来 Phase 10.10/10.11/10.12 业务场景测试选用。

---

## 6. 运行与验证

### 6.1 单独运行每个 Track

```bash
# Track A
npx vitest run src/services/database/adapter/__tests__/SQLiteAdapter.test.js --reporter=verbose

# Track B（vitest 入口在 wrapper，库文件不会被当作入口）
npx vitest run src/services/database/adapter/__tests__/adapterContract.test.js --reporter=verbose

# Track C
npx vitest run src/services/database/migrations/__tests__/migrationTransactionProtection.test.js --reporter=verbose

# Track D（3 个 10.8 修复）
npx vitest run src/stores/__tests__/authLoginFailureToast.test.js
npx vitest run src/views/Favorites/components/__tests__/FavoritesWorldItem.test.js
npx vitest run src/views/FriendsLocations/components/__tests__/FriendsLocationsCard.test.js
```

### 6.2 全套验证

```bash
npm run lint          # oxlint + eslint（预存 36 errors 在无关文件，新/改文件零报错）
npm run typecheck:js  # CheckJS
npm run format:check  # oxfmt
npm test              # 全套：202 文件 / 2320 测试
```

### 6.3 关键约定

- **`vi.mock` hoisting**：必须写在所有 `import` 之前（vitest 自动 hoist）
- **`:memory:` db 生命周期**：每个 `beforeEach` 重建，每个 `afterEach` close + 解除引用
- **forks 池隔离**：vitest 默认每个测试文件独立子进程，`vi.mock` 不跨文件泄漏
- **`node:sqlite` experimental**：Node 24+ 仍发 `ExperimentalWarning`，仅 stderr 噪声，不影响测试

---

## 7. 与 Issue #3 其他 Phase 10 task 的关系

| Task  | 状态                  | 说明                                        |
| :---- | :-------------------- | :------------------------------------------ |
| 10.1  | ✅ 完成               | 本期 Track A                                |
| 10.2  | ✅ 完成               | 本期 Track B                                |
| 10.3  | ⏸ 跳过                | 依赖 Phase 8/9 未实现的 MySQL/PgSQL adapter |
| 10.4  | ✅ 已完成（前序会话） | `.map` 解析器、拓扑排序、通配符展开         |
| 10.5  | ✅ 已完成（前序会话） | 幂等性测试在 `migrationEquivalence.test.js` |
| 10.6  | ✅ 完成               | 本期 Track C                                |
| 10.7  | ⏸ 跳过                | 依赖 Phase 8/9                              |
| 10.8  | ✅ 完成               | 本期 Track D                                |
| 10.9  | ✅ 完成               | 本期 Track E                                |
| 10.10 | ⏸ 后续                | 业务场景集成测试，依赖真实环境              |
| 10.11 | ⏸ 后续                | 多账号场景测试                              |
| 10.12 | ⏸ 后续                | 错误场景测试                                |

---

## 8. 已知预存问题（非本期引入，建议后续处理）

| 问题                                              | 位置                                                | 严重度 | 建议                                                                                                                              |
| :------------------------------------------------ | :-------------------------------------------------- | :----: | :-------------------------------------------------------------------------------------------------------------------------------- |
| `auth.js` 用 CommonJS `require()` 加载 accountHub | `src/stores/auth.js:102`                            | MEDIUM | 重构为 `await import()` 后可移除测试中的 `Module._load` hack                                                                      |
| `recordCheckpoint` 在 `commit` 前                 | `src/services/database/migrations/index.js:393-394` | MEDIUM | 若 commit 失败，checkpoint 已持久化但 schema 被回滚，重试会跳过该版本。建议把 `recordCheckpoint` 移到 `commit` 之后，并补测试验证 |
| `deleteAll()` 在 MemorySQLiteAdapter 返回 0       | `memoryAdapter.js`                                  |  LOW   | 生产 `SQLite.ExecuteNonQuery` 会返回 rows-affected；MemorySQLiteAdapter 走 `db.exec()` 不返回 changes。测试已加注释说明           |
| `node:sqlite` experimental warning                | Node 24+                                            |  LOW   | 可在 setup 顶部 `process.emitWarning = () => {}` 屏蔽，或用 `NODE_NO_WARNINGS=1`                                                  |

---

## 9. 相关文档

- `docs/DATABASE_SCHEMA.md` — 数据库概念模型与关系架构
- `docs/CONFIG_REFACTOR.md` — `VRCX_Database.*` 配置重构设计
- `docs/DATA_REFRESH.md` — 四层数据刷新架构
- Issue #3 `Phase 10：测试体系完善` — 完整 tasklist
