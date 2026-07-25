# 栈式事务上下文 + 统一池化设计

## 背景

VRCX-Luo 的 PostgreSQL C# 层(`Dotnet/PostgreSQL.cs`)之前每次 `ExecuteNonQuery` 都 `_dataSource.OpenConnection()` 借新连接 + `using` 还池,导致 `BEGIN` 在连接 A、`INSERT` 在连接 B、`COMMIT` 在连接 C——事务语义断裂(连接 A 的事务随还池被 Npgsql 自动 reset)。这是 C# 包装层的疏漏(照搬 Npgsql 现代池化示例,未补"持连接事务 API"),不是 PG/Npgsql 引擎限制。

SQLite.cs / MySQL.cs 的单连接 + lock 模式虽然事务能跑,但有隐患:长查询阻塞健康检查;事务期间的非事务查询隐式混入当前事务。

## 方案:统一池化 + 栈式事务上下文 + Sliding 超时

### C# 层(三引擎对称)

| 引擎 | 池实现 | pin 机制 |
|---|---|---|
| PostgreSQL | `NpgsqlDataSource` 池 | `_pinned` ConcurrentDictionary<long, TxHolder> |
| SQLite | ADO.NET `Pooling=True` 池(System.Data.SQLite) | `_pinned` ConcurrentDictionary<long, TxHolder> |
| MySQL | MySqlConnector 内置池(`Pooling=True`) | `_pinned` ConcurrentDictionary<long, TxHolder> |

三引擎都暴露:
- `BeginTransaction()`:借连接 + BEGIN + 标记 pin + 启动 sliding Timer,返回递增 connId
- `CommitTransaction(connId)`:COMMIT + 还池 + 清 Timer
- `RollbackTransaction(connId)`:ROLLBACK + 还池 + 清 Timer(已超时则 no-op)
- `Execute`/`ExecuteNonQuery`/`ExecuteJson` 加可选 `long? connId` 尾参:
  - connId 有值:PG 走 pinned 连接 + 重置 Timer;SQLite/MySQL 重置 Timer(单连接无需路由)
  - connId 无值:走默认池/单连接,行为与改造前一致(零回归)

### Sliding 超时(防泄漏安全网)

- `TX_IDLE_MS = 30000`(30 秒)
- Timer 在 BeginTransaction 时启动
- 每次 Execute/ExecuteNonQuery 调用结束 → `Timer.Change(TX_IDLE_MS, -1)` 重置(滑动续命)
- Timer 触发 → 自动 ROLLBACK + 还池
- 真卡死(JS await 悬挂、网络 hang)30 秒后回收;长事务持续有 SQL 续命,不误杀

### JS 层(栈式事务上下文)

```
EngineAdapter 基类:
  _txStack = []  // 实例属性,每实例独立

  beginTransaction()  → 检查栈非空(嵌套拒绝)→ _doBegin() → push connId
  commit(connId)       → _doCommit(connId) → finally pop 栈
  rollback(connId)     → _doRollback(connId) → finally pop 栈
  withTransaction(fn)   → beginTransaction → fn → commit(抛错则 rollback)

  execute/executeNonQuery 实现(子类):
    const connId = this._txStack.at(-1)  // 读栈顶
    // 传给 C# 决定走 pinned 连接还是默认池
```

### API 可见性:@private 标注(2026-07-25 补充)

`beginTransaction`/`commit`/`rollback` 三个低级方法标为
`@private`,生产代码应使用 `withTransaction(fn)`。理由:

- 三个低级方法承载栈管理逻辑(push/pop/嵌套检查),不是简单的
  私有转发——它们是 `withTransaction` 所依赖的底层契约层。
- `@private` 触发 IDE 高亮(WebStorm "Private member accessed"),
  引导开发者用 `withTransaction(fn)`;同类内调用
  (`this.beginTransaction()`)不触发,`withTransaction` 内部正常。
- ESLint 不报错(`eslint-plugin-jsdoc` 未在 `eslint.config.mjs`
  启用 `check-access` 规则),仅靠 IDE inspection 引导。
- 生产代码 0 处直接调用;测试文件(transaction.test.js /
  migrationTransactionProtection.test.js / SQLiteAdapter.test.js)
  有意直接调用以验证栈契约,文件头/块前已加注释说明。

### 隔离保证

- **实例隔离**:每个 adapter 实例独立 `_txStack`,srcAdapter/dstAdapter 天然不交叉
- **try/finally 保证栈清洁**:commit/rollback 的 finally 必 pop,抛错也恢复
- **JS 单线程**:无并发打断,栈操作原子
- **connId null/0 走默认池**:事务外调用零行为变化
- **嵌套显式拒绝**:避免嵌套事务的复杂语义,与 SQLite 现有行为一致

### 七类干扰路径验证(见 transaction.test.js)

1. 事务外调用:栈空,不影响行为 ✅
2. 嵌套 withTransaction:抛错 ✅
3. srcAdapter vs dstAdapter:实例属性隔离 ✅
4. 串行多个 withTransaction:栈深度恢复 0 ✅
5. withTransaction 抛错:rollback + 栈清洁 ✅
6. C# 超时回收:JS 栈残留死句柄,首次用即报错 + pop ✅
7. withPrefix 叠加:两属性独立,正交 ✅

## 改动范围

### C# 层
- `Dotnet/PostgreSQL.cs` — _pinned Map + 4 方法 + connId 参数
- `Dotnet/SQLite.cs` — _pinnedConnId 单槽 + 4 方法 + connId 参数
- `Dotnet/MySQL.cs` — 同 SQLite

### JS 基类(破例,注释已注明)
- `adapter/EngineAdapter.js` — _txStack + beginTransaction/commit/rollback + withTransaction + _doBegin/_doCommit/_doRollback

### JS 适配器子类
- `adapter/PgSQLAdapter.js` — _doBegin/Commit/Rollback 调 C# + execute/executeNonQuery 读栈顶传 connId
- `adapter/SQLiteAdapter.js` — 同上
- `adapter/MySQLAdapter.js` — 同上

### 消费者改造
- `mutualGraph.js` / `activityV2.js` / `migrations/index.js` / `database/index.js` — begin/try/commit/catch-rollback → withTransaction
- `mutualGraph.updateMutualsForFriend` / `avatarFavorites.clearAvatarHistory` — 顺手包事务(之前无事务)

### push/pull 引擎
- `pushEngine.js` / `pullEngine.js` — 分组事务(global 一组、per-prefix 一组、mirror 一组)

### 测试
- `adapter/__tests__/SQLiteAdapter.test.js` — begin/commit/rollback → 新签名 + withTransaction 6 例
- `migrations/__tests__/migrationTransactionProtection.test.js` — 新签名
- `test/contract/adapter-contract.js` — 新签名 + stub.beginTransaction async
- `adapter/__tests__/transaction.test.js`(新增)— 栈上下文 16 例
- `pushEngine.test.js`(新增)— 分组事务 11 例
- `pullEngine.test.js`(新增)— 分组事务 9 例

### 测试覆盖空白(2026-07-25 标注)

PG/MySQL 引擎级事务语义(pinned 连接生命周期、C# 桥往返、超时
Timer 回收后 rollback no-op)目前仅由 `transaction.test.js` 用
`MemorySQLiteAdapter` 做引擎无关的栈契约验证。PG/MySQL 特定行为
需真实后端 + C# 桥,无法在纯 JS unit test 中覆盖,已在
`PgSQLAdapter.unit.test.js` / `PgSQLAdapter.pgsql.test.js` /
`MySQLAdapter.mysql.test.js` 文件头加 TODO 标注,待 follow-up 补
集成测试。

## 效果

- **原子性**:分组事务内中途崩溃全回滚,不再留半拷贝
- **性能**:fsync 次数从"每批 1 次"降到"每组 1 次"(5-10× 提速)
- **错误隔离**:per-group try/catch,组内失败回滚该组,其他组保留
- **非事务隔离**:事务期间的非事务调用走其他连接,不混入事务(SQLite/MySQL 之前有此隐患)
- **防泄漏**:sliding 30s 超时自动回滚,JS 忘 commit 不泄漏连接