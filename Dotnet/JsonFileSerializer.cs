using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace VRCX
{
    public static class JsonFileSerializer
    {
        public static void Serialize<T>(string path, T obj)
        {
            try
            {
                using (var file = File.Open(path, FileMode.Create, FileAccess.Write, FileShare.ReadWrite))
                using (var stream = new StreamWriter(file, Encoding.UTF8))
                using (var writer = new JsonTextWriter(stream))
                {
                    var serializer = Newtonsoft.Json.JsonSerializer.CreateDefault();
                    serializer.Formatting = Formatting.Indented;
                    serializer.Serialize(writer, obj, typeof(T));
                }
            }
            catch
            {
            }
        }

        public static bool Deserialize<T>(string path, ref T obj) where T : new()
        {
            try
            {
                using (var file = File.Open(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                using (var stream = new StreamReader(file, Encoding.UTF8))
                using (var reader = new JsonTextReader(stream))
                {
                    var o = Newtonsoft.Json.JsonSerializer.CreateDefault().Deserialize<T>(reader);
                    if (o == null)
                    {
                        o = new T();
                    }
                    obj = o;
                    return true;
                }
            }
            catch
            {
            }
            return false;
        }

        /// <summary>
        /// Deserializes VRCX.json with nested object support.
        /// Nested objects (e.g. "VRCX_Database": { "mode": "sqlite" })
        /// are flattened into dot-separated keys (e.g. "VRCX_Database.mode").
        /// </summary>
        public static Dictionary<string, string> DeserializeFlat(string path)
        {
            try
            {
                var json = File.ReadAllText(path, Encoding.UTF8);
                var root = JObject.Parse(json);
                var result = new Dictionary<string, string>();
                FlattenInto(result, "", root);
                return result;
            }
            catch
            {
                return new Dictionary<string, string>();
            }
        }

        /// <summary>
        /// Serializes a flat Dictionary<string, string> into nested JSON.
        /// Keys containing '.' are split into nested JObject structures.
        /// </summary>
        public static void SerializeNested(string path, Dictionary<string, string> flat)
        {
            try
            {
                var root = new JObject();
                foreach (var kvp in flat)
                {
                    var parts = kvp.Key.Split('.');
                    JObject current = root;

                    for (int i = 0; i < parts.Length - 1; i++)
                    {
                        var segment = parts[i];

                        if (current[segment] == null)
                        {
                            current[segment] = new JObject();
                        }
                        else if (current[segment] is JValue)
                        {
                            throw new InvalidOperationException(
                                $"VRCXStorage serialization conflict: '{segment}' is both a flat value and a nested container.");
                        }

                        current = (JObject)current[segment];
                    }

                    if (current[parts[^1]] is JObject)
                    {
                        throw new InvalidOperationException(
                            $"VRCXStorage serialization conflict: '{kvp.Key}' is both a nested container and a flat value.");
                    }

                    current[parts[^1]] = kvp.Value;
                }

                using (var file = File.Open(path, FileMode.Create, FileAccess.Write, FileShare.ReadWrite))
                using (var stream = new StreamWriter(file, Encoding.UTF8))
                using (var writer = new JsonTextWriter(stream))
                {
                    writer.Formatting = Formatting.Indented;
                    root.WriteTo(writer);
                }
            }
            catch
            {
            }
        }

        private static void FlattenInto(Dictionary<string, string> result, string prefix, JToken token)
        {
            if (token is JObject obj)
            {
                foreach (var prop in obj.Properties())
                {
                    var key = string.IsNullOrEmpty(prefix) ? prop.Name : $"{prefix}.{prop.Name}";
                    FlattenInto(result, key, prop.Value);
                }
            }
            else if (token is JValue val)
            {
                result[prefix] = val.ToString();
            }
            // JArray / JConstructor — silently skipped, not used in config
        }
    }
}
