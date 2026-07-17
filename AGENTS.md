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

See `docs/CONFIG_REFACTOR.md` for full design decisions (bootstrap policy, `_` prefix convention, options merge strategy, name resolution rules).
