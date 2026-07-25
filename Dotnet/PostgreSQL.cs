using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using Npgsql;

namespace VRCX
{
    /// <summary>
    /// PostgreSQL backend wrapper for VRCX.
    ///
    /// Mirrors the public surface of <see cref="SQLite"/> so that the JS adapter
    /// layer can call the same patterns (Execute/ExecuteNonQuery/ExecuteJson)
    /// against a PostgreSQL backend. Built on Npgsql 9.0+ and uses
    /// <see cref="NpgsqlDataSource"/> for connection pooling.
    ///
    /// Phase 9.1: add Npgsql package and create this class.
    /// Phase 9.2: field-based config, connection pooling, health checks.
    /// Phase 9.14: JS bridge registration + bootstrap wiring.
    /// </summary>
    public class PostgreSQL
    {
        public static PostgreSQL Instance;

        private NpgsqlDataSource _dataSource;
        private readonly ReaderWriterLockSlim _connectionLock;
        private bool _initialized;
        private DateTime _lastHealthCheck;
        private readonly TimeSpan _healthCheckInterval = TimeSpan.FromSeconds(30);

        // ── Transaction pinning ────────────────────────────────────────────
        // A pinned connection is borrowed from the pool and held across
        // multiple Execute/ExecuteNonQuery calls so that BEGIN ... INSERT
        // ... COMMIT run on the SAME physical connection (otherwise the
        // Npgsql pool returns a fresh connection per call and the
        // transaction silently no-ops — see docs/TRANSACTION_DESIGN.md).
        //
        // Sliding timeout: each use of a pinned connection resets the
        // timer (TX_IDLE_MS) so long-running transactions stay alive as
        // long as SQL keeps flowing; only a true stall (await hang,
        // network drop) triggers auto-rollback + return-to-pool.
        private readonly object _txLock = new();
        private readonly ConcurrentDictionary<long, TxHolder> _pinned = new();
        private long _nextConnId;
        private const int TX_IDLE_MS = 60000;

        private sealed class TxHolder
        {
            public NpgsqlConnection Conn = null!;
            public NpgsqlTransaction Tx = null!;
            public Timer Timer = null!;
            /// <summary>
            /// 正在执行 SQL 的计数。OnTxTimeout 检测到 InFlight &gt; 0 时
            /// 不立即回滚,设 TimedOut 标记让 ExecutePinned 的 finally
            /// 自行清理,避免 SQL 执行期间 Dispose 连接。
            /// </summary>
            public int InFlight;
            /// <summary>OnTxTimeout 已来过,等 SQL 执行完由 finally 清理。</summary>
            public bool TimedOut;
        }

        static PostgreSQL()
        {
            Instance = new PostgreSQL();
        }

        public PostgreSQL()
        {
            _connectionLock = new ReaderWriterLockSlim();
        }

        /// <summary>
        /// Initialize the pooled PostgreSQL data source from the
        /// <c>VRCX_Database.{host,port,username,password,name}</c> bootstrap fields.
        /// Each field is validated against a strict whitelist to prevent
        /// connection-string injection.
        /// </summary>
        public void Init()
        {
#if LINUX
            Instance = this;
#endif
            var host = ValidateField(
                "host",
                VRCXStorage.Instance.Get("VRCX_Database.host")?.Trim(),
                @"[A-Za-z0-9._-]");
            var port = ValidatePort(
                VRCXStorage.Instance.Get("VRCX_Database.port")?.Trim(),
                5432);
            var username = ValidateField(
                "username",
                VRCXStorage.Instance.Get("VRCX_Database.username")?.Trim(),
                @"[A-Za-z0-9._-]");
            var password = ValidatePassword(
                VRCXStorage.Instance.Get("VRCX_Database.password"));
            var name = ValidateField(
                "name",
                string.IsNullOrWhiteSpace(VRCXStorage.Instance.Get("VRCX_Database.name"))
                    ? "vrcx"
                    : VRCXStorage.Instance.Get("VRCX_Database.name").Trim(),
                @"[A-Za-z0-9_]");

            var connectionString =
                $"Host={host};Port={port};Username={username};Password={password};Database={name}"
                + ";Maximum Pool Size=100"      // 与 MySQL MaximumPoolSize=100 对称
                + ";Minimum Pool Size=1"        // 预热保活 1 条连接:池在空闲剪枝时不剪到
                                               // 低于 1,确保挂机数小时后下一次查询不必
                                               // 重建 TCP+认证(异地 PG 可达 200ms+)。
                                               // 建连是惰性的:Build() 不建连,首次
                                               // OpenConnectionAsync 才建到 min size,
                                               // 故 PG 不可达时 Init() 不会失败,失败
                                               // 推迟到首次 Open。与 MySQL 对称。
                + ";Connection Idle Lifetime=300" // 空闲 300s 自动回收(与 MySQL ConnectionIdleTimeout=300 对称)
                + ";Timeout=15"                 // 建连超时 15s(对称 MySQL ConnectionTimeout=15)
                + ";CommandTimeout=30";         // SQL 执行超时 30s(对称 MySQL DefaultCommandTimeout=30)

            var builder = new NpgsqlDataSourceBuilder(connectionString);
            _dataSource = builder.Build();
            _initialized = true;
        }

        /// <summary>
        /// Dispose the pooled data source. Safe to call even if Init() was
        /// never invoked.
        /// </summary>
        public void Exit()
        {
            _initialized = false;
            _dataSource?.Dispose();
        }

        // ── JSON helpers for the JS boundary ─────────────────────────────────

        /// <summary>
        /// Execute a query on the pooled connection and return the result set as JSON.
        /// </summary>
        /// <param name="connId">optional transaction pin id forwarded to <see cref="Execute"/>.</param>
        public string ExecuteJson(string sql, object[]? args = null, long? connId = null)
        {
            var result = Execute(sql, args, connId);
            return JsonSerializer.Serialize(result);
        }

        /// <summary>
        /// Execute a query on a fresh ad-hoc connection and return the result set as JSON.
        /// Used for external-database operations (e.g. data migration).
        /// </summary>
        public string ExecuteJson(string connectionString, string sql, object[]? args = null)
        {
            using var dataSource = NpgsqlDataSource.Create(connectionString);
            using var connection = dataSource.CreateConnection();
            connection.Open();
            var result = ExecuteCore(connection, sql, args);
            return JsonSerializer.Serialize(result);
        }

        // ── Query execution ──────────────────────────────────────────────────

        /// <summary>
        /// Execute a query on a fresh pooled connection and return rows as
        /// positional arrays. Parameters are positional (<c>$1</c>, <c>$2</c>,
        /// ...) and are bound from <paramref name="args"/> in order.
        /// </summary>
        /// <param name="connId">optional transaction pin id; when present
        /// the query runs on the pinned connection inside its transaction
        /// and resets the sliding idle timer.</param>
        public object[][] Execute(string sql, object[]? args = null, long? connId = null)
        {
            if (connId.HasValue)
            {
                return ExecutePinned(connId.Value, sql, args);
            }
            EnsureInitialized();
            using var connection = _dataSource.OpenConnection();
            return ExecuteCore(connection, sql, args);
        }

        /// <summary>
        /// Execute a non-query on a fresh pooled connection and return rows affected.
        /// </summary>
        /// <param name="connId">optional transaction pin id; when present
        /// the statement runs on the pinned connection inside its
        /// transaction and resets the sliding idle timer.</param>
        public int ExecuteNonQuery(string sql, object[]? args = null, long? connId = null)
        {
            if (connId.HasValue)
            {
                return ExecuteNonQueryPinned(connId.Value, sql, args);
            }
            EnsureInitialized();
            using var connection = _dataSource.OpenConnection();
            using var command = CreateCommand(connection, sql, args);
            return command.ExecuteNonQuery();
        }

        /// <summary>
        /// Execute a non-query on a fresh ad-hoc connection and return rows affected.
        /// Used for external-database operations (e.g. data migration).
        /// </summary>
        public int ExecuteNonQuery(string connectionString, string sql, object[]? args = null)
        {
            using var dataSource = NpgsqlDataSource.Create(connectionString);
            using var connection = dataSource.CreateConnection();
            connection.Open();
            using var command = CreateCommand(connection, sql, args);
            return command.ExecuteNonQuery();
        }

        // ── Health checks ────────────────────────────────────────────────────

        /// <summary>
        /// Return true when the data source has been initialized.
        /// Does not probe the network — callers needing a real liveness
        /// check should use <see cref="Ping"/> (SELECT 1) or
        /// <see cref="GetHealth"/> (SELECT 1 + JSON latency snapshot).
        /// </summary>
        public bool IsConnected()
        {
            return _initialized && _dataSource != null;
        }

        /// <summary>
        /// Probe the server with <c>SELECT 1</c> and return a JSON health
        /// snapshot: <c>{ connected, latencyMs, lastHealthCheck }</c>.
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
                    using var conn = _dataSource.OpenConnection();
                    using var cmd = conn.CreateCommand();
                    cmd.CommandText = "SELECT 1";
                    cmd.ExecuteScalar();
                    sw.Stop();
                    latencyMs = sw.ElapsedMilliseconds;
                    _lastHealthCheck = DateTime.Now;
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
        /// Lightweight liveness probe. Returns true when <c>SELECT 1</c>
        /// succeeds against the pooled data source.
        /// </summary>
        public bool Ping()
        {
            try
            {
                using var conn = _dataSource.OpenConnection();
                using var cmd = conn.CreateCommand();
                cmd.CommandText = "SELECT 1";
                cmd.ExecuteScalar();
                _lastHealthCheck = DateTime.Now;
                return true;
            }
            catch
            {
                return false;
            }
        }

        // ── Core implementation ──────────────────────────────────────────────

        private static object[][] ExecuteCore(NpgsqlConnection connection, string sql, object[]? args)
        {
            using var command = CreateCommand(connection, sql, args);
            using var reader = command.ExecuteReader();

            var result = new List<object[]>();
            while (reader.Read())
            {
                var values = new object[reader.FieldCount];
                for (var i = 0; i < reader.FieldCount; i++)
                {
                    var value = reader.GetValue(i);
                    values[i] = value is DBNull ? null : value;
                }
                result.Add(values);
            }

            return result.ToArray();
        }

        private static NpgsqlCommand CreateCommand(NpgsqlConnection connection, string sql, object[]? args)
        {
            var command = connection.CreateCommand();
            command.CommandText = sql;
            if (args != null)
            {
                foreach (var arg in args)
                {
                    // Npgsql infers the parameter name from position when the
                    // command text uses $1, $2, ... placeholders.
                    command.Parameters.AddWithValue(null, arg ?? DBNull.Value);
                }
            }
            return command;
        }

        // ── Transaction pinning implementation ───────────────────────────────
        // See the field declarations at the top of this class for the design
        // rationale. BeginTransaction borrows a connection from the pool and
        // holds it in a TxHolder; ExecutePinned/ExecuteNonQueryPinned look up
        // the holder by connId and run SQL on the held connection, resetting
        // the sliding idle timer on each use. CommitTransaction/
        // RollbackTransaction finalise the transaction and return the
        // connection to the pool. The sliding timer auto-rolls-back any
        // transaction idle for longer than TX_IDLE_MS to prevent connection
        // leaks if JS forgets to commit (crash, unhandled rejection, etc.).

        private static NpgsqlCommand CreateTxCommand(TxHolder h, string sql, object[]? args)
        {
            var command = h.Conn.CreateCommand();
            command.Transaction = h.Tx;
            command.CommandText = sql;
            if (args != null)
            {
                foreach (var arg in args)
                {
                    command.Parameters.AddWithValue(null, arg ?? DBNull.Value);
                }
            }
            return command;
        }

        /// <summary>
        /// 回滚并释放一条已超时的事务连接。调用方必须持有 _txLock 且
        /// 已从 _pinned 中 TryRemove 出 holder。Timer 由调用方 Dispose。
        /// </summary>
        private static void CleanupTx(TxHolder h)
        {
            try { h.Tx.Rollback(); } catch { /* 可能已超时回滚 */ }
            try { h.Conn.Dispose(); } catch { }
        }

        private object[][] ExecutePinned(long connId, string sql, object[]? args)
        {
            if (!_pinned.TryGetValue(connId, out var h))
                throw new InvalidOperationException(
                    $"connId={connId} 已超时回滚或不存在,请重试事务");
            // 暂停 Timer 防止慢查询(SQL 执行中)触发超时回滚。
            // InFlight 标记让 OnTxTimeout 知道 SQL 正在跑,不立即
            // Dispose 连接,而是设 TimedOut 让本方法的 finally 自行清理。
            Interlocked.Increment(ref h.InFlight);
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
                        var value = reader.GetValue(i);
                        values[i] = value is DBNull ? null : value;
                    }
                    result.Add(values);
                }
                return result.ToArray();
            }
            finally
            {
                Interlocked.Decrement(ref h.InFlight);
                lock (_txLock)
                {
                    if (h.TimedOut)
                    {
                        // OnTxTimeout 在 SQL 执行期间来过,当时没清理
                        // (InFlight > 0),现在由 finally 收尾。
                        _pinned.TryRemove(connId, out _);
                        h.Timer.Dispose();
                        CleanupTx(h);
                    }
                    else
                    {
                        h.Timer.Change(TX_IDLE_MS, -1);
                    }
                }
            }
        }

        private int ExecuteNonQueryPinned(long connId, string sql, object[]? args)
        {
            if (!_pinned.TryGetValue(connId, out var h))
                throw new InvalidOperationException(
                    $"connId={connId} 已超时回滚或不存在,请重试事务");
            Interlocked.Increment(ref h.InFlight);
            lock (_txLock) { h.Timer.Change(Timeout.Infinite, -1); }
            try
            {
                using var command = CreateTxCommand(h, sql, args);
                return command.ExecuteNonQuery();
            }
            finally
            {
                Interlocked.Decrement(ref h.InFlight);
                lock (_txLock)
                {
                    if (h.TimedOut)
                    {
                        _pinned.TryRemove(connId, out _);
                        h.Timer.Dispose();
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
            var conn = _dataSource.OpenConnection();
            var tx = conn.BeginTransaction();
            var holder = new TxHolder { Conn = conn, Tx = tx };
            holder.Timer = new Timer(
                _ => OnTxTimeout(connId), null, TX_IDLE_MS, -1);
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
                try { h.Tx.Commit(); }
                finally { h.Conn.Dispose(); }
            }
        }

        /// <summary>
        /// ROLLBACK the transaction pinned to <paramref name="connId"/> and
        /// return the connection to the pool. No-op (does not throw) if the
        /// connId has already been timed out / rolled back, so the JS-side
        /// withTransaction catch block can call it unconditionally.
        /// </summary>
        public void RollbackTransaction(long connId)
        {
            lock (_txLock)
            {
                if (!_pinned.TryRemove(connId, out var h)) return;
                h.Timer.Dispose();
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
                    $"[PG] 事务 connId={connId} 空闲 {TX_IDLE_MS}ms,自动回滚");
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
                CleanupTx(h);
            }
        }

        // ── Bootstrap field validation ───────────────────────────────────────

        private static string ValidateField(string name, string value, string allowCharsPattern)
        {
            if (string.IsNullOrEmpty(value))
                throw new InvalidOperationException($"VRCX_Database.{name} is not set");
            if (value.IndexOfAny(new[] { ';', '\'', '"', '\0', '\n', '\r' }) >= 0)
                throw new InvalidOperationException($"VRCX_Database.{name} contains invalid characters");
            if (!Regex.IsMatch(value, "^" + allowCharsPattern + "+$"))
                throw new InvalidOperationException(
                    $"VRCX_Database.{name} has invalid characters (allowed: {allowCharsPattern})");
            return value;
        }

        private static string ValidatePassword(string password)
        {
            if (string.IsNullOrEmpty(password))
                throw new InvalidOperationException("VRCX_Database.password is not set");
            if (password.IndexOfAny(new[] { ';', '\'', '"', '\0' }) >= 0)
                throw new InvalidOperationException("VRCX_Database.password contains invalid characters");
            return password;
        }

        private static int ValidatePort(string portStr, int @default)
        {
            if (string.IsNullOrEmpty(portStr))
                return @default;
            if (!int.TryParse(portStr, out int port) || port < 1 || port > 65535)
                throw new InvalidOperationException($"VRCX_Database.port is invalid: {portStr}");
            return port;
        }

        private void EnsureInitialized()
        {
            if (_initialized)
                return;
            _connectionLock.EnterWriteLock();
            try
            {
                if (!_initialized)
                    Init();
            }
            finally
            {
                _connectionLock.ExitWriteLock();
            }
        }
    }
}
