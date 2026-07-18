// 设计稿 (Stage 2 solutions-architect 输出, Link+stub 方案)
// 文件名: ProgramStub.cs
// 用途: Minimal Program stub for SQLite.cs security tests
// 最终位置: Dotnet/VRCX.Tests/Stubs/ProgramStub.cs (由 implementer 决定)
//
// 方案变更说明 (2026-07-18):
//   原 ProjectReference 方案需改 Dotnet/Program.cs L22 ConfigLocation private set → internal set
//   新 Link+stub 方案: 测试工程自带 Program stub, 自行定义可写 setter, 生产代码 Program.cs 零改动
//
// 设计要点:
//   - SQLite.cs 安全方法 (ValidateAndCanonicalizeDatabasePath / ResolveDatabasePath /
//     ValidateDatabaseFile / SanitizePragmaValue) 依赖 ONLY:
//       Program.AppDataDirectory (public static field, writeable)
//       Program.ConfigLocation  (public static property, writeable)
//   - Init()/CollectOptions() 未被安全测试调用; 其依赖 (VRCXStorage, SQLiteConnection) 由 VRCXStorageStub 处理
//   - 本 stub 刻意省略 Program 所有其他成员 (BaseDirectory, Version, LaunchDebug, AppApiInstance,
//     logger 等) — SQLite.cs 安全方法不引用它们
//   - 命名空间 VRCX 与生产代码一致, 使 Link'd SQLite.cs 编译时类型解析正确

namespace VRCX
{
    /// <summary>
    /// Minimal Program stub for SQLite.cs security tests.
    /// SQLite.cs security methods (ValidateAndCanonicalizeDatabasePath / ResolveDatabasePath /
    /// ValidateDatabaseFile / SanitizePragmaValue) depend ONLY on:
    ///   - Program.AppDataDirectory (public static field, writeable)
    ///   - Program.ConfigLocation  (public static property, writeable)
    /// Init()/CollectOptions() are NOT tested here; their dependencies (VRCXStorage, SQLiteConnection)
    /// are stubbed separately. This stub deliberately omits all other Program members
    /// (BaseDirectory, Version, LaunchDebug, AppApiInstance, logger, etc.) because SQLite.cs
    /// security methods do not reference them.
    /// </summary>
    public static class Program
    {
        public static string AppDataDirectory;
        public static string ConfigLocation { get; set; }
    }
}
