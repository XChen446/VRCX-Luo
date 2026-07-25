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
        private readonly ReaderWriterLockSlim m_ConnectionLock;
        private SQLiteConnection m_Connection;

        // ── Transaction pinning ────────────────────────────────────────────
        // SQLite 只有一条物理连接 m_Connection,pin 的本质是"标记当前
        // 在事务中"+ sliding 超时防泄漏。Execute/ExecuteNonQuery 不需要
        // 路由(单连接天然统一),但接收 connId 用于重置 sliding Timer。
        // 与 PostgreSQL.cs 的 _pinned Map 对称,保持三引擎 C# 层 API 一致。
        private readonly object _txLock = new();
        private long _nextConnId;
        private long? _pinnedConnId;
        private Timer _txTimer;
        private const int TX_IDLE_MS = 30000;

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
            m_ConnectionLock = new ReaderWriterLockSlim();
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
                "Version=3"
            };
            foreach (var (key, val) in mergedOptions)
            {
                var sanitized = SanitizePragmaValue(key, val);
                parts.Add($"PRAGMA {key}={sanitized}");
            }
            var connStr = string.Join(";", parts);

            m_Connection = new SQLiteConnection(connStr, true);
            m_Connection.Open();
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
            m_Connection.Close();
            m_Connection.Dispose();
        }

        // for Electron
        public string ExecuteJson(string sql, IDictionary<string, object>? args = null)
        {
            var result = Execute(sql, args);
            return JsonSerializer.Serialize(result);
        }

        public object[][] Execute(string sql, IDictionary<string, object>? args = null, long? connId = null)
        {
            if (connId.HasValue) ResetTxTimer(connId.Value);
            m_ConnectionLock.EnterReadLock();
            try
            {
                using var command = new SQLiteCommand(sql, m_Connection);
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
            finally
            {
                m_ConnectionLock.ExitReadLock();
            }
        }

        public int ExecuteNonQuery(string sql, IDictionary<string, object>? args = null, long? connId = null)
        {
            if (connId.HasValue) ResetTxTimer(connId.Value);
            var result = -1;
            m_ConnectionLock.EnterWriteLock();
            try
            {
                using var command = new SQLiteCommand(sql, m_Connection);
                if (args != null)
                {
                    foreach (var arg in args)
                    {
                        command.Parameters.Add(new SQLiteParameter(arg.Key, arg.Value));
                    }
                }
                result = command.ExecuteNonQuery();
            }
            finally
            {
                m_ConnectionLock.ExitWriteLock();
            }

            return result;
        }

        /// <summary>
        /// Opens a fresh connection to the specified database file (or in-memory DB),
        /// executes the given SQL, and returns the result set serialized as a JSON array.
        /// The connection is closed (and disposed) after the query completes.
        ///
        /// This does NOT touch <see cref="m_Connection"/> — it is completely independent,
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
        /// This does NOT touch <see cref="m_Connection"/> — it is completely independent.
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

        // ── Transaction pinning ───────────────────────────────────────────
        // SQLite 单连接模式:BEGIN/COMMIT/ROLLBACK 通过 SQL 语句管理事务,
        // _pinnedConnId 单槽 + sliding Timer 仅用于防泄漏(与 PG 的
        // _pinned Map 对称,保持三引擎 C# API 一致)。

        /// <summary>
        /// 发 BEGIN 语句 + 标记 pinned + 启动 sliding 超时 Timer。
        /// 返回递增 connId 供 JS 传入后续 Execute/ExecuteNonQuery 重置 Timer。
        /// </summary>
        public long BeginTransaction()
        {
            lock (_txLock)
            {
                if (_pinnedConnId.HasValue)
                    throw new InvalidOperationException("事务进行中,不支持嵌套");
                var connId = Interlocked.Increment(ref _nextConnId);
                ExecuteNonQuery("BEGIN");
                _pinnedConnId = connId;
                _txTimer = new Timer(_ => OnTxTimeout(connId), null, TX_IDLE_MS, -1);
                return connId;
            }
        }

        /// <summary>
        /// 发 COMMIT 语句 + 清除 pin + 销毁 Timer。COMMIT 失败仍清 pin
        /// (连接已回到非事务态或已损坏,下次调用需重新 begin)。
        /// </summary>
        public void CommitTransaction(long connId)
        {
            lock (_txLock)
            {
                if (_pinnedConnId != connId)
                    throw new InvalidOperationException(
                        $"connId={connId} 已超时回滚或不存在,无法 commit");
                _txTimer?.Dispose();
                _pinnedConnId = null;
                try { ExecuteNonQuery("COMMIT"); }
                catch { /* COMMIT 失败:连接状态不确定,清 pin 让下次重试 */ }
            }
        }

        /// <summary>
        /// 发 ROLLBACK 语句 + 清除 pin + 销毁 Timer。connId 已超时回滚
        /// 时静默 no-op(与 PG 语义一致),withTransaction 的 catch 可
        /// 无条件调用。
        /// </summary>
        public void RollbackTransaction(long connId)
        {
            lock (_txLock)
            {
                if (_pinnedConnId != connId) return;  // 已超时,no-op
                _txTimer?.Dispose();
                _pinnedConnId = null;
                try { ExecuteNonQuery("ROLLBACK"); }
                catch { /* ROLLBACK 失败:忽略,连接可能已损坏 */ }
            }
        }

        private void ResetTxTimer(long connId)
        {
            lock (_txLock)
            {
                if (_pinnedConnId == connId && _txTimer != null)
                {
                    _txTimer.Change(TX_IDLE_MS, -1);
                }
            }
        }

        private void OnTxTimeout(long connId)
        {
            lock (_txLock)
            {
                if (_pinnedConnId != connId) return;
                Console.Error.WriteLine(
                    $"[SQLite] 事务 connId={connId} 空闲 {TX_IDLE_MS}ms,自动回滚");
                _txTimer?.Dispose();
                _pinnedConnId = null;
                try { ExecuteNonQuery("ROLLBACK"); } catch { }
            }
        }
    }
}
