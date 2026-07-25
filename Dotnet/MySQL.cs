using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading;
using MySqlConnector;

namespace VRCX
{
    /// <summary>
    /// MySQL / MariaDB connection manager and query executor.
    ///
    /// Mirrors the public surface of <see cref="PostgreSQL"/> so that the JS
    /// adapter layer can switch engines without changing its call shape:
    ///   - Init() reads VRCX_Database.* config and builds the connection string.
    ///   - Exit() clears the connection string (pool stays alive until process exit).
    ///   - Execute/ExecuteNonQuery/ExecuteJson run parameterised SQL on a fresh
    ///     pooled connection each call (MySqlConnector pools automatically via the
    ///     connection string; `using` returns the connection to the pool).
    ///
    /// Built on MySqlConnector, which natively supports both MySQL and
    /// MariaDB (protocol-compatible). Both 'mysql' and 'mariadb' modes
    /// route to this class. No engine-specific branching is needed — the
    /// SQL dialect, connection string format, and error codes are
    /// identical across both servers.
    ///
    /// Transaction pinning: BeginTransaction borrows a pooled connection and
    /// holds it in a TxHolder across multiple Execute/ExecuteNonQuery calls so
    /// that BEGIN ... INSERT ... COMMIT run on the SAME physical connection.
    /// A sliding idle timer (TX_IDLE_MS) auto-rolls-back if JS forgets to
    /// commit. See docs/TRANSACTION_DESIGN.md.
    /// </summary>
    public class MySQL
    {
        public static MySQL Instance;

        private string _connectionString;
        private bool _initialized;

        // ── Transaction pinning ────────────────────────────────────────────
        // 与 PostgreSQL.cs 对称:_pinned Map 持有借出的连接,sliding Timer
        // 防泄漏。connId 有值时 Execute/ExecuteNonQuery 走 pinned 连接 +
        // 重置 Timer;无值时走池自动派发。
        private readonly object _txLock = new();
        private readonly ConcurrentDictionary<long, TxHolder> _pinned = new();
        private long _nextConnId;
        private const int TX_IDLE_MS = 60000;

        private sealed class TxHolder
        {
            public MySqlConnection Conn = null!;
            public Timer Timer = null!;
        }

        static MySQL()
        {
            Instance = new MySQL();
        }

        public MySQL()
        {
        }

        /// <summary>
        /// Initialises the shared MySQL/MariaDB connection from VRCX_Database.*
        /// configuration keys. Required keys: host, name (database/schema);
        /// defaults are applied for port (3306), username, password and
        /// common connector options.
        /// </summary>
        public void Init()
        {
#if LINUX
            Instance = this;
#endif
            var host = VRCXStorage.Instance.Get("VRCX_Database.host");
            var portStr = VRCXStorage.Instance.Get("VRCX_Database.port");
            var username = VRCXStorage.Instance.Get("VRCX_Database.username");
            var password = VRCXStorage.Instance.Get("VRCX_Database.password");
            var database = VRCXStorage.Instance.Get("VRCX_Database.name");

            if (string.IsNullOrWhiteSpace(host))
            {
                throw new InvalidOperationException(
                    "VRCX_Database.host is required when VRCX_Database.mode is 'mysql'.");
            }

            if (string.IsNullOrWhiteSpace(database))
            {
                throw new InvalidOperationException(
                    "VRCX_Database.name (MySQL database/schema) is required when VRCX_Database.mode is 'mysql'.");
            }

            if (!int.TryParse(portStr, out var port) || port <= 0)
            {
                port = 3306;
            }

            var builder = new MySqlConnectionStringBuilder
            {
                Server = host,
                Port = (uint)port,
                UserID = username,
                Password = password,
                Database = database,
                AllowUserVariables = false,
                UseAffectedRows = true,
                SslMode = MySqlSslMode.Preferred,
                ConnectionTimeout = 15,
                DefaultCommandTimeout = 30,
                // MySqlConnector 默认启用池化;显式设置 Pooling=True 让意图清晰。
                // 池大小默认 100,空闲连接保留 300 秒(与 PG Npgsql 池对齐)。
                Pooling = true,
                MaximumPoolSize = 100,
                ConnectionIdleTimeout = 300
            };

            ApplyUserOptions(builder);

            _connectionString = builder.ConnectionString;
            _initialized = true;
        }

        /// <summary>
        /// Merges VRCX_Database.options.* entries into the connection string.
        /// Keys starting with '_' are treated as comments/placeholders and
        /// ignored, matching the SQLite option semantics.
        /// </summary>
        private static void ApplyUserOptions(MySqlConnectionStringBuilder builder)
        {
            const string prefix = "VRCX_Database.options.";
            var userOptions = VRCXStorage.Instance.GetWithPrefix(prefix);

            foreach (var (key, val) in userOptions)
            {
                if (key.StartsWith("_"))
                    continue;

                switch (key.ToLowerInvariant())
                {
                    case "sslmode":
                        if (Enum.TryParse<MySqlSslMode>(val, true, out var sslMode))
                            builder.SslMode = sslMode;
                        break;
                    case "allowuservariables":
                        if (bool.TryParse(val, out var allowUserVariables))
                            builder.AllowUserVariables = allowUserVariables;
                        break;
                    case "useaffectedrows":
                        if (bool.TryParse(val, out var useAffectedRows))
                            builder.UseAffectedRows = useAffectedRows;
                        break;
                    case "connectiontimeout":
                        if (int.TryParse(val, out var connectionTimeout) && connectionTimeout > 0)
                            builder.ConnectionTimeout = (uint)connectionTimeout;
                        break;
                    case "defaultcommandtimeout":
                        if (int.TryParse(val, out var commandTimeout) && commandTimeout > 0)
                            builder.DefaultCommandTimeout = (uint)commandTimeout;
                        break;
                }
            }
        }

        /// <summary>
        /// Clears the connection string + initialised flag. The
        /// MySqlConnector pool stays alive until process exit (connections
        /// in the pool are returned lazily); new calls after Exit() will
        /// fail with a "not initialised" error.
        /// </summary>
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
        }

        /// <summary>
        /// Reports whether the backend has been initialised. Mirrors
        /// <see cref="PostgreSQL.IsConnected"/> so the renderer-side
        /// <c>testMysqlConnection</c> store action can probe backend health
        /// symmetrically with PostgreSQL. Does not probe the network —
        /// callers use <see cref="Ping"/> for a liveness check.
        /// </summary>
        /// <returns><c>true</c> if initialised with a connection string.</returns>
        public bool IsConnected()
        {
            return _initialized && !string.IsNullOrEmpty(_connectionString);
        }

        /// <summary>
        /// Lightweight liveness probe. Symmetric to <see cref="PostgreSQL.Ping"/>.
        /// Opens a pooled connection and executes <c>SELECT 1</c>; returns
        /// <c>true</c> on success, <c>false</c> on any failure (server down,
        /// auth rejected, network unreachable). Worst-case latency when the
        /// server is unreachable is bounded by <c>ConnectionTimeout</c>
        /// (default 15s).
        /// </summary>
        /// <remarks>
        /// Prefer this over <see cref="IsConnected"/> when the caller needs to
        /// confirm the backend is actually reachable, not just initialised —
        /// e.g. the renderer-side <c>testMysqlConnection</c> store action and
        /// the push/pull engine fail-fast guards.
        /// </remarks>
        /// <returns><c>true</c> when <c>SELECT 1</c> succeeds against the pool.</returns>
        public bool Ping()
        {
            try
            {
                using var connection = new MySqlConnection(_connectionString);
                connection.Open();
                using var cmd = connection.CreateCommand();
                cmd.CommandText = "SELECT 1";
                cmd.ExecuteScalar();
                return true;
            }
            catch
            {
                return false;
            }
        }

        /// <summary>
        /// Executes a SELECT/PRAGMA-like statement and returns the result set
        /// serialised as a JSON string. Used by the Linux/Electron JS bridge.
        /// </summary>
        public string ExecuteJson(string sql, IDictionary<string, object>? args = null, long? connId = null)
        {
            var result = Execute(sql, args, connId);
            return JsonSerializer.Serialize(result);
        }

        /// <summary>
        /// Execute a query on a fresh pooled connection and return rows as
        /// positional arrays. When <paramref name="connId"/> is present the
        /// query runs on the pinned transaction connection + resets the
        /// sliding idle timer.
        /// </summary>
        public object[][] Execute(string sql, IDictionary<string, object>? args = null, long? connId = null)
        {
            if (connId.HasValue)
            {
                return ExecutePinned(connId.Value, sql, args);
            }
            EnsureInitialized();
            using var connection = new MySqlConnection(_connectionString);
            connection.Open();
            using var command = new MySqlCommand(sql, connection);
            AddParameters(command, args);

            using var reader = command.ExecuteReader();
            var result = new List<object[]>();
            while (reader.Read())
            {
                var values = new object[reader.FieldCount];
                for (var i = 0; i < reader.FieldCount; i++)
                {
                    // IsDBNull guard: DBNull.Value serialises to "{}" via
                    // System.Text.Json and is the wrong value for the JS
                    // bridge. Map NULL columns to null explicitly so both
                    // the CefSharp (object[][]) and JSON entry points see
                    // JS null instead of an empty object.
                    values[i] = reader.IsDBNull(i) ? null : reader.GetValue(i);
                }
                result.Add(values);
            }
            return result.ToArray();
        }

        /// <summary>
        /// Execute a non-query on a fresh pooled connection and return rows
        /// affected. When <paramref name="connId"/> is present the statement
        /// runs on the pinned transaction connection + resets the timer.
        /// </summary>
        public int ExecuteNonQuery(string sql, IDictionary<string, object>? args = null, long? connId = null)
        {
            if (connId.HasValue)
            {
                return ExecuteNonQueryPinned(connId.Value, sql, args);
            }
            EnsureInitialized();
            using var connection = new MySqlConnection(_connectionString);
            connection.Open();
            using var command = new MySqlCommand(sql, connection);
            AddParameters(command, args);
            return command.ExecuteNonQuery();
        }

        /// <summary>
        /// Opens a fresh connection from the given connection string, executes
        /// a query, and returns the result set as JSON. The connection is
        /// closed after the query completes.
        ///
        /// This does NOT touch the pooled connection — it is completely
        /// independent, intended for querying an EXTERNAL database (e.g.
        /// during migration).
        /// </summary>
        public string ExecuteJson(string connectionString, string sql, IDictionary<string, object>? args = null)
        {
            using var connection = new MySqlConnection(connectionString);
            connection.Open();

            using var command = new MySqlCommand(sql, connection);
            AddParameters(command, args);

            using var reader = command.ExecuteReader();
            var result = new List<object[]>();
            while (reader.Read())
            {
                var values = new object[reader.FieldCount];
                for (var i = 0; i < reader.FieldCount; i++)
                {
                    values[i] = reader.IsDBNull(i) ? null : reader.GetValue(i);
                }
                result.Add(values);
            }

            return JsonSerializer.Serialize(result);
        }

        /// <summary>
        /// Opens a fresh connection from the given connection string, executes
        /// a non-query, and returns the number of rows affected. The connection
        /// is closed after the query completes.
        ///
        /// This does NOT touch the pooled connection — it is completely
        /// independent.
        /// </summary>
        public int ExecuteNonQuery(string connectionString, string sql, IDictionary<string, object>? args = null)
        {
            using var connection = new MySqlConnection(connectionString);
            connection.Open();

            using var command = new MySqlCommand(sql, connection);
            AddParameters(command, args);

            return command.ExecuteNonQuery();
        }

        /// <summary>
        /// Adds named parameters to a command. Keys may already carry a '@' or
        /// '?' marker; if not, '@' is prepended to match MySqlConnector's
        /// named-parameter convention.
        /// </summary>
        private static void AddParameters(MySqlCommand command, IDictionary<string, object>? args)
        {
            if (args == null)
                return;

            foreach (var arg in args)
            {
                var name = arg.Key;
                if (!name.StartsWith("@") && !name.StartsWith("?"))
                    name = "@" + name;

                command.Parameters.AddWithValue(name, arg.Value ?? DBNull.Value);
            }
        }

        // ── Transaction pinning implementation ───────────────────────────────
        // 与 PostgreSQL.cs 对称:BeginTransaction 借一条 pooled 连接,持有在
        // TxHolder 中;ExecutePinned/ExecuteNonQueryPinned 按 connId 查 holder,
        // 在持有的连接上执行 SQL + 重置 sliding timer;Commit/Rollback 终结
        // 事务并还池。sliding timer 自动回滚空闲超时的事务防泄漏。

        private void EnsureInitialized()
        {
            if (!_initialized || string.IsNullOrEmpty(_connectionString))
                throw new InvalidOperationException(
                    "MySQL backend not initialised. Call Init() first.");
        }

        private static MySqlCommand CreateTxCommand(TxHolder h, string sql, IDictionary<string, object>? args)
        {
            var command = h.Conn.CreateCommand();
            command.CommandText = sql;
            AddParameters(command, args);
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
                        values[i] = reader.IsDBNull(i) ? null : reader.GetValue(i);
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
        /// a connId that JS passes back on subsequent Execute/ExecuteNonQuery
        /// calls to keep them on the same physical connection. A sliding
        /// idle timer auto-rolls-back after TX_IDLE_MS of inactivity.
        /// </summary>
        public long BeginTransaction()
        {
            EnsureInitialized();
            var connId = Interlocked.Increment(ref _nextConnId);
            var conn = new MySqlConnection(_connectionString);
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
        /// COMMIT the transaction pinned to <paramref name="connId"/> and
        /// return the connection to the pool. Throws if the connId has
        /// already been timed out / rolled back.
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
        /// ROLLBACK the transaction pinned to <paramref name="connId"/> and
        /// return the connection to the pool. No-op if the connId has
        /// already been timed out / rolled back.
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

        /// <summary>
        /// Reset the sliding idle timer for the transaction pinned to
        /// <paramref name="connId"/> without executing any SQL. Use this
        /// when the JS side needs to await a long-running non-DB operation
        /// (e.g. user confirmation dialog) inside a withTransaction block
        /// to prevent the 60s idle timeout from auto-rolling-back.
        /// </summary>
        /// <returns><c>true</c> if the timer was reset; <c>false</c> if the
        /// connId has already timed out / rolled back (no-op).</returns>
        public bool KeepAliveTransaction(long connId)
        {
            lock (_txLock)
            {
                if (_pinned.TryGetValue(connId, out var h))
                {
                    h.Timer.Change(TX_IDLE_MS, -1);
                    return true;
                }
                return false;
            }
        }

        private void OnTxTimeout(long connId)
        {
            lock (_txLock)
            {
                if (!_pinned.TryRemove(connId, out var h)) return;
                Console.Error.WriteLine(
                    $"[MySQL] 事务 connId={connId} 空闲 {TX_IDLE_MS}ms,自动回滚");
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
