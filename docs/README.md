# VRCX-K 文档导航

文档按主题分目录存放：`architecture/`（设计与架构）、`features/`（功能特性清单）。按读者分组导读：

> **Skill 挂载**：本文档目录可整体挂载为 agent skill（知识库类型）。将本 `docs/` 目录拷贝到你所在 agent 环境的 skill 安装目录（如 Kilo 的 `.kilo/skills/`、Claude Code 的 `~/.claude/skills/`、Codex 的 `~/.codex/skills/`），目录名自定为 skill 名（如 `vrcx-Knowledge/`），`SKILL.md` 即为 skill 入口（安装时可按需调整 frontmatter 的 `name`）。挂载后 agent 先加载索引、按需读取分片，可显著减少上下文占用。

## 想理解 VRCX-K 架构（阅读者 / 维护者）

| 文档 | 内容 |
|---|---|
| [数据刷新机制说明](./architecture/DATA_REFRESH.md) | 四层数据刷新架构（L1 游戏日志 / L2 WS / L3 轮询 / L4 全量 + 数据补全），Feed 采集/持久化/UI 全链路 |
| [栈式事务上下文 + 统一池化设计](./architecture/TRANSACTION_DESIGN.md) | 三引擎事务模型（withTransaction/_txStack/keepAlive、C# 60s sliding 超时、InFlight 竞态防御） |
| [数据库配置重构说明](./architecture/CONFIG_REFACTOR.md) | VRCXStorage 设计（bootstrap、`_` 前缀、安全加固、旧键迁移） |
| [多账号 V4 详细设计（历史设计稿）](./architecture/MULTI_ACCOUNT_V4_DETAIL_DESIGN.md) | 多账号方案设计（AccountHub/AccountSession/热替换 Store/聚合视图）；已实现，与现状有偏离 |
| [数据库模型（MCD/SR/ERD）](./architecture/models/vrcx_mcd_mld.md) | 概念模型与关系模式：全部表名/字段/主外键（Mocodo 生成链，见 `models/` 目录） |

## 想为 VRCX-K 做出贡献（开发者）

| 文档 | 内容 |
|---|---|
| [EngineAdapter API 参考](./architecture/ADAPTER_API.md) | 三引擎统一契约：全部公开方法签名、方言差异、事务、事件推送（onTableChange 消费方指南） |
| [PostgreSQL 适配器设计（Phase 9）](./architecture/PGSQL_DESIGN.md) | 新引擎设计模式参考：接口清单、方言差异表、失败模式、测试计划（已实现，含偏离标注） |
| [依赖安全记录](./architecture/SECURITY_NOTES.md) | npm audit 基线、已知豁免漏洞、allowScripts 批准记录 |
| [Windows CEF 本地测试与安全重启](#) | 见主 README「从源码构建」章节（AGENTS.md 亦含要点） |

## 功能特性清单

| 文档 | 内容 |
|---|---|
| [VRCX-Luo 功能特性](./features/LUO_FEATURES.md) | VRCX-Luo 分支的功能特性清单（内容来源：上游 yixijun/VRCX-Luo README），VRCX-K 全部延续 |
| [VRCX-Jirai 改动清单（修正版）](./features/JIRAI_FEATURES.md) | Luo 整理的 jirai 继承改动代码级清单（含 UI 图与核心逻辑） |

> VRCX-K 时代变更以 git 提交历史与仓库 [tasklist](https://github.com/VRChatCN-Kipfel/VRCX-K/issues/3) 为准。
> 模型链文件（`architecture/models/`）：`vrcx_mcd.mcd` / `vrcx_sr.mcd` 为 Mocodo 源文件，`*_mld.md` 逻辑模型、`*_ddl.sql` DDL、`*.svg` 图、`*_geo.json` 布局、`*_erd_crow.*` 鸦脚 ERD、`vrcx_erd.dbml/mmd/svg` 为 dbdiagram/mermaid 形态；表结构变更时按 UPSTREAM_SYNC_GUIDE §5.1 整链更新。
