using System;
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
                $"Host={host};Port={port};Username={username};Password={password};Database={name}";

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
        public string ExecuteJson(string sql, object[]? args = null)
        {
            var result = Execute(sql, args);
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
        public object[][] Execute(string sql, object[]? args = null)
        {
            EnsureInitialized();
            using var connection = _dataSource.OpenConnection();
            return ExecuteCore(connection, sql, args);
        }

        /// <summary>
        /// Execute a non-query on a fresh pooled connection and return rows affected.
        /// </summary>
        public int ExecuteNonQuery(string sql, object[]? args = null)
        {
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
        /// Does not probe the network.
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
