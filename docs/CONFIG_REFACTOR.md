# VRCX_Database.* 配置重构 (2026-07)

## 背景

原有 `VRCX_Database.*` 配置结构松散：
- `mode` 字段存在但从未被消费（僵尸字段）
- `location` 字段语义模糊，且初始化时会写回默认路径 → 篡改用户配置
- 无 options 扩展机制，PRAGMA 参数全部硬编码在 `SQLite.cs::Init()` 里
- 无标准认证字段（host/port/username/password），无法应对未来多引擎需求

## 目标

1. 重构 `VRCX_Database.*` 为完整、自描述的配置骨架
2. 建立 options 合并策略：内置默认 + 用户覆写
3. 严格分离读写职责：初始化只读不写，仅 bootstrap 和用户操作触发写入
4. 向前兼容：自动迁移旧 `VRCX_DatabaseLocation` / `VRCX_Database.location`

## 新配置结构

### VRCX.json 文件形态

首次运行 bootstrap：

```json
{
  "VRCX_Database": {
    "mode": "sqlite",
    "name": "",
    "host": "",
    "port": "",
    "username": "",
    "password": "",
    "options": {
      "_example_journal_mode": "WAL"
    }
  }
}
```

用户自定义后：

```json
{
  "VRCX_Database": {
    "mode": "sqlite",
    "name": "D:/data/custom.sqlite3",
    "options": {
      "_example_journal_mode": "WAL",
      "cache_size": "-8000"
    }
  }
}
```

### 字段表

| 字段 | SQLite 含义 | MySQL/未来含义 |
|---|---|---|
| `mode` | `"sqlite"` | `"mysql"`, `"postgresql"` |
| `name` | 文件路径（空=默认 `%APPDATA%/VRCX/VRCX.sqlite3`） | schema 名（空=`"vrcx"`） |
| `host` | 忽略 | 服务器地址 |
| `port` | 忽略 | 端口 |
| `username` | 忽略 | 认证用户名 |
| `password` | 忽略 | 认证密码 |
| `options.*` | PRAGMA 参数 sub-keys | 引擎特定参数 |

## Options 合并策略

### 内置默认值

```csharp
private static readonly Dictionary<string, string> DefaultOptions = new() {
    { "locking_mode", "NORMAL" },
    { "busy_timeout", "5000" },
    { "journal_mode", "WAL" },
    { "optimize", "0x10002" },
};
```

### Merge 规则

```
用户配置(prefix-scan VRCX_Database.options.*)   ← 过滤 _ 前缀
    ↓
合并到 DefaultOptions 上                        ← 有则改无则增
    ↓
构造连接字符串: Data Source="...";Version=3;PRAGMA {key}={value};...
```

`_` 前缀 key 永远不进入连接字符串，仅作注释/占位用。

## Name 字段验证规则

`SQLite.Init()` 与 `AppApi.ResolveDatabaseName`（JS 桥接）均委托至 `ValidateAndCanonicalizeDatabasePath`（集中式验证器，单一审计点）。验证器依次执行：null 字节拒绝（H-1）→ Trim/null-safe → `ResolveDatabasePath` 分派 → boundary 检查（C-1，按路径类型分两支：含分隔符分支先 `Path.IsPathRooted` 检查拒绝非绝对路径，再 `Path.GetFullPath` 规范化；纯文件名分支 `Path.GetFullPath` 规范化后 `StartsWith(AppData)` 检查）→ `ValidateDatabaseFile` 文件级检查。

| # | 检查项 | 处理 | 状态 |
|---|---|---|---|
| 0 | `name` 含 `\0`（null 字节） | `InvalidOperationException`（在任何字符串处理前拒绝，H-1 主门） | 新增 |
| 1 | `name` 首尾空白 | `name?.Trim() ?? string.Empty`（null-safe，移入 `ValidateAndCanonicalizeDatabasePath`） | 修订（原：`Trim()` 净化） |
| 2 | 后缀不是 `.db` / `.db3` / `.sqlite3`（大小写不敏感） | `InvalidOperationException` | 保留 |
| 3 | 文件名部分（`Path.GetFileName`）含有 `:`（Windows ADS / 明显填错）— 不检查路径中的驱动器号冒号 | `InvalidOperationException` | 保留 |
| 4 | 文件名（不含后缀）是保留设备名（`CON` `PRN` `AUX` `NUL` `COM*` `LPT*`） | `InvalidOperationException` | 保留 |
| 4b | 纯文件名解析后逃逸 `AppDataDirectory` / 含分隔符但非绝对路径 | `InvalidOperationException`（C-1 boundary check，必须在 `GetFullPath` 前检查 `IsPathRooted`） | 新增 |
| 4c | 路径含 `"` | `InvalidOperationException`（防 Data Source 引号注入，Linux 跨平台，H-4） | 新增 |
| 5 | 解析结果是已存在的目录 | `InvalidOperationException` | 保留 |
| 6 | 父目录不存在 | `Directory.CreateDirectory` 递归创建 | 保留 |
| 7 | 其他错误（权限、磁盘满等） | 由 `Open()` 抛异常，阻止启动 | 保留 |

以上检查全平台统一，不分支。

## Security Hardening (Phase 7.5.x)

> 集中实现于 `Dotnet/SQLite.cs` 行 159–338（`ValidateAndCanonicalizeDatabasePath` / `ValidateDatabaseFile` / `SanitizePragmaValue`）+ `Dotnet/AppApi/Common/AppApiCommon.cs` 行 115–118（`ResolveDatabaseName` 委托）。
> 完整测试覆盖见 `Dotnet/VRCX.Tests/SQLiteSecurityTests.cs`（42 用例，6 分组）。

### 集中式路径验证器 (C-1, C-2)

- `SQLite.ValidateAndCanonicalizeDatabasePath(string name)` 是路径解析的**单一审计点**
- `Init()`（C# 后端启动）与 `AppApi.ResolveDatabaseName`（JS 桥接运行时调用）均委托，确保验证一致
- **Boundary check 两个分支**（C-1）：
  - 纯文件名分支：`canonical.StartsWith(appDataWithSep, OrdinalIgnoreCase)` — 防止 `subdir/../escape.db` 逃逸
  - 含分隔符分支：`Path.IsPathRooted(resolved)` — 拒绝 `../../evil.db`
- **关键顺序**：`IsPathRooted` 必须在 `Path.GetFullPath` **之前**检查，否则规范化后永远为 true，检查失效
- 错误消息：`"VRCX_Database.name resolves to '{canonical}' which is outside the allowed data directory ..."` / `"... contains path separators but is not an absolute path ..."`

### PRAGMA 注入防护 (H-3, SEC-3a/3b/3c)

`SanitizePragmaValue(string key, string val)` 三层防御，**层序不可调换**：

| 层 | ID | 检查 | 拒绝输入示例 | 错误消息关键字 |
|---|---|---|---|---|
| Layer 0 | SEC-3a | 键名白名单正则 `^[A-Za-z0-9_]+$` | `"foo;PRAGMA rekey"`, `" key"`, `"key=value"` | `ASCII letters, digits` |
| Layer 1 | SEC-3b | 加密键黑名单 `ForbiddenPragmaKeys`（9 个 SEE 键，OrdinalIgnoreCase） | `"key"`, `"rekey"`, `"hexkey"`, `"hexrekey"`, `"textkey"`, `"textrekey"`, `"hexdbkey"`, `"hexrekey_md5"`, `"hexkey_md5"` | `forbidden for security reasons` |
| Layer 2 | SEC-3c | 值字符黑名单 `ForbiddenPragmaChars`（6 字符） | `"WAL;PRAGMA rekey=x"`, `"WAL\0"`, `"WAL'"`, `"WAL\""` | `forbidden characters` |

- **Layer 0 必须在 Layer 1 之前**：防止 `" key"`、`"key;x"` 等通过空格/分号绕过 ForbiddenPragmaKeys 的全字符串匹配
- Layer 2 字符集：`;` `'` `"` `\n` `\r` `\0`
- 返回值：`(val ?? string.Empty).Trim()`

### Data Source 引号注入防护 (H-4)

- `ValidateDatabaseFile` 步骤 0b 拒绝路径中的 `"`
- 跨平台必要性：Linux 上 `"` 是合法文件名字符，若不拒绝可构造恶意路径破坏连接字符串 `Data Source="..."` 解析

### .bak 向后兼容 (COMPAT-1)

- 实现于 `src/stores/vrcx.js::handleUninitializedDatabase()`
- `.bak` 键名优先级回退：`VRCX_Database.name` → `VRCX_Database.location` → `VRCX_DatabaseLocation`
- `AppApi.ResolveDatabaseName(bakDbName)` + `AppApi.ResolveDatabaseName(currentDbName)` 包裹 try/catch，验证失败回退 `initAndFixInPlace`
- 自引用去重：`bakIdentity === currentIdentity` 时不执行 `migrateFromOldDb`，回退 `initAndFixInPlace`（依赖 `ValidateAndCanonicalizeDatabasePath` 的规范化路径字符串等价比较）

### NPE 修复与性能优化 (SEC-5, SEC-6)

- **SEC-5 (NPE 修复)**：`Init()` 不再对 `VRCXStorage.Instance.Get("VRCX_Database.name")` 返回值直接 `.Trim()`；Trim 移入 `ValidateAndCanonicalizeDatabasePath` 用 `name?.Trim() ?? string.Empty` 实现 null-safe
- **SEC-6 (性能优化)**：`AllowedDatabaseExtensions` / `ReservedDeviceNames` 从 `ValidateDatabaseFile` 局部变量提升为 `private static readonly` 字段，避免每次调用分配 `HashSet<string>`

### JS 桥接一致性 (BRIDGE-1)

- `AppApi.ResolveDatabaseName`（`AppApiCommon.cs:115-118`）薄包装：`=> SQLite.ValidateAndCanonicalizeDatabasePath(name)`
- 类型声明：`src/types/globals.d.ts:224` `ResolveDatabaseName(name: string): Promise<string>`
- **JS 调用方必须 try/catch**：验证失败抛 `InvalidOperationException`，跨 IPC 边界后表现为 rejected Promise

## 写策略 (CORE RULE)

**初始化代码只读不写。写回 VRCXStorage 的唯一触发条件是用户操作。**

| 场景 | 行为 |
|---|---|
| 首次运行（无任何 `VRCX_Database.*` 键） | bootstrap 落补全骨架（7 字段 + `_` 示例） |
| name 为空，运行时使用默认路径 | **不写回** |
| options 为空，运行时使用默认值 | **不写回** |
| 用户通过 UI 手动配置了值 | 写回 |
| 用户手动编辑了 VRCX.json | 下次启动读到新值 |

## 配置迁移

### 旧 flat key 迁移

```
VRCX_DatabaseLocation (旧 flat key)  →  VRCX_Database.name
VRCX_Database.location (旧版 nested) →  VRCX_Database.name
```

迁移保留旧值。用户选择是否清空改默认路径。

## 涉及文件

| 文件 | 改动 |
|---|---|
| `Dotnet/VRCXStorage.cs` | bootstrap 骨架改为 7 新字段 + `_` 示例；迁移旧键 |
| `Dotnet/SQLite.cs` | `_` 前缀过滤 + merge 构建连接字符串；移除写回 |
| `Dotnet/Program.cs` | `"VRCX.sqlite3"` 抽取为常量 |
| `src/stores/vrcx.js` | 备份恢复逻辑适配 `name` 字段 |

## 规则索引

| ID | 规则 |
|---|---|
| RW-1 | 写配置的唯一触发条件是上层叙事，初始化代码绝不写回 |
| RW-2 | bootstrap 落完整骨架，运行时不变 |
| OPT-1 | `options.*` 用子键展开，非 JSON 字符串 |
| OPT-2 | `_` 前缀 key 跳过连接字符串，仅作注释/占位 |
| OPT-3 | merge 策略：用户值覆写内置默认，有则改无则增 |
| OPT-4 | `_` 前缀过滤仅在 C# SQLite.cs::Init() 执行，上层 adapter 不做此过滤 |
| NAME-1 | `name` 在 SQLite 下是文件路径解析，在 MySQL 下是 schema 名 |
| NAME-2 | SQLite 下 `name` 字段必须解析为 `.db` / `.db3` / `.sqlite3` 后缀的文件 |
| NAME-3 | `name` 全平台统一检查：拒绝 `:`、拒绝保留设备名、拒绝已存在的目录 |
| NAME-4 | 父目录不存在时 `Init` 递归创建，不报错 |
| MIG-1 | `VRCX_DatabaseLocation` → `VRCX_Database.name` |
| MIG-2 | `VRCX_Database.location` → `VRCX_Database.name` |
| C-1 | `ValidateAndCanonicalizeDatabasePath` 按路径类型做 boundary 检查：纯文件名在 `Path.GetFullPath` 规范化后检查 `StartsWith(AppData)`；含分隔符的路径必须在 `Path.GetFullPath` **前**检查 `Path.IsPathRooted`（否则规范化后始终为 true，检查失效） |
| C-2 | `ValidateAndCanonicalizeDatabasePath` 是路径解析的单一审计点，`Init()` 与 `AppApi.ResolveDatabaseName` 均委托 |
| H-1 | `name` 含 `\0` 在任何字符串处理前拒绝（`ValidateAndCanonicalizeDatabasePath` 步骤 0 主门 + `ValidateDatabaseFile` 步骤 0 defense-in-depth + `ForbiddenPragmaChars` 含 `\0`） |
| H-3 | PRAGMA 注入防护由 `SanitizePragmaValue` 三层防御实现（见 SEC-3a/3b/3c） |
| SEC-3a | PRAGMA 键名白名单 `^[A-Za-z0-9_]+$`，在加密键黑名单之前执行防绕过 |
| SEC-3b | PRAGMA 加密键黑名单 `ForbiddenPragmaKeys`（9 个 SEE 键，OrdinalIgnoreCase） |
| SEC-3c | PRAGMA 值字符黑名单 `ForbiddenPragmaChars`（`;` `'` `"` `\n` `\r` `\0`） |
| H-4 | `ValidateDatabaseFile` 拒绝路径中的 `"` 防 Data Source 引号注入（Linux 上 `"` 是合法文件名字符） |
| SEC-5 | `Init()` 不再 `.Trim()`；Trim 移入 `ValidateAndCanonicalizeDatabasePath` 用 `name?.Trim() ?? string.Empty` 实现 null-safe |
| SEC-6 | `AllowedDatabaseExtensions` / `ReservedDeviceNames` 为 `static readonly` 字段，避免每次调用分配 |
| COMPAT-1 | `handleUninitializedDatabase` 读取 `.bak` 键名优先级回退（name→location→VRCX_DatabaseLocation）+ `ResolveDatabaseName` try/catch + 自引用去重 |
| BRIDGE-1 | `AppApi.ResolveDatabaseName` 委托至 `SQLite.ValidateAndCanonicalizeDatabasePath`，确保 C# 后端与 JS 桥接调用方验证一致；JS 调用方必须 try/catch |
