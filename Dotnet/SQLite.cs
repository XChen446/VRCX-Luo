using System;
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
            var dataSource = VRCXStorage.Instance.Get("VRCX_Database.location");
            if (string.IsNullOrEmpty(dataSource))
            {
                dataSource = Program.ConfigLocation;
                VRCXStorage.Instance.Set("VRCX_Database.location", dataSource);
            }

            m_Connection = new SQLiteConnection($"Data Source=\"{dataSource}\";Version=3;PRAGMA locking_mode=NORMAL;PRAGMA busy_timeout=5000;PRAGMA journal_mode=WAL;PRAGMA optimize=0x10002;", true);

            m_Connection.Open();
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

        public object[][] Execute(string sql, IDictionary<string, object>? args = null)
        {
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

        public int ExecuteNonQuery(string sql, IDictionary<string, object>? args = null)
        {
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
    }
}
