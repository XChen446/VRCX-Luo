using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
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

        private MySqlDataSource _dataSource;
        private bool _initialized;

        // ── Pool metrics (三态连接池监控,Issue #14) ───────────────────────
        private int _totalBorrowed;
        private int _activeCount;
        private int _pinnedActive;
        private int _maxPoolSize;
        private DateTime _lastHealthCheck;

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
            /// <summary>
            /// 正在执行 SQL 的计数。所有读写都在 _txLock 内,锁提供
            /// happens-before,无需 Interlocked/volatile。OnTxTimeout
            /// 检测到 InFlight &gt; 0 时不立即回滚,设 TimedOut 标记让
            /// ExecutePinned 的 finally 自行清理,避免 SQL 执行期间
            /// Dispose 连接。
            /// </summary>
            public int InFlight;
            /// <summary>OnTxTimeout 已来过,等 SQL 执行完由 finally 清理。</summary>
            public bool TimedOut;
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
                // 池上限 100,下限 1(预热保活),空闲连接保留 300 秒(与 PG Npgsql
                // 池对齐)。Min=1 保证挂机数小时后下一次查询不必重建 TCP+认证
                // (异地 MySQL 可达 200ms+);建连是惰性的,CreatePool() 不建连,
                // 首次 Open 才建到 min size,故 MySQL 不可达时 Init() 不会失败,
                // 失败推迟到首次 Open。ConnectionIdleTimeout 只回收超出 min 的
                // idle 连接,min 条常驻不受影响。
                Pooling = true,
                MaximumPoolSize = 100,
                MinimumPoolSize = 1,
                ConnectionIdleTimeout = 300
            };

            ApplyUserOptions(builder);

            _dataSource = new MySqlDataSource(builder.ConnectionString);
            _maxPoolSize = (int)builder.MaximumPoolSize;
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
            _dataSource?.Dispose();
            _dataSource = null;
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
            return _initialized && _dataSource != null;
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
                Interlocked.Increment(ref _totalBorrowed);
                using var connection = _dataSource.OpenConnection();
                try
                {
                    using var cmd = connection.CreateCommand();
                    cmd.CommandText = "SELECT 1";
                    cmd.ExecuteScalar();
                    return true;
                }
                finally
                {
                    Interlocked.Decrement(ref _totalBorrowed);
                }
            }
            catch
            {
                return false;
            }
        }

        /// <summary>
        /// Probe the server with <c>SELECT 1</c> and return a JSON health
        /// snapshot: <c>{ connected, latencyMs, lastHealthCheck }</c>.
        /// Symmetric to <see cref="PostgreSQL.GetHealth"/>.
        /// </summary>
        public string GetHealth()
        {
            bool connected = IsConnected();
            long latencyMs = -1;
            if (connected)
            {
                try
                {
                    var sw = Stopwatch.StartNew();
                    Interlocked.Increment(ref _totalBorrowed);
                    using var conn = _dataSource.OpenConnection();
                    try
                    {
                        using var cmd = conn.CreateCommand();
                        cmd.CommandText = "SELECT 1";
                        cmd.ExecuteScalar();
                        sw.Stop();
                        latencyMs = sw.ElapsedMilliseconds;
                        _lastHealthCheck = DateTime.Now;
                    }
                    finally
                    {
                        Interlocked.Decrement(ref _totalBorrowed);
                    }
                }
                catch
                {
                    connected = false;
                }
            }

            var health = new
            {
                connected,
                latencyMs,
                lastHealthCheck = _lastHealthCheck == default
                    ? null
                    : _lastHealthCheck.ToString("o")
            };
            return JsonSerializer.Serialize(health);
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
            Interlocked.Increment(ref _totalBorrowed);
            using var connection = _dataSource.OpenConnection();
            try
            {
                Interlocked.Increment(ref _activeCount);
                try
                {
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
                    return result.ToArray();
                }
                finally
                {
                    Interlocked.Decrement(ref _activeCount);
                }
            }
            finally
            {
                Interlocked.Decrement(ref _totalBorrowed);
            }
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
            Interlocked.Increment(ref _totalBorrowed);
            using var connection = _dataSource.OpenConnection();
            try
            {
                Interlocked.Increment(ref _activeCount);
                try
                {
                    using var command = new MySqlCommand(sql, connection);
                    AddParameters(command, args);
                    return command.ExecuteNonQuery();
                }
                finally
                {
                    Interlocked.Decrement(ref _activeCount);
                }
            }
            finally
            {
                Interlocked.Decrement(ref _totalBorrowed);
            }
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
            using var dataSource = new MySqlDataSource(connectionString);
            using var connection = dataSource.OpenConnection();

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
            using var dataSource = new MySqlDataSource(connectionString);
            using var connection = dataSource.OpenConnection();

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
            if (!_initialized || _dataSource == null)
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

        /// <summary>
        /// 回滚并释放一条已超时的事务连接。调用方必须持有 _txLock 且
        /// 已从 _pinned 中 TryRemove 出 holder。Timer 由调用方 Dispose。
        /// </summary>
        private static void CleanupTx(TxHolder h)
        {
            try
            {
                using var cmd = h.Conn.CreateCommand();
                cmd.CommandText = "ROLLBACK";
                cmd.ExecuteNonQuery();
            } catch { /* 可能已超时回滚 */ }
            try { h.Conn.Dispose(); } catch { }
        }

        private object[][] ExecutePinned(long connId, string sql, IDictionary<string, object>? args)
        {
            // 暂停 Timer 防止慢查询(SQL 执行中)触发超时回滚。
            // InFlight 标记让 OnTxTimeout 知道 SQL 正在跑,不立即
            // Dispose 连接,而是设 TimedOut 让本方法的 finally 自行清理。
            // TryGetValue 与 InFlight++/Timer.Change 必须在同一 _txLock 内,
            // 否则 OnTxTimeout 可能在两者之间排队看到 InFlight=0 立即清理,
            // 随后本方法拿到 h.Conn 时已被 Dispose → ObjectDisposedException,
            // 且 _activeCount/_pinnedActive 永久泄漏(finally 不执行)。
            TxHolder h;
            lock (_txLock)
            {
                if (!_pinned.TryGetValue(connId, out h))
                    throw new InvalidOperationException(
                        $"connId={connId} 已超时回滚或不存在,请重试事务");
                h.InFlight++;
                Interlocked.Increment(ref _activeCount);
                Interlocked.Increment(ref _pinnedActive);
                h.Timer.Change(Timeout.Infinite, -1);
            }
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
                lock (_txLock)
                {
                    h.InFlight--;
                    Interlocked.Decrement(ref _activeCount);
                    Interlocked.Decrement(ref _pinnedActive);
                    if (h.TimedOut)
                    {
                        _pinned.TryRemove(connId, out _);
                        h.Timer.Dispose();
                        Interlocked.Decrement(ref _totalBorrowed);
                        CleanupTx(h);
                    }
                    else
                    {
                        h.Timer.Change(TX_IDLE_MS, -1);
                    }
                }
            }
        }

        private int ExecuteNonQueryPinned(long connId, string sql, IDictionary<string, object>? args)
        {
            TxHolder h;
            lock (_txLock)
            {
                if (!_pinned.TryGetValue(connId, out h))
                    throw new InvalidOperationException(
                        $"connId={connId} 已超时回滚或不存在,请重试事务");
                h.InFlight++;
                Interlocked.Increment(ref _activeCount);
                Interlocked.Increment(ref _pinnedActive);
                h.Timer.Change(Timeout.Infinite, -1);
            }
            try
            {
                using var command = CreateTxCommand(h, sql, args);
                return command.ExecuteNonQuery();
            }
            finally
            {
                lock (_txLock)
                {
                    h.InFlight--;
                    Interlocked.Decrement(ref _activeCount);
                    Interlocked.Decrement(ref _pinnedActive);
                    if (h.TimedOut)
                    {
                        _pinned.TryRemove(connId, out _);
                        h.Timer.Dispose();
                        Interlocked.Decrement(ref _totalBorrowed);
                        CleanupTx(h);
                    }
                    else
                    {
                        h.Timer.Change(TX_IDLE_MS, -1);
                    }
                }
            }
        }

        /// <summary>
        /// Borrow a pooled connection, BEGIN a transaction on it, and return
        /// a connId that JS passes back on subsequent Execute/ExecuteNonQuery
        /// calls to keep them on the same physical connection. A sliding
        /// idle timer auto-rolls-back after TX_IDLE_MS of inactivity.
        /// JS 侧应在事务内长时间非 DB await 前调 keepAlive() 提前续命,
        /// 而非"卡着 60s 的点回来打卡"——临近超时才发 SQL 会进入
        /// Timer 回调与 SQL 执行的竞态窗口(虽有 InFlight 防御不崩,
        /// 但事务仍会被判定超时回滚)。
        /// </summary>
        public long BeginTransaction()
        {
            EnsureInitialized();
            var connId = Interlocked.Increment(ref _nextConnId);
            Interlocked.Increment(ref _totalBorrowed);
            var conn = _dataSource.OpenConnection();
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
                    Interlocked.Decrement(ref _totalBorrowed);
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
                Interlocked.Decrement(ref _totalBorrowed);
                CleanupTx(h);
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
                if (!_pinned.TryGetValue(connId, out var h)) return;
                Console.Error.WriteLine(
                    $"[MySQL] 事务 connId={connId} 空闲 {TX_IDLE_MS}ms,自动回滚");
                if (h.InFlight > 0)
                {
                    // SQL 正在执行(ExecutePinned 的 ExecuteReader 未返回),
                    // 不能现在 Dispose 连接,否则 ObjectDisposedException。
                    // 设标记,让 ExecutePinned 的 finally 检测到后自行清理。
                    h.TimedOut = true;
                    return;
                }
                _pinned.TryRemove(connId, out _);
                h.Timer.Dispose();
                Interlocked.Decrement(ref _totalBorrowed);
                CleanupTx(h);
            }
        }

        // ── Pool stats ──────────────────────────────────────────────────────

        /// <summary>
        /// 返回当前连接池的三态 + 扩展快照,纯内存计数器读取,不涉及网络调用。
        /// JS 侧每秒采样一次,用于底部栏三色波线展示(Issue #14)。
        ///
        /// 基础字段(所有引擎对称,JS 主用):
        ///   active            = 正在执行 SQL 的连接数(pinned + 非 pinned)
        ///   pinnedIdle        = 事务持有但未执行 SQL 的连接数
        ///   availableCapacity = 可用容量(_maxPoolSize - _totalBorrowed)
        ///   max               = 连接池上限
        ///
        /// 扩展字段(冗余校验,驱动版本变化可能失效,UI 不强依赖):
        ///   totalOpen  = 池中当前存活的物理连接总数(MySQL 估算,无公开 API)
        ///   idleInPool = 池中存活且空闲的物理连接数(MySQL 估算,无公开 API)
        /// MySqlConnector 公开 API 不暴露 idle/total 计数(仅 IsEmpty 布尔),
        /// 反射 internal m_leasedSessions 强耦合驱动实现、版本易碎,故用估算:
        ///   totalOpen  = active + pinnedIdle + availableCapacity  (下界)
        ///   idleInPool = availableCapacity  (空闲时偏高的下界)
        /// 实际 idle-in-pool ≤ availableCapacity(可能因 ConnectionIdleTimeout
        /// 被驱动 prune,但应用层不可见)。桌面负载下两者多数时刻相等。
        /// 上层 JS 主用基础字段自算 idleInPool = totalOpen - active - pinnedIdle。
        /// </summary>
        public string GetPoolStats()
        {
            var active = _activeCount;
            var pinnedIdle = _pinned.Count - _pinnedActive;
            var availableCapacity = _maxPoolSize - _totalBorrowed;
            var totalOpen = active + pinnedIdle + availableCapacity;
            var idleInPool = availableCapacity;
            var stats = new
            {
                active,
                pinnedIdle,
                availableCapacity,
                max = _maxPoolSize,
                totalOpen,
                idleInPool
            };
            return JsonSerializer.Serialize(stats);
        }

        /// <summary>
        /// Clear idle connections from the pool. MySqlConnector's
        /// ClearAllPools() only drops idle connections; busy connections
        /// are unaffected and continue to work normally.
        /// </summary>
        public void ClearIdleConnections()
        {
            MySqlConnection.ClearAllPools();
        }
    }
}
