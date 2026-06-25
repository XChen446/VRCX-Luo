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
            // Deserialize JSON with nested object flattening support
            var tmp = JsonFileSerializer.DeserializeFlat(JsonPath);

            // Migrate old flat key VRCX_DatabaseLocation → VRCX_Database.* structure
            if (tmp.TryGetValue("VRCX_DatabaseLocation", out var oldLocation))
            {
                // Only migrate if new key doesn't already exist (data consistency)
                if (!tmp.ContainsKey("VRCX_Database.location"))
                {
                    tmp["VRCX_Database.mode"] = "sqlite";
                    tmp["VRCX_Database.location"] = oldLocation;
                }
                tmp.Remove("VRCX_DatabaseLocation");
            }

            // First-run / fresh config: ensure VRCX_Database.* namespace exists
            // so that Set() with dot-path validation won't reject writes.
            if (!tmp.Keys.Any(k => k.StartsWith("VRCX_Database.")))
            {
                tmp["VRCX_Database.mode"] = "sqlite";
                tmp["VRCX_Database.location"] = string.Empty;
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
            // Safety guard: keys with '.' must target an already-initialized nested namespace.
            // This prevents accidental creation of unintended nestable config keys.
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

            _storage[key] = value;
            ScheduleSave();
        }

        public string GetAll()
        {
            return JsonSerializer.Serialize(new Dictionary<string, string>(_storage));
        }

        private static void ScheduleSave()
        {
            SaveTimer.Change(SaveDebounce, Timeout.InfiniteTimeSpan);
        }
    }
}
