# 依赖安全记录（npm audit 基线）

> 复查命令：`npm audit`（生产依赖：`npm audit --omit=dev`）。每次依赖变更后复查，更新本文件。

## 基线（2026-08-08）

- **生产依赖（运行时）：0 漏洞**（`npm audit --omit=dev`）
- **开发依赖（构建/打包链）**：初始 15 漏洞（2 moderate / 12 high / 1 critical）→ `npm audit fix` 修复 12 个（electron-builder 系列、undici、tar、js-yaml、brace-expansion 等）→ 剩余 **3 个**（见下）

## 已知豁免项（无修复 / 修复需 breaking，暂缓）

| 包 | 严重度 | 公告 | 豁免理由 |
|---|---|---|---|
| `electron` 40.x–41.x（当前 40.10.6） | high | GHSA-9f4c-93c8-jc8g（Sandboxed iframe 绕过 allow-popups） | 修复需 breaking 升级 40 → 43（跨 3 个 major，含 API 破坏性变更）；上游 vrcx-team/VRCX 亦停留 40 系；Electron 壳仅用于 Linux/macOS 构建，需专项升级评估 |
| `showdown` / `vue-showdown` | moderate | GHSA-rmmh-p597-ppvv（ReDoS） | **无修复可用**；仅影响本地 markdown 渲染（用户笔记/简介展示），攻击面有限 |

## allowScripts 批准记录（@lavamoat/allow-scripts）

安装脚本白名单（`package.json` 的 `allowScripts`），版本升级后需重新批准（`npm install-scripts approve <pkg>`）：

| 包 | 批准版本 | 脚本 |
|---|---|---|
| `vue-demi` | 0.14.10 | postinstall |
| `@sentry/cli` | 2.58.6 | postinstall（Sentry 符号上传工具） |
| `electron` | 40.10.6 | postinstall（下载二进制） |
| `electron-winstaller` | 5.4.0 | postinstall |
| `core-js` | 3.47.0 | postinstall |

> `npm install` 出现 `allow-scripts ... not yet covered` 警告时：核对版本是否升级，确认脚本来源可信后 `npm install-scripts approve <pkg>` 并同步本表。
