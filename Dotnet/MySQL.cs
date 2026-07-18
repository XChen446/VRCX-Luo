using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading;
using MySqlConnector;

namespace VRCX
{
    /// <summary>
    /// MySQL / MariaDB connection manager and query executor.
    ///
    /// Mirrors the public surface of <see cref="SQLite"/> so that the JS
    /// adapter layer can switch engines without changing its call shape:
    ///   - Init() reads VRCX_Database.* config and opens the connection.
    ///   - Exit() closes/disposes the connection.
    ///   - Execute/ExecuteNonQuery/ExecuteJson run parameterised SQL.
    ///
    /// Built on MySqlConnector, which natively supports both MySQL and
    /// MariaDB (protocol-compatible). Both 'mysql' and 'mariadb' modes
    /// route to this class. No engine-specific branching is needed — the
    /// SQL dialect, connection string format, and error codes are
    /// identical across both servers.
    ///
    /// This is intentionally a thin wrapper (Phase 8.1); dialect adaptation
    /// for DDL, schema init and SQL fragments lives in MySQLAdapter.js.
    /// </summary>
    public class MySQL
    {
        public static MySQL Instance;

        private readonly Lock m_ConnectionLock;
        private MySqlConnection m_Connection;

        static MySQL()
        {
            Instance = new MySQL();
        }

        public MySQL()
        {
            m_ConnectionLock = new Lock();
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
                UseAffectedRows = false,
                SslMode = MySqlSslMode.Preferred,
                ConnectionTimeout = 15,
                DefaultCommandTimeout = 30
            };

            ApplyUserOptions(builder);

            m_Connection = new MySqlConnection(builder.ConnectionString);
            m_Connection.Open();
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
        /// Closes and disposes the shared connection.
        /// </summary>
        public void Exit()
        {
            m_Connection?.Close();
            m_Connection?.Dispose();
        }

        /// <summary>
        /// Executes a SELECT/PRAGMA-like statement and returns the result set
        /// serialised as a JSON string. Used by the Linux/Electron JS bridge.
        /// </summary>
        public string ExecuteJson(string sql, IDictionary<string, object>? args = null)
        {
            var result = Execute(sql, args);
            return JsonSerializer.Serialize(result);
        }

        /// <summary>
        /// Executes a SELECT/PRAGMA-like statement and returns rows as
        /// object arrays. Used by the Windows/CefSharp JS bridge.
        /// </summary>
        public object[][] Execute(string sql, IDictionary<string, object>? args = null)
        {
            lock (m_ConnectionLock)
            {
                using var command = new MySqlCommand(sql, m_Connection);
                AddParameters(command, args);

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
        }

        /// <summary>
        /// Executes an INSERT/UPDATE/DELETE/DDL statement and returns the
        /// number of rows affected.
        /// </summary>
        public int ExecuteNonQuery(string sql, IDictionary<string, object>? args = null)
        {
            lock (m_ConnectionLock)
            {
                using var command = new MySqlCommand(sql, m_Connection);
                AddParameters(command, args);
                return command.ExecuteNonQuery();
            }
        }

        /// <summary>
        /// Opens a fresh connection from the given connection string, executes
        /// a query, and returns the result set as JSON. The connection is
        /// closed after the query completes.
        ///
        /// This does NOT touch <see cref="m_Connection"/> — it is completely
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
                    values[i] = reader.GetValue(i);
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
        /// This does NOT touch <see cref="m_Connection"/> — it is completely
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
    }
}
