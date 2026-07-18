using System;
using System.Collections.Generic;
using System.Text.Json;
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
    /// Phase 9.2+: add retry/health-check, JS PgSQLAdapter, schema isolation.
    /// </summary>
    public class PostgreSQL
    {
        public static PostgreSQL Instance;

        private NpgsqlDataSource _dataSource;
        private NpgsqlConnection _connection;
        private readonly ReaderWriterLockSlim _connectionLock;
        private bool _initialized;

        static PostgreSQL()
        {
            Instance = new PostgreSQL();
        }

        public PostgreSQL()
        {
            _connectionLock = new ReaderWriterLockSlim();
        }

        /// <summary>
        /// Initialize the shared PostgreSQL connection from VRCX_Database.name.
        /// For PostgreSQL mode, <c>VRCX_Database.name</c> is treated as an
        /// Npgsql connection string (e.g. "Host=localhost;Database=vrcx;Username=vrcx").
        /// </summary>
        public void Init()
        {
#if LINUX
            Instance = this;
#endif
            var connectionString = VRCXStorage.Instance.Get("VRCX_Database.name")?.Trim();
            if (string.IsNullOrEmpty(connectionString))
            {
                throw new InvalidOperationException(
                    "VRCX_Database.name is not set. PostgreSQL mode requires a connection string.");
            }

            var builder = new NpgsqlDataSourceBuilder(connectionString);
            _dataSource = builder.Build();
            _connection = _dataSource.CreateConnection();
            _connection.Open();
            _initialized = true;
        }

        /// <summary>
        /// Close the pooled connection and dispose the data source.
        /// Safe to call even if Init() was never invoked.
        /// </summary>
        public void Exit()
        {
            _initialized = false;
            _connection?.Close();
            _connection?.Dispose();
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
        /// Execute a query on the pooled connection and return rows as positional arrays.
        /// Parameters are positional (<c>$1</c>, <c>$2</c>, ...) and are bound from
        /// <paramref name="args"/> in order.
        /// </summary>
        public object[][] Execute(string sql, object[]? args = null)
        {
            _connectionLock.EnterReadLock();
            try
            {
                EnsureInitialized();
                return ExecuteCore(_connection, sql, args);
            }
            finally
            {
                _connectionLock.ExitReadLock();
            }
        }

        /// <summary>
        /// Execute a non-query on the pooled connection and return rows affected.
        /// </summary>
        public int ExecuteNonQuery(string sql, object[]? args = null)
        {
            var result = -1;
            _connectionLock.EnterWriteLock();
            try
            {
                EnsureInitialized();
                using var command = CreateCommand(_connection, sql, args);
                result = command.ExecuteNonQuery();
            }
            finally
            {
                _connectionLock.ExitWriteLock();
            }

            return result;
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

        private void EnsureInitialized()
        {
            if (!_initialized || _connection == null)
            {
                throw new InvalidOperationException(
                    "PostgreSQL has not been initialized. Call Init() first.");
            }
        }
    }
}
