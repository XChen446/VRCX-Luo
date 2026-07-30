using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Reflection;
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
    public class PostgreSQL : IAuthStore
    {
        public static PostgreSQL Instance;

        private NpgsqlDataSource _dataSource;
        private readonly ReaderWriterLockSlim _connectionLock;
        private bool _initialized;
        private DateTime _lastHealthCheck;
        private readonly TimeSpan _healthCheckInterval = TimeSpan.FromSeconds(30);

        // ── Pool metrics (三态连接池监控,Issue #14) ───────────────────────
        // 纯内存计数器,Interlocked 保证线程安全。GetPoolStats() 读取并
        // 返回 JSON,JS 侧每秒采样一次。不涉及网络调用。
        private int _totalBorrowed;  // 已借出连接总数(含 pinned + 非 pinned)
        private int _activeCount;   // 正在执行 SQL 的连接数(含 pinned + 非 pinned)
        private int _pinnedActive;  // pinned 事务连接中正在执行 SQL 的数量
        private int _maxPoolSize;   // 连接池上限,Init() 时从连接字符串解析

        // ── Driver-internal statistics reflection (Issue #14 扩展) ───────────
        // Npgsql 的 PoolingDataSource(internal sealed)实现了 internal abstract
        // Statistics 属性,返回 (int Total, int Idle, int Busy) 真值三元组。
        // 公开 API 不暴露,只能通过反射读。反射 PropertyInfo 缓存一次,运行
        // 时仅 GetValue + 拆 ValueTuple<int,int,int>。任何反射异常回退到估算
        // (totalOpen=active+pinnedIdle+availableCapacity, idleInPool=availableCapacity),
        // 保证 GetPoolStats 永不抛。上层 JS 主用基础字段自算 idleInPool,
        // 此处提供的真值字段作为冗余校验,驱动版本变化失效时不影响 UI。
        private PropertyInfo _statisticsProp;
        private bool _statisticsReflected;  // true=已尝试反射(成功或失败均置 true)

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
            _maxPoolSize = 100; // 连接字符串硬编码 Maximum Pool Size=100
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
        public string ExecuteJsonOnConnection(string connectionString, string sql, object[]? args = null)
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
            Interlocked.Increment(ref _totalBorrowed);
            using var connection = _dataSource.OpenConnection();
            try
            {
                Interlocked.Increment(ref _activeCount);
                try
                {
                    return ExecuteCore(connection, sql, args);
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
            Interlocked.Increment(ref _totalBorrowed);
            using var connection = _dataSource.OpenConnection();
            try
            {
                Interlocked.Increment(ref _activeCount);
                try
                {
                    using var command = CreateCommand(connection, sql, args);
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
        /// Execute a non-query on a fresh ad-hoc connection and return rows affected.
        /// Used for external-database operations (e.g. data migration).
        /// </summary>
        public int ExecuteNonQueryOnConnection(string connectionString, string sql, object[]? args = null)
        {
            using var dataSource = NpgsqlDataSource.Create(connectionString);
            using var connection = dataSource.CreateConnection();
            connection.Open();
            using var command = CreateCommand(connection, sql, args);
            return command.ExecuteNonQuery();
        }

        // ── Health checks ────────────────────────────────────────────────────

        /// <summary>
        /// 返回当前连接池的三态 + 扩展快照,纯内存计数器读取,不涉及网络调用。
        /// JS 侧每秒采样一次,用于底部栏三色波线展示(Issue #14)。
        ///
        /// 基础字段(所有引擎对称,JS 主用):
        ///   active           = 正在执行 SQL 的连接数(pinned + 非 pinned)
        ///   pinnedIdle       = 事务持有但未执行 SQL 的连接数
        ///   availableCapacity = 可用容量(_maxPoolSize - _totalBorrowed)
        ///   max              = 连接池上限
        ///
        /// 扩展字段(冗余校验,驱动版本变化可能失效,UI 不强依赖):
        ///   totalOpen  = 池中当前存活的物理连接总数(PG 反射真值;MySQL/SQLite 估算)
        ///   idleInPool = 池中存活且空闲的物理连接数(PG 反射真值;MySQL/SQLite 估算)
        /// 上层 JS 主用基础字段自算 idleInPool = totalOpen - active - pinnedIdle,
        /// 扩展字段仅供诊断/校验,不参与 UI 主显示链路。
        /// </summary>
        public string GetPoolStats()
        {
            var active = _activeCount;
            var pinnedIdle = _pinned.Count - _pinnedActive;
            var availableCapacity = _maxPoolSize - _totalBorrowed;

            // 默认估算:假设所有可用容量都是空闲物理连接(下界估算,偏高)。
            // 反射成功后用真值覆盖。
            var totalOpen = active + pinnedIdle + availableCapacity;
            var idleInPool = availableCapacity;

            // 反射 PoolingDataSource.Statistics 拿真值。懒初始化,失败回退估算。
            if (!_statisticsReflected)
            {
                try
                {
                    // Statistics 是 NpgsqlDataSource 基类上的 internal abstract 属性,
                    // 运行时由 PoolingDataSource(internal sealed)实现。
                    // NonPublic | Instance 跨 internal 访问修饰符可见。
                    _statisticsProp = typeof(NpgsqlDataSource).GetProperty(
                        "Statistics",
                        BindingFlags.NonPublic | BindingFlags.Instance);
                }
                catch
                {
                    _statisticsProp = null;
                }
                _statisticsReflected = true;
            }

            if (_statisticsProp != null && _dataSource != null)
            {
                try
                {
                    var tuple = (ValueTuple<int, int, int>)_statisticsProp.GetValue(_dataSource);
                    // Item1=Total, Item2=Idle, Item3=Busy
                    totalOpen = tuple.Item1;
                    idleInPool = tuple.Item2;
                }
                catch
                {
                    // 反射执行失败(驱动版本变化/对象已 Dispose):保持估算值。
                }
            }

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
        /// Clear idle connections from the pool. NpgsqlDataSource.Clear()
        /// drops idle connections immediately and marks busy connections to
        /// be closed when returned to the pool (rather than reused). In the
        /// VRCX desktop scenario busy connections are typically 0-3, so the
        /// cost of rebuilding them is acceptable — and the side effect is
        /// beneficial when the user suspects a connection leak.
        /// </summary>
        public void ClearIdleConnections()
        {
            _dataSource?.Clear();
        }

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
        /// Lightweight liveness probe. Returns true when <c>SELECT 1</c>
        /// succeeds against the pooled data source.
        /// </summary>
        public bool Ping()
        {
            try
            {
                Interlocked.Increment(ref _totalBorrowed);
                using var conn = _dataSource.OpenConnection();
                try
                {
                    using var cmd = conn.CreateCommand();
                    cmd.CommandText = "SELECT 1";
                    cmd.ExecuteScalar();
                    _lastHealthCheck = DateTime.Now;
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
                        var value = reader.GetValue(i);
                        values[i] = value is DBNull ? null : value;
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
                        // OnTxTimeout 在 SQL 执行期间来过,当时没清理
                        // (InFlight > 0),现在由 finally 收尾。
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

        private int ExecuteNonQueryPinned(long connId, string sql, object[]? args)
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
                finally
                {
                    Interlocked.Decrement(ref _totalBorrowed);
                    h.Conn.Dispose();
                }
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
                Interlocked.Decrement(ref _totalBorrowed);
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

        // ── IAuthStore implementation ──────────────────────────────────────
        // PostgreSQL 方言:位置参数 ($1/$2),INSERT ... ON CONFLICT DO
        // UPDATE upsert,cookies 表落在 public schema(与 PgSQLAdapter 全局
        // 表的 public.<tbl> 命名约定一致)。key/value 用 TEXT。

        /// <inheritdoc />
        public void EnsureCookiesTable()
        {
            ExecuteNonQuery(
                "CREATE TABLE IF NOT EXISTS public.cookies (key TEXT PRIMARY KEY, value TEXT)");
        }

        /// <inheritdoc />
        public string? LoadCookie(string key)
        {
            var values = Execute(
                "SELECT value FROM public.cookies WHERE key = $1",
                new object[] { key });
            return values.Length > 0 ? (string)values[0][0] : null;
        }

        /// <inheritdoc />
        public void SaveCookie(string key, string value)
        {
            ExecuteNonQuery(
                "INSERT INTO public.cookies (key, value) VALUES ($1, $2) " +
                "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
                new object[] { key, value });
        }
    }
}
