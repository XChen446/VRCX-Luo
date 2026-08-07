---
name: vrcx-Knowledge
description: Use when answering questions about VRCX-K's architecture, database schema (SQLite/MySQL/PostgreSQL adapters), transaction model, design decisions, or feature history, or when making changes that touch the database layer or config layer. Loads the knowledge base index and retrieval rules; the corpus lives in this directory's architecture/ and features/ subdirectories. Do NOT use for runtime error troubleshooting, UI layout questions, or code-level questions that the repository itself answers directly.
---

# VRCX-K Knowledge Base

本 skill 挂载了 VRCX-K 的文档知识库（`docs/`）。这是一个**薄壳索引**——先定位分片、按需读取，绝不整库注入或递归读取整个目录。

## 入口导航

- `README.md`（本目录）—— 按读者分组的完整导航
- `architecture/` —— 设计与架构文档（现状文档 + 设计稿，可信度见下）
- `features/` —— 功能特性清单
- `architecture/models/` —— 数据库模型链（MCD/SR/ERD/DDL）

## 索引（主题 → 分片 → 何时读）

| 主题 | 分片 | 何时读 |
|---|---|---|
| 数据刷新链路（Feed 采集/持久化/UI） | `architecture/DATA_REFRESH.md` | "Feed 怎么来的"、四层刷新、数据补全 |
| 三引擎统一契约（方法签名/方言/事件） | `architecture/ADAPTER_API.md` | adapter 方法用法、事务、onTableChange 订阅 |
| 事务模型（withTransaction/keepAlive/60s 超时） | `architecture/TRANSACTION_DESIGN.md` | 事务内长交互、事务栈语义 |
| 配置（VRCXStorage/旧键迁移/安全加固） | `architecture/CONFIG_REFACTOR.md` | VRCX_Database.* 键、bootstrap、_ 前缀约定 |
| 数据库表结构（全部表名/字段/主外键） | `architecture/models/vrcx_mcd_mld.md` / `vrcx_sr_mld.md` | "某表有哪些列"、表关系 |
| 多账号设计 | `architecture/MULTI_ACCOUNT_V4_DETAIL_DESIGN.md` | AccountHub/AccountSession 设计 |
| 新引擎开发模式 | `architecture/PGSQL_DESIGN.md` | 新增数据库引擎的接口/方言/测试参考 |
| 功能清单（Luo 分支 / jirai 继承） | `features/LUO_FEATURES.md` / `features/JIRAI_FEATURES.md` | "某功能是否存在、何时加入" |
| ER 图/DDL 多格式 | `architecture/models/vrcx_erd.*`、`vrcx_mcd_ddl.sql` 等 | 图表/DDL 形态需要 |

## 快速路由（典型问题 → 检索路径）

| 问题类型 | 检索路径 |
|---|---|
| "表 X 有哪些列 / 与表 Y 什么关系" | `vrcx_sr_mld.md` → Grep 表名 → Read 局部 |
| "这个 adapter 方法怎么用 / 支持哪些引擎" | `ADAPTER_API.md` → Grep 方法名 → Read 该节 |
| "某个功能是不是存在 / 什么时候加的" | `features/` 两篇 → Grep 关键词 |
| "事务里能不能 await 用户交互" | `TRANSACTION_DESIGN.md` → keepAlive 节 |
| "新增一张表要动哪些地方" | `CONFIG_REFACTOR.md`（迁移）+ `ADAPTER_API.md`（方法）+ 模型链（更新协议） |

## 检索规则

1. 先读 `README.md` 或本索引，定位主题分片；只读匹配分片，分片大时 Grep 定位小节再 Read（offset/limit）
2. **大小写坑**：模型文件用大写概念名（`MUTUAL_GRAPH_META`），代码/物理表用小写（`mutual_graph_meta`）。搜不到时切换大小写重试
3. 找不到答案时回退到仓库代码（`src/services/database/`、`Dotnet/`），不要臆测
4. 品牌与分支事实：当前项目 VRCX-K（VRChatCN-Kipfel/VRCX-K，默认分支 main）；VRCX-Luo（yixijun）是仍活跃的上游分支；`upstream/SYNC` 为上游同步线

## 文档可信度（重要——先判断再引用）

| 状态标注 | 含义 | 引用方式 |
|---|---|---|
| 现状文档（DATA_REFRESH / ADAPTER_API / CONFIG_REFACTOR / TRANSACTION_DESIGN） | 与代码同步维护 | 可直接引用 |
| 设计稿 + "已实现"标注（PGSQL_DESIGN / MULTI_ACCOUNT） | 设计意图，含"实现演进/偏离"标注 | 引用时交叉验证代码，标注处如实引用 |
| 历史清单（features/ 两篇） | 功能记录，可能滞后 | 结合 git 历史 / tasklist 佐证 |

**规则**：凡回答涉及具体行为（方法签名、表结构、事务语义），以代码为准、文档为辅；文档与代码冲突时指出冲突而非只报文档。

## 更新协议

- **表结构变更**：按 UPSTREAM_SYNC_GUIDE §5.1 整链更新（`vrcx_mcd.mcd`/`vrcx_sr.mcd` 源文件 → mocodo 重生成 mld/ddl/svg/geo/crow → dbml/mmd 补表）
- **契约变更**：`ADAPTER_API.md` 与 EngineAdapter 基类保持同步（基类冻结 42 abstract + 3 optional，破例需记录）
- **代码改动发现文档漂移**：修对应分片；分片移动/改名时同步更新本索引与 AGENTS.md「Docs Knowledge Index」
- **本索引表**：分片新增/改名时同步更新

## 安装验证（可选）

挂载后自检：让 agent 回答"`mutual_graph_meta` 表有哪些列"，预期检索路径为 `vrcx_sr_mld.md` → `MUTUAL_GRAPH_META` → 输出 `friend_id / last_fetched_at / opted_out`。若无法定位，检查目录名与 frontmatter `name` 是否被环境正确识别。
