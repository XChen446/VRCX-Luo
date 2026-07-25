using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Data.SQLite;
using System.IO;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;

namespace VRCX
{
    public class SQLite
    {
        public static SQLite Instance;
        private string _connectionString;
        private bool _initialized;

        // ── Transaction pinning ────────────────────────────────────────────
        // 与 PostgreSQL.cs / MySQL.cs 对称:_pinned Map 持有借出的连接,
        // sliding Timer 防泄漏。connId 有值时 Execute/ExecuteNonQuery 走
        // pinned 连接 + 重置 Timer;无值时走池自动派发。
        // System.Data.SQLite 通过连接字符串 `Pooling=True` 启用 ADO.NET
        // 池化,每次 `new SQLiteConnection(connStr)` + `Open()` 借池中连接,
        // `Dispose()` 还池。SQLite 文件锁串行化写操作,池化的主要收益
        // 是事务期间其他查询走独立连接(不被事务阻塞)。
        private readonly object _txLock = new();
        private readonly ConcurrentDictionary<long, TxHolder> _pinned = new();
        private long _nextConnId;
        private const int TX_IDLE_MS = 60000;

        private sealed class TxHolder
        {
            public SQLiteConnection Conn = null!;
            public Timer Timer = null!;
        }

        private static readonly Dictionary<string, string> DefaultOptions = new()
        {
            { "locking_mode", "NORMAL" },
            { "busy_timeout", "5000" },
            { "journal_mode", "WAL" },
            { "optimize", "0x10002" },
        };

        /// <summary>
        /// PRAGMA keys related to SQLite database encryption.
        /// These MUST NOT be settable via VRCX_Database.options.* to prevent
        /// unauthorized keying/re-keying of the database through config injection.
        /// Covers SEE (SQLite Encryption Extension) pragmas + the System.Data.SQLite
        /// built-in `key`/`rekey` aliases.
        /// </summary>
        private static readonly HashSet<string> ForbiddenPragmaKeys = new(StringComparer.OrdinalIgnoreCase)
        {
            "key", "rekey", "hexkey", "hexrekey",
            "textkey", "textrekey",
            "hexdbkey", "hexrekey_md5", "hexkey_md5",
        };

        /// <summary>
        /// Characters forbidden in PRAGMA values because they can alter the
        /// SQLite connection string structure when concatenated directly.
        /// ';' delimits connection parameters, quotes alter parsing, newlines
        /// can cause line-injection, and '\0' can truncate the native string
        /// at the P/Invoke boundary.
        /// </summary>
        private static readonly char[] ForbiddenPragmaChars = { ';', '\'', '"', '\n', '\r', '\0' };

        /// <summary>
        /// Allowlist pattern for PRAGMA key names. Keys must consist only of
        /// ASCII letters, digits, and underscores — this prevents any
        /// connection-string-injection via the key (e.g. "foo;PRAGMA rekey").
        /// Applied in SanitizePragmaValue BEFORE the ForbiddenPragmaKeys
        /// blacklist so that crafted keys like " key" or "key;x" are rejected
        /// before the blacklist lookup.
        /// </summary>
        private static readonly System.Text.RegularExpressions.Regex AllowedPragmaKeyPattern =
            new System.Text.RegularExpressions.Regex("^[A-Za-z0-9_]+$",
                System.Text.RegularExpressions.RegexOptions.Compiled);

        /// <summary>
        /// File extensions permitted for the SQLite database file.
        /// Case-insensitive. Kept static to avoid per-call allocation.
        /// </summary>
        private static readonly HashSet<string> AllowedDatabaseExtensions = new(StringComparer.OrdinalIgnoreCase)
        {
            ".db", ".db3", ".sqlite3"
        };

        /// <summary>
        /// Windows reserved device names that must never be used as a filename.
        /// Case-insensitive. Kept static to avoid per-call allocation.
        /// </summary>
        private static readonly HashSet<string> ReservedDeviceNames = new(StringComparer.OrdinalIgnoreCase)
        {
            "CON", "PRN", "AUX", "NUL",
            "COM1", "COM2", "COM3", "COM4", "COM5",
            "COM6", "COM7", "COM8", "COM9",
            "LPT1", "LPT2", "LPT3", "LPT4", "LPT5",
            "LPT6", "LPT7", "LPT8", "LPT9"
        };

        static SQLite()
        {
            Instance = new SQLite();
        }

        public SQLite()
        {
        }

        public void Init()
        {
#if LINUX
            Instance = this;
#endif
            var name = VRCXStorage.Instance.Get("VRCX_Database.name");
            var dataSource = ValidateAndCanonicalizeDatabasePath(name);

            var dir = Path.GetDirectoryName(dataSource);
            if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
            {
                Directory.CreateDirectory(dir);
            }

            var mergedOptions = CollectOptions();
            var parts = new List<string>
            {
                $"Data Source=\"{dataSource}\"",
                "Version=3",
                // ADO.NET 池化:System.Data.SQLite 在连接字符串含 Pooling=True
                // 时启用连接池。每次 new SQLiteConnection(connStr) + Open()
                // 借池中连接,Dispose() 还池。与 Npgsql/MySqlConnector 对称。
                //
                // System.Data.SQLite 池没有 idle timeout 参数(不像 MySQL
                // ConnectionIdleTimeout=300),连接一旦创建就常驻到进程退出。
                // 这在桌面单用户场景下可接受:本地文件无网络开销,100 连接
                // 上限实际用不到(< 5 活跃),每连接约 2MB page cache + 2-3
                // 文件句柄,驻留开销远低于服务器场景。若未来改多用户/服务端
                // 部署,应重新评估。
                "Pooling=True",
                "Max Pool Size=100"
            };
            foreach (var (key, val) in mergedOptions)
            {
                var sanitized = SanitizePragmaValue(key, val);
                parts.Add($"PRAGMA {key}={sanitized}");
            }
            _connectionString = string.Join(";", parts);
            _initialized = true;
        }

        /// <summary>
        /// Resolves the database file path from VRCX_Database.name.
        /// </summary>
        internal static string ResolveDatabasePath(string name)
        {
            if (string.IsNullOrEmpty(name))
                return Program.ConfigLocation;

            // Has path separators → treat as absolute or relative path
            if (name.Contains('/') || name.Contains('\\'))
                return name;

            // Bare drive letter (e.g. "C:") → treat as root of that drive
            if (name.Length == 2 && name[1] == ':' && char.IsLetter(name[0]))
                return name + '\\';

            // Plain filename → resolve against AppDataDirectory
            return Path.Join(Program.AppDataDirectory, name);
        }

        /// <summary>
        /// Centralized path validation + canonicalization for VRCX_Database.name.
        /// This is the SINGLE entry point for path resolution — called by both
        /// Init() (C# backend) and AppApiCommon.ResolveDatabaseName (JS bridge).
        ///
        /// Validation order (deliberate):
        ///   1. Null byte rejection (before any string processing)
        ///   2. Null/whitespace → default ConfigLocation
        ///   3. Path resolution (ResolveDatabasePath)
        ///   4. Canonicalization (Path.GetFullPath)
        ///   5. Boundary check (traversal detection)
        ///   6. Filename-level checks (extension, colon, reserved name, directory)
        ///
        /// Returns the canonicalized absolute path on success.
        /// Throws InvalidOperationException on any validation failure.
        /// </summary>
        public static string ValidateAndCanonicalizeDatabasePath(string name)
        {
            // ── 0. Null-byte rejection (H-1) — MUST happen before ANY processing ──
            if (name != null && name.Contains('\0'))
            {
                throw new InvalidOperationException(
                    "VRCX_Database.name contains null (\\0) bytes — this is not allowed.");
            }

            // ── 1. Null/whitespace → default path ──
            name = name?.Trim() ?? string.Empty;
            if (string.IsNullOrEmpty(name))
                return Path.GetFullPath(Program.ConfigLocation);

            // ── 2. Resolve raw path (delegate to existing private helper) ──
            var resolved = ResolveDatabasePath(name);

            // ── 3. Canonicalize (resolves ../, ./, redundant separators, relative paths) ──
            var canonical = Path.GetFullPath(resolved);

            // ── 4. Boundary check (traversal detection — C-1) ──
            var hasSeparators = name.Contains('/') || name.Contains('\\');
            var isBareDrive = name.Length == 2 && name[1] == ':' && char.IsLetter(name[0]);

            if (!hasSeparators && !isBareDrive)
            {
                // Plain filename resolved against AppDataDirectory: verify it stays within
                var appDataCanonical = Path.GetFullPath(Program.AppDataDirectory);
                var appDataWithSep = appDataCanonical.TrimEnd(Path.DirectorySeparatorChar)
                    + Path.DirectorySeparatorChar;
                if (!canonical.StartsWith(appDataWithSep, StringComparison.OrdinalIgnoreCase))
                {
                    throw new InvalidOperationException(
                        $"VRCX_Database.name resolves to '{canonical}' which is outside " +
                        $"the allowed data directory ('{appDataCanonical}').");
                }
            }
            else
            {
                // Path with separators or bare drive: the ORIGINAL input must already be
                // an absolute path. Checking IsPathRooted on `resolved` (before GetFullPath)
                // is critical — GetFullPath makes ANY relative path absolute relative to CWD,
                // so checking IsPathRooted(canonical) would always be true and provide no
                // security. This rejects relative paths like "../../evil.db".
                if (!Path.IsPathRooted(resolved))
                {
                    throw new InvalidOperationException(
                        $"VRCX_Database.name contains path separators but is not an absolute " +
                        $"path. Relative paths with separators are not allowed. Received: '{name}'");
                }
            }

            // ── 5. Filename-level checks (extension, colon, reserved name, directory) ──
            ValidateDatabaseFile(canonical);

            return canonical;
        }

        /// <summary>
        /// Validates that the resolved database file path is usable.
        /// Throws InvalidOperationException with a clear message on any violation.
        /// </summary>
        internal static void ValidateDatabaseFile(string path)
        {
            // ── 0. Null-byte trap (defense-in-depth; primary gate is ValidateAndCanonicalizeDatabasePath) ──
            if (path.Contains('\0'))
            {
                throw new InvalidOperationException(
                    "Database path contains null (\\0) bytes — this is not allowed.");
            }

            // ── 0b. Reject embedded double-quote (prematurely closes the
            //      "Data Source" quoted value in the connection string on
            //      platforms where " is a valid filename char, e.g. Linux).
            //      On Windows the OS already forbids " in filenames, but this
            //      guard is defense-in-depth and keeps the C# side consistent
            //      with the JS adapter (which escapes " as "").
            if (path.Contains('"'))
            {
                throw new InvalidOperationException(
                    $"VRCX_Database.name resolves to '{path}' which contains " +
                    "the character '\"' — this is not allowed in a database path.");
            }

            // ── 1. Check extension ──
            var ext = Path.GetExtension(path);
            if (string.IsNullOrEmpty(ext) || !AllowedDatabaseExtensions.Contains(ext))
            {
                throw new InvalidOperationException(
                    $"VRCX_Database.name resolves to '{path}' which does not have a valid " +
                    "SQLite database extension. Allowed extensions: .db, .db3, .sqlite3");
            }

            // ── 2. Check colon in filename (Windows ADS risk / obvious misconfiguration) ──
            var fileName = Path.GetFileName(path);
            if (fileName.Contains(':'))
            {
                throw new InvalidOperationException(
                    $"VRCX_Database.name resolves to '{path}' which contains " +
                    "the character ':' in the filename — this is not allowed.");
            }

            // ── 3. Check Windows reserved device names ──
            var nameWithoutExt = Path.GetFileNameWithoutExtension(path);
            if (ReservedDeviceNames.Contains(nameWithoutExt))
            {
                throw new InvalidOperationException(
                    $"VRCX_Database.name resolves to '{path}' which uses the reserved " +
                    $"system name '{nameWithoutExt}' — this is not allowed.");
            }

            // ── 4. Check path is not an existing directory ──
            if (Directory.Exists(path))
            {
                throw new InvalidOperationException(
                    $"VRCX_Database.name resolves to '{path}' which is an existing " +
                    "directory. Please specify a file path.");
            }
        }

        /// <summary>
        /// Collects user options from VRCX_Database.options.* prefix,
        /// merges them over DefaultOptions. Keys starting with '_' are
        /// treated as comments/placeholders and never passed to SQLite.
        /// </summary>
        private static Dictionary<string, string> CollectOptions()
        {
            const string prefix = "VRCX_Database.options.";
            var userOptions = VRCXStorage.Instance.GetWithPrefix(prefix);

            var merged = new Dictionary<string, string>(DefaultOptions);
            foreach (var (key, val) in userOptions)
            {
                if (key.StartsWith("_")) continue;
                merged[key] = val;
            }
            return merged;
        }

        /// <summary>
        /// Validates a single PRAGMA key/value pair for connection string safety.
        /// Layer 1: blacklists encryption-related PRAGMA keys (key, rekey, hexkey, etc.).
        /// Layer 2: rejects values containing connection-string-injection characters
        ///          (;, ", ', or newlines).
        /// Returns the trimmed value on success.
        /// </summary>
        internal static string SanitizePragmaValue(string key, string val)
        {
            // Layer 0: enforce strict key allowlist (prevents connection-string
            // injection via the KEY, e.g. "foo;PRAGMA rekey"). Must run BEFORE
            // the ForbiddenPragmaKeys blacklist so that crafted keys like
            // " key" (leading space) or "key;x" cannot bypass the blacklist
            // lookup (which is a full-string match).
            if (string.IsNullOrEmpty(key) || !AllowedPragmaKeyPattern.IsMatch(key))
            {
                throw new InvalidOperationException(
                    $"VRCX_Database.options key '{key}' is invalid — " +
                    "PRAGMA key names must consist only of ASCII letters, digits, " +
                    "and underscores (no spaces, ';', '=', or other special characters).");
            }

            // Layer 1: blacklist forbidden keys (encryption-related)
            if (ForbiddenPragmaKeys.Contains(key))
            {
                throw new InvalidOperationException(
                    $"PRAGMA '{key}' is forbidden for security reasons. " +
                    "This key cannot be configured via VRCX_Database.options.");
            }

            // Layer 2: reject dangerous characters in values (including null bytes
            // which can truncate the native SQLite connection string).
            if (val != null && val.IndexOfAny(ForbiddenPragmaChars) >= 0)
            {
                throw new InvalidOperationException(
                    $"VRCX_Database.options.{key} contains forbidden characters " +
                    "(;, \", ', newlines, or null bytes) which are not allowed.");
            }

            return (val ?? string.Empty).Trim();
        }

        public void Exit()
        {
            _initialized = false;
            _connectionString = null;
            // 清理任何残留的 pinned 事务连接
            lock (_txLock)
            {
                foreach (var kv in _pinned)
                {
                    try { kv.Value.Timer?.Dispose(); } catch { }
                    try { kv.Value.Conn?.Dispose(); } catch { }
                }
                _pinned.Clear();
            }
            // 清空 ADO.NET 池(System.Data.SQLite 专属 API)
            try { SQLiteConnection.ClearAllPools(); } catch { }
        }

        // for Electron
        public string ExecuteJson(string sql, IDictionary<string, object>? args = null, long? connId = null)
        {
            var result = Execute(sql, args, connId);
            return JsonSerializer.Serialize(result);
        }

        public object[][] Execute(string sql, IDictionary<string, object>? args = null, long? connId = null)
        {
            if (connId.HasValue)
            {
                return ExecutePinned(connId.Value, sql, args);
            }
            EnsureInitialized();
            using var connection = new SQLiteConnection(_connectionString);
            connection.Open();
            using var command = new SQLiteCommand(sql, connection);
            if (args != null)
            {
                foreach (var arg in args)
                {
                    command.Parameters.Add(new SQLiteParameter(arg.Key, arg.Value));
                }
            }

            using var reader = command.ExecuteReader();
            var result = new List<object[]>();
            while (reader.Read())
            {
                var values = new object[reader.FieldCount];
                for (var i = 0; i < reader.FieldCount; i++)
                {
                    values[i] = reader.GetValue(i);
                }
                result.Add(values);
            }
            return result.ToArray();
        }

        public int ExecuteNonQuery(string sql, IDictionary<string, object>? args = null, long? connId = null)
        {
            if (connId.HasValue)
            {
                return ExecuteNonQueryPinned(connId.Value, sql, args);
            }
            EnsureInitialized();
            using var connection = new SQLiteConnection(_connectionString);
            connection.Open();
            using var command = new SQLiteCommand(sql, connection);
            if (args != null)
            {
                foreach (var arg in args)
                {
                    command.Parameters.Add(new SQLiteParameter(arg.Key, arg.Value));
                }
            }
            return command.ExecuteNonQuery();
        }

        /// <summary>
        /// Opens a fresh connection to the specified database file (or in-memory DB),
        /// executes the given SQL, and returns the result set serialized as a JSON array.
        /// The connection is closed (and disposed) after the query completes.
        ///
        /// This does NOT touch the pooled connection — it is completely independent,
        /// intended for querying an EXTERNAL database (e.g. during migration).
        /// The caller controls read/write behaviour via the <paramref name="connectionString"/>.
        /// </summary>
        /// <param name="connectionString">Full SQLite connection string (e.g. 'Data Source="...";Version=3;').</param>
        /// <param name="sql">SQL to execute.</param>
        /// <param name="args">Optional named parameters (<c>@key → value</c>).</param>
        /// <returns>JSON array of row arrays, e.g. [["val1", 42], ["val2", 99]].</returns>
        public string ExecuteJson(string connectionString, string sql, IDictionary<string, object>? args = null)
        {
            using var connection = new SQLiteConnection(connectionString);
            connection.Open();

            using var command = new SQLiteCommand(sql, connection);
            if (args != null)
            {
                foreach (var arg in args)
                {
                    command.Parameters.Add(new SQLiteParameter(arg.Key, arg.Value));
                }
            }

            using var reader = command.ExecuteReader();
            var result = new List<object[]>();
            while (reader.Read())
            {
                var values = new object[reader.FieldCount];
                for (var i = 0; i < reader.FieldCount; i++)
                {
                    values[i] = reader.GetValue(i);
                }
                result.Add(values);
            }

            return JsonSerializer.Serialize(result);
        }

        /// <summary>
        /// Opens a fresh connection to the specified database file,
        /// executes a non-query SQL (INSERT/UPDATE/DELETE/DDL), and returns the number
        /// of rows affected. The connection is closed after the query completes.
        ///
        /// This does NOT touch the pooled connection — it is completely independent.
        /// </summary>
        /// <param name="connectionString">Full SQLite connection string.</param>
        /// <param name="sql">SQL to execute.</param>
        /// <param name="args">Optional named parameters (<c>@key → value</c>).</param>
        /// <returns>Number of rows affected.</returns>
        public int ExecuteNonQuery(string connectionString, string sql, IDictionary<string, object>? args = null)
        {
            using var connection = new SQLiteConnection(connectionString);
            connection.Open();

            using var command = new SQLiteCommand(sql, connection);
            if (args != null)
            {
                foreach (var arg in args)
                {
                    command.Parameters.Add(new SQLiteParameter(arg.Key, arg.Value));
                }
            }

            return command.ExecuteNonQuery();
        }

        // ── Transaction pinning implementation ───────────────────────────────
        // 与 PostgreSQL.cs / MySQL.cs 对称。

        private void EnsureInitialized()
        {
            if (!_initialized || string.IsNullOrEmpty(_connectionString))
                throw new InvalidOperationException(
                    "SQLite backend not initialised. Call Init() first.");
        }

        private static SQLiteCommand CreateTxCommand(TxHolder h, string sql, IDictionary<string, object>? args)
        {
            var command = h.Conn.CreateCommand();
            command.CommandText = sql;
            if (args != null)
            {
                foreach (var arg in args)
                {
                    command.Parameters.Add(new SQLiteParameter(arg.Key, arg.Value));
                }
            }
            return command;
        }

        private object[][] ExecutePinned(long connId, string sql, IDictionary<string, object>? args)
        {
            if (!_pinned.TryGetValue(connId, out var h))
                throw new InvalidOperationException(
                    $"connId={connId} 已超时回滚或不存在,请重试事务");
            // 暂停 Timer 防止慢查询(SQL 执行中)触发超时回滚,
            // 执行完恢复 Timer 重新计时 idle 间隔。
            lock (_txLock) { h.Timer.Change(Timeout.Infinite, -1); }
            try
            {
                using var command = CreateTxCommand(h, sql, args);
                using var reader = command.ExecuteReader();
                var result = new List<object[]>();
                while (reader.Read())
                {
                    var values = new object[reader.FieldCount];
                    for (var i = 0; i < reader.FieldCount; i++)
                    {
                        values[i] = reader.GetValue(i);
                    }
                    result.Add(values);
                }
                return result.ToArray();
            }
            finally
            {
                lock (_txLock) { h.Timer.Change(TX_IDLE_MS, -1); }
            }
        }

        private int ExecuteNonQueryPinned(long connId, string sql, IDictionary<string, object>? args)
        {
            if (!_pinned.TryGetValue(connId, out var h))
                throw new InvalidOperationException(
                    $"connId={connId} 已超时回滚或不存在,请重试事务");
            lock (_txLock) { h.Timer.Change(Timeout.Infinite, -1); }
            try
            {
                using var command = CreateTxCommand(h, sql, args);
                return command.ExecuteNonQuery();
            }
            finally
            {
                lock (_txLock) { h.Timer.Change(TX_IDLE_MS, -1); }
            }
        }

        /// <summary>
        /// Borrow a pooled connection, BEGIN a transaction on it, and return
        /// a connId for subsequent Execute/ExecuteNonQuery calls.
        /// </summary>
        public long BeginTransaction()
        {
            EnsureInitialized();
            var connId = Interlocked.Increment(ref _nextConnId);
            var conn = new SQLiteConnection(_connectionString);
            conn.Open();
            var holder = new TxHolder { Conn = conn };
            using (var beginCmd = conn.CreateCommand())
            {
                beginCmd.CommandText = "BEGIN";
                beginCmd.ExecuteNonQuery();
            }
            holder.Timer = new Timer(_ => OnTxTimeout(connId), null, TX_IDLE_MS, -1);
            _pinned[connId] = holder;
            return connId;
        }

        /// <summary>
        /// COMMIT the transaction + return connection to pool.
        /// </summary>
        public void CommitTransaction(long connId)
        {
            lock (_txLock)
            {
                if (!_pinned.TryRemove(connId, out var h))
                    throw new InvalidOperationException(
                        $"connId={connId} 已超时回滚或不存在,无法 commit");
                h.Timer.Dispose();
                try
                {
                    using var cmd = h.Conn.CreateCommand();
                    cmd.CommandText = "COMMIT";
                    cmd.ExecuteNonQuery();
                }
                finally
                {
                    h.Conn.Dispose();
                }
            }
        }

        /// <summary>
        /// ROLLBACK the transaction + return connection to pool. No-op if
        /// connId already timed out.
        /// </summary>
        public void RollbackTransaction(long connId)
        {
            lock (_txLock)
            {
                if (!_pinned.TryRemove(connId, out var h)) return;
                h.Timer.Dispose();
                try
                {
                    using var cmd = h.Conn.CreateCommand();
                    cmd.CommandText = "ROLLBACK";
                    cmd.ExecuteNonQuery();
                }
                catch { /* 可能已超时回滚,忽略 */ }
                finally
                {
                    h.Conn.Dispose();
                }
            }
        }

        private void OnTxTimeout(long connId)
        {
            lock (_txLock)
            {
                if (!_pinned.TryRemove(connId, out var h)) return;
                Console.Error.WriteLine(
                    $"[SQLite] 事务 connId={connId} 空闲 {TX_IDLE_MS}ms,自动回滚");
                h.Timer.Dispose();
                try
                {
                    using var cmd = h.Conn.CreateCommand();
                    cmd.CommandText = "ROLLBACK";
                    cmd.ExecuteNonQuery();
                } catch { }
                try { h.Conn.Dispose(); } catch { }
            }
        }
    }
}
