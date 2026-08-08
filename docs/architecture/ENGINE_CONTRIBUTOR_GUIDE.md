# 新引擎贡献指南（如何为 VRCX-K 添加数据库引擎支持）

> 面向**贡献者**的全流程指南：从发起提案到合并新数据库引擎的完整路径。本文回答"以什么流程、满足什么标准才能加一个新引擎"；具体编码步骤见 `ADAPTER_GUIDE.md`（适配器编写指南），接口契约见 `ADAPTER_API.md`，完整设计案例见 `PGSQL_DESIGN.md`。
>
> **现状**（2026-08）：SQLite（默认）、PostgreSQL、MySQL/MariaDB 三引擎已落地，全部业务模块（338 处 adapter 调用）零改动地运行在任意引擎之上。新引擎（如 Oracle、SQL Server、CockroachDB）遵循同样的接入路径。

---

## 1. 决策点：真的需要新引擎吗？

**先回答这些问题**（在写任何代码之前）：

| 问题 | 考量 |
|------|------|
| 用户群是否真实需要？ | VRCX 是单机桌面应用，SQLite 默认零配置。远程引擎的价值：多人共享数据、服务器部署、大库性能 |
| 能否复用现有引擎？ | MySQL 覆盖 MariaDB；PG 兼容生态（CockroachDB 等 wire 兼容）可先评估"冒充"现有引擎的可行性 |
| 维护成本是否可承担？ | 每个引擎是**永久性的横向面**：DDL 翻译、SQL 片段、契约测试、CI matrix、上游表变更同步（tasklist 12.4）都要持续跟进 |

**结论建议**：除非有明确的用户场景与维护承诺，否则不要引入新引擎。这不是技术问题，是维护承诺问题。

---

## 2. 贡献流程全景

```
阶段 A 立项     → Issue/tasklist 提案 + 设计约束拍板(D1-D5 等价物)
阶段 B 设计     → Design Document(PGSQL_DESIGN.md 模板) + review 门槛
阶段 C 实现     → 按 ADAPTER_GUIDE.md 步骤 0-9,切片式原子提交
阶段 D 测试     → 契约测试 + 方言单测 + 集成测试 + CI matrix
阶段 E 文档     → ADAPTER_API.md / 设计文档 / 导航更新
阶段 F 验收     → 整体验收门槛(§4) + PR review + 合并
```

### 阶段 A：立项

1. 在仓库 [tasklist（Issue #3）](https://github.com/VRChatCN-Kipfel/VRCX-K/issues/3) 以 Phase 编号登记子任务（先经执行者确认）。
2. **拍板设计约束**——Phase 9 的 D1-D5 是模板（业务零改动 / 迁移跳过语义 / 配置驱动连接 / 元数据限定名 / 不建聚合视图）。每条约束对应一个可验证的验收项，**一旦拍板不可违背**。

### 阶段 B：设计文档（强制门槛）

按 `PGSQL_DESIGN.md`（1242 行，Phase 9）的结构产出：

```
0 摘要          1 范围界定(In/Out of Scope)   2 架构总览
3 文件级改动清单(行号锚点)                   4 接口设计(逐方法方言差异)
5 数据模型与类型映射                         6 迁移路径
7 测试策略(单测/集成/CI)                     8 不变量与契约(INV-xx)
9 失败模式与风险(R-xx 表)                    10 实现切片划分(依赖图 + DoD)
11 验收标准(逐 task 可检验 + 整体门槛)        12 Resume-Critical 事实(供上下文恢复)
```

要点：
- 接口冻结政策：新抽象方法需破例流程（理由 → review → 基类 + 全部子类同步实现）。**引擎特有扩展不入基类**（调用方 `typeof x === 'function'` 能力检测）。
- 待核实事项**必须在设计期基于实际代码核实**（Phase 9 的 8 项核实结论是模板：insert replace 调用点、getTableColumns 生产调用方、sqlEnterTime 格式假设等）。

### 阶段 C：实现

按 `ADAPTER_GUIDE.md` 步骤 0-9 执行，**切片式原子提交**（参考 PGSQL_DESIGN §10 的 S1-S12 依赖图）：

```
S1  C# 封装 + 4 处桥注册      →  S2 适配器骨架 + 参数绑定 + 方言  →  S3 命名/schema 隔离
S4  initSchema DDL            →  S5 元数据方法                    →  S6 特有清理能力
S7  existing 模块透明验证     →  S8 迁移运行器兼容                →  S9 搬迁管道 + UI
S10 健康检查                  →  S11 本地容器                    →  S12 CI matrix
```

**铁律**：
- 业务模块（`src/services/database/*`）**零改动**（D1）
- 每个切片：代码 + 验证证据 + 残留风险标注
- 提交信息遵循仓库 Conventional Commits 规范（`git commit -sS`）

### 阶段 D：测试

| 门槛 | 内容 |
|------|------|
| 契约测试 | `runAdapterContractTests(adapterFactory, name)` 三引擎共用行为全绿 |
| 方言单测 | 参数绑定边界（`@user_id` 不撞 `@user`）/ 类型映射 / 5 个 SQL fragments / userTable 输出 |
| 集成测试 | 真实容器：initSchema 建表数、CRUD 语义、listTables 限定名、跨引擎搬迁行数一致 + 抽样 |
| 业务回归 | 现有 SQLite 测试 + 全部业务模块测试在 stub 下全绿（新引擎 stub 不得影响 sqlite 模式） |
| CI matrix | 参考现有：PG 16/17（`action-setup-postgres@v8`）+ MySQL 8.0/8.4（`actions-setup-mysql@v1`）；`describe.skipIf(!process.env.XXX_TEST_HOST)` 跳过无容器环境 |

### 阶段 E：文档

1. `ADAPTER_API.md`：方法签名方言列 + 引擎支持矩阵（§9.7）+ 维护表加行
2. `docs/README.md` 导航登记
3. 设计文档并入 `docs/architecture/`（标注实现偏离点）
4. `docs/architecture/models/*`：表结构变更时按 `UPSTREAM_SYNC_GUIDE` §5.1 整链更新（MCD/SR/ERD）

### 阶段 F：验收

**整体验收门槛**（Phase 9 §11.2 模板）：
1. 业务模块零改动（git diff 确认）
2. 新引擎启动：sqlite 锁 .map 正确 skip + checkpoint 记录，无报错
3. 配置驱动连接：字段级校验拒注入；默认值合理
4. 元数据返回限定名，可直用于 SQL
5. 多账号查询透明（withPrefix 串行）
6. 接口冻结未被破坏（或破例已按流程批准）
7. 回归全绿（现有引擎不受影响）
8. CI matrix 全绿

---

## 3. 代码规范速查

| 项 | 规范 |
|----|------|
| 文件位置 | `src/services/database/adapter/XxxAdapter.js`（继承 `EngineAdapter`） |
| C# 封装 | `Dotnet/Xxx.cs`（Init/ExecuteJson/ExecuteNonQuery/事务/健康/变更门控） |
| 注册 | `adapter/index.js` `_engineSpec` 一条（**惰性加载 + 字面量路径**，见 ADAPTER_GUIDE §9） |
| 参数绑定 | `@key` 命名参数在适配器内部转方言（PG `$N` / MySQL `?`） |
| 错误处理 | 桥异常原样上抛；错误码细化（如 PG 23505）可选不做 |
| JSDoc | 新方法带 `@abstract`/`@optional`/`@engine-specific` 标记（基类冻结计数同步更新） |
| 测试 stub | `vitest.setup.js` 加 `globalThis.Xxx = new Proxy({}, { get: () => noopAsync })` |
| 迁移 .map | 引擎特有 SQL 必须加 `database.before/after` 锁（否则其他引擎会执行） |

---

## 4. 检查清单（合并前逐项确认）

- [ ] 设计文档已产出并经 review（含 In/Out of Scope、风险表、切片划分）
- [ ] 设计约束已拍板（D1-D5 等价物），未在实现期悄悄放宽
- [ ] 业务模块 338 处调用零改动
- [ ] 4 处桥注册（CefSharp / Electron / Program.cs / vitest stub）
- [ ] 接口冻结未被破坏；特有扩展走能力检测
- [ ] 契约测试 + 方言单测 + 集成测试 + CI matrix 全绿
- [ ] 迁移运行器兼容（skip 语义 + checkpoint）
- [ ] 搬迁管道（push/pull）行数校验通过
- [ ] 文档更新（ADAPTER_API.md / 导航 / 设计文档 / 模型链）
- [ ] tasklist 子任务登记并勾选（经执行者授权）
- [ ] 上游表变更同步机制已建立（tasklist 12.4 等价物）
