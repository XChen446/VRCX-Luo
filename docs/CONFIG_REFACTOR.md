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
| MIG-1 | `VRCX_DatabaseLocation` → `VRCX_Database.name` |
| MIG-2 | `VRCX_Database.location` → `VRCX_Database.name` |
