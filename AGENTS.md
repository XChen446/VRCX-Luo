# VRCX-Luo: Agent Guide

## Stack

- **Frontend**: Vue 3 (JS, no TypeScript), JSDoc types, CheckJS for type checking
- **State**: Pinia (stores named `*Store`), TanStack Query
- **Styling**: Tailwind CSS v4, Reka UI (Radix Vue port), lucide-vue-next icons
- **Linting/Format**: ESLint (flat config) + oxlint + oxfmt (NOT Prettier)
- **Testing**: Vitest + jsdom, globals enabled, files at `src/**/*.{test,spec}.js`
- **Backend**: C# .NET (`Dotnet/` dir, `VRCX-Cef.csproj` / `VRCX-Electron.csproj`)
- **Desktop**: Electron 40, hosted via `src-electron/`

## Dev Commands (run in order)

- `npm run dev` — dev server at **localhost:9000**
- `npm run format` — auto-fix formatting via oxfmt (⚠️ WARNING: only run when you intend to format the ENTIRE codebase. It touches all 1000+ files. Prefer editing with correct formatting manually, or target specific files only.)
- `npm run format:check && npm run lint && npm run typecheck:js && npm test` — full check pipeline
- `npm run prod` — build frontend (output: `build/html/`)
- `npm run build-electron` — package Electron (needs .NET 9 runtime)

## Architecture

```
src/              → Vue app (ESM)
  app.js          → entrypoint
  vite.config.js  → Vite config (rolldown)
  stores/         → Pinia stores (updateLoop.js is main heartbeat)
  coordinators/   → Business logic / side-effect orchestration
  services/       → database/, websocket.js, webapi.js, sqlite.js
  api/            → VRChat REST API wrappers (TanStack Query)
  queries/        → TanStack Query client + keys + policies
  components/ui/  → shadcn-vue UI primitives (new-york style)
src-electron/     → Electron main process (CommonJS, require)
  main.js         → Electron entrypoint
Dotnet/           → C# backend (IPC via node-api-dotnet)
build/            → build output (gitignored)
```

## Key Constraints

- **Node >=24.10, npm >=11.5** (enforced by `.npmrc` `engine-strict=true`)
- **Store mutation rule**: never assign `*Store.xxx = ...` from outside the owning store (enforced by ESLint `no-restricted-syntax`)
- **VRCXStorage** (JSON) used for startup config only; **SQLite** for runtime data
- **Globals** (readonly): `CefSharp`, `VRCX`, `VRCXStorage`, `SQLite`, `LogWatcher`, `Discord`, `AppApi`, `WebApi`, `WINDOWS`, `LINUX`, `VERSION`, `NIGHTLY`, `AppDebug` — available in browser context via CefSharp bindings
- **Platform define**: `WINDOWS=true` / `LINUX=true` set at build time via `PLATFORM` env var; vitest defaults to `WINDOWS=true`
- **Path alias**: `@/` → `src/`
- **Modularity**: 所有新增接口/代码文件必须遵循现有代码风格和严格的层级组织，不得写成一团乱麻。L3 及以上数据库读写优先使用 `adapter.*` 方法，基类已冻结，禁止修改。
- **Tasklist**: 项目任务清单在 https://github.com/XChen446/VRCX-Luo/issues/3 。AI 可通过 `gh` CLI 查询/保存/读取，但**禁止写入**（勾选/编辑/评论），除非得到执行者明确授权。若 AI 认为某项可勾选完成，应汇报给执行者等待确认。

## Testing

- `vitest.setup.js` stubs all CefSharp globals + `worker-timers` mock
- Tests need i18n locale loaded (already in setup)
- Coverage excludes `src/public/`, `src/vr/`, `src/types/`, `src/styles/`, `src/ipc-electron/`, `src/localization/`, `src/components/ui/`

## Database Refactoring (active branch: `database-refactor`)

- New `SQLiteAdapter` abstraction in `database/adapter/`
- All `database/*` modules import `adapter`, never `sqliteService` directly
- Single point of import: `database/adapter/SQLiteAdapter.js`

## Build (Windows Local)

`build-windows-local.bat` auto-installs .NET 10 SDK via winget if missing, then runs `npm run prod` + `dotnet build Dotnet/VRCX-Cef.csproj`.

## Docs Knowledge Index

项目架构、数据库设计、多账号方案等深度文档在 `docs/`：
- `DATABASE_SCHEMA.md` — 数据库概念模型 (MCD) 与关系架构 (SR)，实体关联概览
- `vrcx_mcd_mld.md` / `vrcx_sr_mld.md` — Merise 逻辑模型与关系模式，列出所有表名、字段、主键/外键
- `DATA_REFRESH.md` — 四层数据刷新架构（L1 游戏日志、L2 WS、L3 轮询、L4 全量同步 + Luo 补全机制），Feed 采集/持久化/UI 查询全链路
- `MULTI_ACCOUNT_V4_DETAIL_DESIGN.md` — 多账号 V4 详细设计（AccountHub、AccountSession、热替换 Store、聚合视图、通知路由），含文件改动清单与代码量估算
- `vrcx_erd.svg` / `vrcx_erd.mmd` / `vrcx_erd.dbml` — ER 图多格式输出

## VRCX_Database Config Refactoring (Jul 2026)

See `docs/CONFIG_REFACTOR.md` for full design decisions (bootstrap policy, `_` prefix convention, options merge strategy, name resolution rules, and security hardening: path traversal / PRAGMA injection / null byte rejection / quote injection / `.bak` backward compatibility).

## GitHub Issue/PR Editing (UTF-8 中文)

**问题**：PowerShell 5.1 的 `gh issue edit --body-file` / `gh pr edit --body-file` 读取 UTF-8 中文文件时会发生编码转换错误，上传到 GitHub 的内容变为乱码。

**正确做法**：用 Node.js 生成 JSON + `gh api --method PATCH` 上传，绕开 PowerShell 的编码层。

```bash
# 1. 用 Node.js 读取当前 body（正确 UTF-8）
node -e "const {execSync}=require('child_process');const out=execSync('gh api repos/XChen446/VRCX-Luo/issues/3 --jq .body',{encoding:'utf8',maxBuffer:1024*1024});require('fs').writeFileSync('issue3.md',out,'utf8');"

# 2. 编辑 issue3.md（edit 工具或手动），插入/修改内容

# 3. 用 Node.js 生成 JSON patch（确保中文字符正确编码）
node -e "const fs=require('fs');const body=fs.readFileSync('issue3.md','utf8');fs.writeFileSync('issue3.json',JSON.stringify({body:body}),'utf8');"

# 4. 通过 gh api PATCH 上传
gh api --method PATCH repos/XChen446/VRCX-Luo/issues/3 --input issue3.json --jq '.title'

# 5. 用 Node.js 验证（避免 PowerShell 重定向编码问题）
node -e "const {execSync}=require('child_process');const out=execSync('gh api repos/XChen446/VRCX-Luo/issues/3 --jq .body',{encoding:'utf8',maxBuffer:1024*1024});console.log('Length:',out.length);console.log(out.split('\n')[0]);"
```

**要点**：
- 全程使用 Node.js 读写文件和捕获 `gh` 输出（`{encoding:'utf8'}`），不经过 PowerShell 的编码层
- `gh api --input` 接受 JSON 文件，比 `gh issue edit --body-file` 更可靠
- 验证时也用 Node.js `execSync`，避免 PowerShell `>` 重定向导致 UTF-8 变 GBK
- 同样适用于 PR 编辑：`gh api --method PATCH repos/XChen446/VRCX-Luo/pulls/{n}`
