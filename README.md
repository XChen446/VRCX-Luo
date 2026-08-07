<div align="center">

# <img src="./images/VRCX.png" width="64" height="64"> VRCX-K

[![GitHub Workflow Status](https://github.com/VRChatCN-Kipfel/VRCX-K/actions/workflows/github_actions.yml/badge.svg)](https://github.com/VRChatCN-Kipfel/VRCX-K/actions/workflows/github_actions.yml)

</div>

VRCX-K 是 [VRCX-Luo](https://github.com/yixijun/VRCX-Luo) 的延续，代码继承自 [FuLuTang/VRCX-jirai](https://github.com/FuLuTang/VRCX-jirai)，终极上游是 [vrcx-team/VRCX](https://github.com/vrcx-team/VRCX)。更名不改变数据兼容：用户数据路径、`vrcx://` 协议、配置项与 VRCX-Luo 完全一致，旧版本用户可直接升级。

> *关于 `K` 这个后缀的来源嘛……*
> > *本分支的创建者，一开始希望这个分支像 `"Kernel"` 一样，犹如内核般的模块化且棱角分明，让开发者有更舒适的开发体验，更愿意为这个项目做出贡献*
>
> > *后来又希望它像 `"Knife"` ，犹如外科手术刀般精准且高效，更快捷的完成(例如社团管理者们的)取证和处理等工作*
>
> > *到最后…分支发起者本人也对这个缩写解释模糊不清，于是干脆就认为是 `"Kipfel"` 了……毕竟谁能拒绝一只可可爱爱的 牛角面包(×) kip猫猫(√) 呢对吧~？*

本分支重点放在三件事上：

- 使 VRCX 原生支持多数据库引擎，规范化数据库各类操作，为开发者提供友好体验。
- 补全原版 VRCX 在启动、通知、托盘、工具页和本地测试上的体验缺口。
- 复用 VRCX 原有数据库、接口和 UI 结构，新增功能以本地展示、白名单操作、可关闭设置和可切换的数据库引擎为主。

> 本项目不是 VRChat 官方项目，也不代表 VRChat 或 VRCX 官方观点。

> 使用提醒：功能仅供个人记录整理和娱乐分析，请勿用于骚扰、攻击、泄露隐私或其他违反 VRChat 规则的用途。适度使用工具，注意自我保护，也尊重他人的隐私选择。

> ⚠️ **已知问题**：VRCX-K 虽已内置原生多数据库引擎支持（SQLite / MySQL / MariaDB / PostgreSQL），但**请勿同时启动多个 VRCX 实例并连接同一个数据库**——会导致数据被产生多份（重复记录）。作者已知悉并正在跟踪（[issue #20](https://github.com/VRChatCN-Kipfel/VRCX-K/issues/20)）；在收到额外更新通知前，建议单实例使用，目前多引擎能力仅适用于数据同步场景。若你参与内测或在自行测试中有新发现，欢迎到该 issue 补充信息。

## 下载与安装

| 平台 | 说明 |
| :--- | :--- |
| Windows | [下载最新 Releases](https://github.com/VRChatCN-Kipfel/VRCX-K/releases/latest) 中的安装包 |
| Linux | [下载最新 Releases](https://github.com/VRChatCN-Kipfel/VRCX-K/releases/latest) 中的 AppImage，直接执行即可 |
| macOS | 未测试；需要自行从源码构建，参考 [从源码构建](#从源码构建) |
如果您有兴趣贡献在macOS上的技术需求，欢迎您提 [issue](https://github.com/VRChatCN-Kipfel/VRCX-K/issues/new/choose) 与 [PR](https://github.com/VRChatCN-Kipfel/VRCX-K/compare) ！

如果更新后侧边栏没有出现新入口，可以在侧边栏右键，进入 `自定义导航栏`，执行 `恢复默认`。

## 与原版/上游的关系

本仓库的改动是在 `VRCX-Luo` 与 `VRCX-jirai` 的基础上继续整理和补全。可以简单理解为：

- `vrcx-team/VRCX`：原版 VRCX，提供登录、好友、通知、日志、数据库和大多数基础页面。
- `FuLuTang/VRCX-jirai`：上游分支，加入了更多社交分析、关系图、数据补全和本地展示能力。
- `yixijun/VRCX-Luo`：直接前身，贡献了启动体验、通知体验、托盘行为、内存清理、本地构建、界面一致性等改进。
- `VRChatCN-Kipfel/VRCX-K`：延续 VRCX-Luo 的全部功能，并新增多数据库引擎（SQLite / MySQL / PostgreSQL）支持、数据搬迁与声明式迁移体系。

> **从 VRCX-Luo 升级**：无需迁移数据。安装包复用原有用户数据路径（Windows `%APPDATA%\VRCX` / Linux `~/.config/VRCX`），`vrcx://` 协议与全部配置项保持兼容；首次升级建议在设置页确认版本号已切换为 VRCX-K。

README 中重点写 VRCX-K 当前版本可见、可用、需要用户知道的功能；VRCX-Luo 时代的功能特性清单见 [VRCX-Luo 功能特性](./docs/features/LUO_FEATURES.md)，更上游的代码级改动可以看 [VRCX-Jirai 改动清单](./docs/features/JIRAI_FEATURES.md)；VRCX-K 时代变更以 git 提交历史与仓库 [tasklist](https://github.com/VRChatCN-Kipfel/VRCX-K/issues/3) 为准。

## 功能亮点

### 社交分析

- **双人关系查询**：任意两名用户，一键回溯共同实例记录——共处时间、房间、人数变化一目了然。独家进入先后判定：3 分钟内先后进入同一房间会被自动标记（约好了一起进房？），否则清晰展示谁先到。
- **关系时间轴**：把共处、状态、位置变化聚合成时间线，一眼看出谁是你最近互动最频繁的人。
- **好友关系网增强**：共同好友、手动关系、追踪用户全在图里，隐藏共同好友也遮不住你的社交圈；支持手动强制连线，纯本地显示。
- **个人简介 Diff**：Bio 变化像代码 diff 一样展示，新增与删除内容分开，改了什么一目了然；对中英文混合文本做了更适合阅读的差异展示。
- **灯色/状态分布**：在线期间的状态占比统计，排除离线时间干扰，看清真实的在线习惯。

### 追踪与自动化

- **追踪非好友**：把感兴趣的人加入本地追踪，持续记录公开资料、状态与 Bio 变化。
- **自动跟随**：锁定目标好友，自动监听实例变化并按当前桌面/VR 状态尝试加入。
- **VR/桌面双模式启动**：自动检测 SteamVR，按场景选择最合适的启动方式。
- **快速启动按钮**：右下角圆形按钮一键启动 VRChat 桌面/VR 模式或 SteamVR。

### 通知与托盘

- **通知中心增强**：布局、未读红点、清理显示、邀请类通知响应，常用操作一步到位。
- **桌面通知总开关**：一键关闭全部桌面通知，自定义提示音也不会继续播放。
- **自定义提示音**：为桌面通知选择本地提示音，从此不再与其他应用通知混淆。
- **托盘静音模式**：右键一键静音，想安静的时候不必退出。
- **V 睡模式**：保留手腕叠加界面、关闭头显通知，躺着也能知道状态。

### 工具与系统体验

- **内存清理工具**：占用概览、普通清理、深度清理分级可选，内存紧张时的应急手段。
- **关闭按钮行为设置**：每次询问 / 最小化到托盘 / 直接退出，随你的使用习惯。
- **离线不活跃好友分类**：按自定义时间归类长期离线好友，列表不再杂乱。
- **界面一致性修正**：侧栏、玩家列表、弹窗与浮动按钮与 VRCX 风格保持统一。

### 数据补全

- **启动补全扫描**：VRCX 未运行期间错过的变化，启动时自动补齐，Bio/状态历史不留空白。
- **打开资料即记录**：点开即拉取、变化即落库，非好友也能留下可回看的记录。
- **自我数据记录**：自己的位置、状态、头像变化也值得回看。
- **状态计时恢复**：重启后好友还在原实例？停留时长尽量从本地记录还原。

### 多账号

- **多账号同登**：同一台设备同时登录多个账号，数据独立存储互不干扰，登录界面可多选主/次账号。
- **无缝切换**：切换账号后界面自动刷新为当前账号的好友、动态与个人信息。
- **聚合视图**：左下角视图切换器可在"单个账号"与"合并视图"之间切换，多账号动态一屏尽览。

### 数据库引擎（VRCX-K 新增）

- **多引擎支持**：除默认的 SQLite 外，支持 MySQL / MariaDB / PostgreSQL 作为数据后端，通过 `VRCX_Database.mode` 配置切换，适合多人/多设备共享数据或更大数据量场景。
- **数据搬迁**：支持在引擎之间搬迁数据（如 SQLite → PostgreSQL），搬迁后校验行数与时间戳完整性。
- **声明式迁移系统**：数据库结构升级由声明式 `.map` 迁移驱动，支持幂等执行与拓扑排序，升级过程有阻断式确认。
- **连接池与事务**：三引擎统一实现连接池与栈式事务上下文，支持空闲连接清理与健康状态监控；底部栏可查看数据库连接状态。
- **兼容性**：保留 VRCX 原有数据库结构与数据路径，升级不丢数据；统一适配层抽象，各引擎方言隔离。

### 原版体验补充

- **快速搜索增强**：输入即搜，还能搜到"最近遇到的人"与"最近加入的世界"——即使不是好友，同房待过就能找到；**连个人简介（Bio）也能搜**。
- **持久化补全**：Bio、状态、头像、位置变化尽量落库，减少"只在内存里看过、重启就没了"的情况。
- **上游同步**：持续跟进原版 VRCX 上游更新，用魔改版也能享受最新功能。

> 以上功能在 VRCX-K 中全部可用；更细的代码级实现与完整清单见 [VRCX-Luo 功能特性](./docs/features/LUO_FEATURES.md)（架构与技术细节见 [docs/](./docs/README.md)）。

## 数据与逻辑结构

VRCX-K 的新增功能尽量不绕开原版 VRCX 的数据体系。核心逻辑可以按下面理解：

```text
VRChat API / Pipeline WebSocket / VRChat output_log.txt
        |
        v
Coordinator / Store 处理用户、好友、位置、通知事件
        |
        v
数据库适配层（adapter：SQLite / MySQL / PostgreSQL）
        |
        v
Charts / UserDialog / Sidebar / Tools 等界面读取并展示
```

### 数据来源

| 层级 | 来源 | 主要用途 |
| :--- | :--- | :--- |
| 游戏日志 | 本地 VRChat `output_log.txt` | 当前实例玩家加入/离开、实例切换、玩家列表辅助数据 |
| WebSocket | VRChat Pipeline | 好友上下线、位置变化、资料变更、通知事件 |
| REST API | VRChat API | 用户资料、好友列表、世界/实例详情、状态补全 |
| 本地配置 | VRCXStorage / configRepository | 用户偏好、窗口行为、通知开关、工具设置 |
| 数据库 | SQLite（默认）/ MySQL / MariaDB / PostgreSQL，经 adapter 统一访问，保留 VRCX 原有表结构 | Feed、Bio 历史、状态、关系、追踪列表、分析查询 |

### 前端结构

| 目录 | 职责 |
| :--- | :--- |
| `src/views` | 页面级功能，例如 Charts、PlayerList、Settings、Tools、Notifications |
| `src/components` | 可复用组件，例如快速启动按钮、用户弹窗、关闭行为弹窗 |
| `src/stores` | Pinia 状态管理，例如好友、通知、自动跟随、设置、VR 状态 |
| `src/services` | API、数据库、配置、账号和底层服务封装 |
| `src/coordinators` | 将 WebSocket/API/数据库事件编排成业务流程 |
| `src/shared` | 常量、工具函数、跨平台通用逻辑和测试 |

### 桌面端结构

| 目录 | 职责 |
| :--- | :--- |
| `Dotnet` | Windows CEF 版本后端、AppApi、游戏/SteamVR 检测、托盘、内存清理 |
| `src-electron` | Electron 版本主进程、托盘菜单、窗口行为和原生桥接 |
| `Installer` | Windows 安装包脚本 |
| `.github/workflows` | GitHub Actions 构建与发布 |

## 安全与边界

- VRCX-K 只基于 VRCX 原版可获得的数据、VRChat API 返回的数据和本地游戏日志做整理展示。
- 不提供 VRChat 账号凭据导出、数据库清空、绕过隐私状态等高风险能力。
- 追踪、关系图、Bio Diff 等功能主要面向本地记录和本地分析，请遵守 VRChat 规则并尊重他人隐私。
- 开启黄灯/红灯、隐藏位置等 VRChat 原生隐私设置，会影响本项目可展示的数据。
- 部分高级设置包含自动加入默认群组等选项，用于功能认证或邀请辅助；不需要时可以在设置中关闭。
- 如果你认为某类数据不应被 VRCX 或相关分支读取，应该优先向 VRCX/VRChat 对应上游反馈规则和接口边界问题。

## 开发者文档

按主题分类存放，完整导读见 [docs/README.md](./docs/README.md)：

- [数据刷新机制说明](./docs/architecture/DATA_REFRESH.md)
- [EngineAdapter API 参考（三引擎统一契约）](./docs/architecture/ADAPTER_API.md)
- [事务与连接池设计](./docs/architecture/TRANSACTION_DESIGN.md)
- [PostgreSQL 引擎设计](./docs/architecture/PGSQL_DESIGN.md)
- [数据库配置重构说明](./docs/architecture/CONFIG_REFACTOR.md)
- [数据库模型（MCD/SR/ERD）](./docs/architecture/models/vrcx_mcd_mld.md)
- [VRCX-Luo 功能特性](./docs/features/LUO_FEATURES.md)
- [VRCX-Jirai 改动清单](./docs/features/JIRAI_FEATURES.md)
- [多账号 V4 设计（历史设计稿）](./docs/architecture/MULTI_ACCOUNT_V4_DETAIL_DESIGN.md)
- [Windows CEF 本地测试与安全重启](#windows-本地测试构建)

## 从源码构建

### 环境要求

- Node.js `>= 24.10.0`
- npm `>= 11.5.0`
- Windows CEF 构建需要 .NET SDK 和 Visual Studio 相关桌面开发组件

### 前端构建

```powershell
npm install
$env:PLATFORM='windows'
npm run prod
```

### Windows 本地测试构建

```powershell
.\build-windows-local.bat
```

构建脚本内置安全停止流程（只结束主进程、等待 CEF 子进程自然退出，不会批量强杀）；关闭到托盘配置见 `VRCX_CloseToTray` / `VRCX_CloseToTrayPrompt`。日志位于 `%APPDATA%\VRCX\logs`。

## 免责声明

VRCX-K is not endorsed by VRChat and does not reflect the views or opinions of VRChat or anyone officially involved in producing or managing VRChat properties. VRChat and all associated properties are trademarks or registered trademarks of VRChat Inc. VRChat © VRChat Inc.

## Star History

[![Star History Chart](https://api.star-history.com/image?repos=VRChatCN-Kipfel/VRCX-K&type=date&legend=top-left)](https://www.star-history.com/?repos=VRChatCN-Kipfel%2FVRCX-K&type=date&legend=top-left)
