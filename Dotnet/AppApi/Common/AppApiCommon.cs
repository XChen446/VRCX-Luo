using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json;
using NLog;

namespace VRCX
{
    public partial class AppApi
    {
        private static readonly Logger logger = LogManager.GetCurrentClassLogger();

        public void Init()
        {
        }

        public JsonSerializerSettings JsonSerializerSettings = new JsonSerializerSettings
        {
            Error = delegate (object _, Newtonsoft.Json.Serialization.ErrorEventArgs args)
            {
                args.ErrorContext.Handled = true;
            }
        };

        public int GetColourFromUserID(string userId)
        {
            using var hasher = MD5.Create();
            var hash = hasher.ComputeHash(Encoding.UTF8.GetBytes(userId));
            return (hash[3] << 8) | hash[4];
        }

        public void OpenLink(string url)
        {
            if (url.StartsWith("http://") ||
                url.StartsWith("https://"))
            {
                Process.Start(new ProcessStartInfo(url)
                {
                    UseShellExecute = true
                });
            }
        }

        public void OpenDiscordProfile(string discordId)
        {
            if (!long.TryParse(discordId, out _))
                throw new Exception("Invalid user ID");

            var uri = $"discord://-/users/{discordId}";
            Process.Start(new ProcessStartInfo(uri)
            {
                UseShellExecute = true
            });
        }

        public string GetLaunchCommand()
        {
            var command = StartupArgs.LaunchArguments.LaunchCommand;
            StartupArgs.LaunchArguments.LaunchCommand = string.Empty;
            return command;
        }

        public void IPCAnnounceStart()
        {
            IPCServer.Send(new IPCPacket
            {
                Type = "VRCXLaunch",
                MsgType = "VRCXLaunch"
            });
        }

        public void SendIpc(string type, string data)
        {
            IPCServer.Send(new IPCPacket
            {
                Type = "VrcxMessage",
                MsgType = type,
                Data = data
            });
        }

        public string CustomCss()
        {
            var filePath = Path.Join(Program.AppDataDirectory, "custom.css");
            if (File.Exists(filePath))
                return File.ReadAllText(filePath);

            return string.Empty;
        }

        public string CustomScript()
        {
            var filePath = Path.Join(Program.AppDataDirectory, "custom.js");
            if (File.Exists(filePath))
                return File.ReadAllText(filePath);

            return string.Empty;
        }

        /// <summary>
        /// Resolves a VRCX_Database.name value to an absolute database file path.
        /// Mirrors SQLite.ResolveDatabasePath logic so JS can compare connection identity.
        /// </summary>
        public string ResolveDatabaseName(string name)
        {
            if (string.IsNullOrEmpty(name))
                return Program.ConfigLocation;

            if (name.Contains('/') || name.Contains('\\'))
                return name;

            if (name.Length == 2 && name[1] == ':' && char.IsLetter(name[0]))
                return name + '\\';

            return Path.Join(Program.AppDataDirectory, name);
        }

        public string CurrentCulture()
        {
            var culture = CultureInfo.CurrentCulture.ToString();
            if (string.IsNullOrEmpty(culture))
                culture = "en-US";

            return culture;
        }

        public string CurrentLanguage()
        {
            return CultureInfo.InstalledUICulture.Name;
        }

        public string GetVersion()
        {
            return Program.Version;
        }

        public bool VrcClosedGracefully()
        {
            return LogWatcher.Instance.VrcClosedGracefully;
        }

        public Dictionary<string, int> GetColourBulk(List<object> userIds)
        {
            var output = new Dictionary<string, int>();
            foreach (string userId in userIds)
            {
                output.Add(userId, GetColourFromUserID(userId));
            }

            return output;
        }

        public void SetAppLauncherSettings(bool enabled, bool killOnExit, bool runProcessOnce)
        {
            AutoAppLaunchManager.Instance.Enabled = enabled;
            AutoAppLaunchManager.Instance.KillChildrenOnExit = killOnExit;
            AutoAppLaunchManager.Instance.RunProcessOnce = runProcessOnce;
        }

        public string GetFileBase64(string path)
        {
            if (File.Exists(path))
            {
                return Convert.ToBase64String(File.ReadAllBytes(path));
            }

            return null;
        }

        public Task<bool> TryOpenInstanceInVrc(string launchUrl)
        {
            return VRCIPC.Send(launchUrl);
        }
    }
}
