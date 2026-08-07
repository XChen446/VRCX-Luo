using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;

namespace VRCX
{
    public class VRCXStorage
    {
        public static readonly VRCXStorage Instance;

        private static ConcurrentDictionary<string, string> _storage = new ConcurrentDictionary<string, string>();
        private static readonly string JsonPath = Path.Join(Program.AppDataDirectory, "VRCX.json");

        private static readonly TimeSpan SaveDebounce = TimeSpan.FromMilliseconds(500);
        private static readonly Timer SaveTimer;
        private static readonly Lock SaveLock = new Lock();

        static VRCXStorage()
        {
            Instance = new VRCXStorage();
            SaveTimer = new Timer(_ => Instance.Save(), null, Timeout.InfiniteTimeSpan, Timeout.InfiniteTimeSpan);
        }

        public void Load()
        {
            // Deserialize JSON with nested object flattening support.
            // null means file existed but was corrupted — try backup.
            var tmp = JsonFileSerializer.DeserializeFlatOrNull(JsonPath);

            if (tmp == null)
            {
                var bakPath = JsonPath + ".bak";
                if (File.Exists(bakPath))
                {
                    try
                    {
                        File.Copy(bakPath, JsonPath, overwrite: true);
                        tmp = JsonFileSerializer.DeserializeFlatOrNull(JsonPath);
                    }
                    catch { }
                }
            }

            tmp ??= new Dictionary<string, string>();

            // ── Migration: 旧 flat key VRCX_DatabaseLocation → VRCX_Database.name ──
            if (tmp.TryGetValue("VRCX_DatabaseLocation", out var oldLocation))
            {
                if (!tmp.ContainsKey("VRCX_Database.name"))
                {
                    tmp["VRCX_Database.name"] = oldLocation;
                }
                tmp.Remove("VRCX_DatabaseLocation");
            }

            // ── First-run bootstrap: 确保命名空间存在，避免 Set() dot-path guard 报错 ──
            if (!tmp.Keys.Any(k => k.StartsWith("VRCX_Database.")))
            {
                tmp["VRCX_Database.mode"] = "sqlite";
                tmp["VRCX_Database.name"] = "";
                tmp["VRCX_Database.host"] = "";
                tmp["VRCX_Database.port"] = "";
                tmp["VRCX_Database.username"] = "";
                tmp["VRCX_Database.password"] = "";
                tmp["VRCX_Database.options._example_journal_mode"] = "WAL";
            }

            // 确保不论迁移还是首次运行，mode 始终存在
            if (!tmp.ContainsKey("VRCX_Database.mode"))
            {
                tmp["VRCX_Database.mode"] = "sqlite";
            }

            _storage = new ConcurrentDictionary<string, string>(tmp);
        }

        public void Save()
        {
            lock (SaveLock)
            {
                var snapshot = new Dictionary<string, string>(_storage);
                JsonFileSerializer.SerializeNested(JsonPath, snapshot);
            }
        }

        /// <summary>
        /// Global flag tracking whether the .bak backup has been attempted.
        /// - true:  backup succeeded at least once this process lifetime
        /// - false: backup has never been attempted (or last attempt failed)
        /// </summary>
        private static bool _backupAttempted;

        /// <summary>
        /// Creates a backup of the current VRCX.json to VRCX.json.bak.
        ///
        /// BACKUP GUARD:
        /// The static field <see cref="_backupAttempted"/> ensures the .bak file
        /// is written at most ONCE per process lifetime — even if this method
        /// is called multiple times (e.g. on re-login storms).  After a
        /// successful write the flag is permanently set; subsequent calls return
        /// immediately with no I/O (unless <paramref name="force"/> is true).
        ///
        /// This guard also handles the case where the .bak file is NOT writable
        /// (e.g. permission denied, disk full, or the file is locked by another
        /// process).  On failure the flag remains false, allowing a retry on the
        /// next call (e.g. next successful login).
        ///
        /// Called by upper layers when a safe checkpoint is reached
        /// (e.g. successful VRChat login), providing a recovery point
        /// in case the config file is later corrupted.
        /// </summary>
        /// <param name="force">When true, bypass the <see cref="_backupAttempted"/> guard
        /// and force a new .bak write even if one was already made this process lifetime.</param>
        public void Backup(bool force = false)
        {
            if (_backupAttempted && !force)
                return;

            var bakPath = JsonPath + ".bak";
            try
            {
                if (File.Exists(JsonPath))
                {
                    File.Copy(JsonPath, bakPath, overwrite: true);
                }
                _backupAttempted = true;
            }
            catch (Exception ex)
            {
                var logger = NLog.LogManager.GetCurrentClassLogger();
                logger.Warn(ex, "VRCXStorage backup failed");
                // Don't set flag — allow retry on next login / next call
            }
        }

        public void Clear()
        {
            if (!_storage.IsEmpty)
            {
                _storage.Clear();
                ScheduleSave();
            }
        }

        public bool Remove(string key)
        {
            var result = _storage.TryRemove(key, out _);
            if (result)
                ScheduleSave();
            return result;
        }

        public string Get(string key)
        {
            return _storage.TryGetValue(key, out var value) ? value : string.Empty;
        }

        public void Set(string key, string value)
        {
            // Safety guard 1: keys with '.' must target an already-initialized nested namespace,
            // preventing accidental creation of unintended nestable config keys at any depth.
            if (key.Contains('.'))
            {
                var prefix = key[..key.IndexOf('.')];
                if (!_storage.Keys.Any(k => k.StartsWith(prefix + ".")))
                {
                    throw new InvalidOperationException(
                        $"VRCXStorage: cannot Set('{key}') — parent namespace '{prefix}' has not been initialized. " +
                        "Initialize the namespace first (e.g. via VRCXStorage.Load migration) before writing dot-path keys.");
                }
            }
            // Safety guard 2: flat keys must not conflict with an existing nested namespace,
            // as it would make serialization impossible (same key as both value and container).
            else if (_storage.Keys.Any(k => k.StartsWith(key + ".")))
            {
                throw new InvalidOperationException(
                    $"VRCXStorage: cannot Set('{key}') — a nested namespace under '{key}' already exists. " +
                    "Remove the nested keys first, or use a different key name.");
            }

            _storage[key] = value;
            ScheduleSave();
        }

        public string GetAll()
        {
            return JsonSerializer.Serialize(new Dictionary<string, string>(_storage));
        }

        /// <summary>
        /// Returns all key-value pairs whose key starts with the given prefix,
        /// with the prefix stripped from the result keys.
        /// Used for scanning sub-key namespaces like VRCX_Database.options.*
        /// </summary>
        public Dictionary<string, string> GetWithPrefix(string prefix)
        {
            var result = new Dictionary<string, string>();
            foreach (var kvp in _storage)
            {
                if (kvp.Key.StartsWith(prefix))
                {
                    result[kvp.Key[prefix.Length..]] = kvp.Value;
                }
            }
            return result;
        }

        /// <summary>
        /// Reads and returns the content of VRCX.json.bak as a JSON string.
        /// Returns an empty object <c>{}</c> if the backup file does not exist
        /// or cannot be read (permissions, corruption, etc.) — never null.
        /// </summary>
        public string GetBackup()
        {
            try
            {
                var bakPath = JsonPath + ".bak";
                var data = JsonFileSerializer.DeserializeFlat(bakPath);
                return JsonSerializer.Serialize(data);
            }
            catch
            {
                return "{}";
            }
        }

        private static void ScheduleSave()
        {
            SaveTimer.Change(SaveDebounce, Timeout.InfiniteTimeSpan);
        }
    }
}
