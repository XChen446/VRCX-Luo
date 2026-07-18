// 设计稿 (Stage 2 solutions-architect 输出, Link+stub 方案)
// 文件名: SQLiteTestCollection.cs
// 用途: 强制所有依赖 Program.AppDataDirectory / Program.ConfigLocation 静态状态的测试
//       串行执行, 避免 xUnit 跨类并行导致的静态字段竞态。
// 最终位置: Dotnet/VRCX.Tests/SQLiteTestCollection.cs (由 implementer 决定)
//
// 设计要点:
//   1. [CollectionDefinition("SQLiteStaticState")] 声明 collection 名字
//   2. ICollectionFixture<SQLiteStaticStateFixture> 让 xUnit 在 collection 启动时创建 fixture,
//      collection 结束时 Dispose — 保存/还原 Program 静态字段原值
//   3. 单个测试类 (SQLiteSecurityTests) 通过构造函数 + IDisposable 做更细粒度的 Setup/Teardown
//   4. xUnit 默认: 不同 collection 并行, 同 collection 串行 → 保证静态字段无竞态
//
// 依赖策略 (2026-07-18 变更): Link+stub 方案
//   - Program.AppDataDirectory  由 Stubs/ProgramStub.cs 提供 (public static field, 可写)
//   - Program.ConfigLocation    由 Stubs/ProgramStub.cs 提供 (public static property { get; set; }, 可写)
//   - 生产代码 Dotnet/Program.cs L22 零改动 (stub 自定义可写 setter)

namespace VRCX.Tests;

/// <summary>
/// 强制所有依赖 Program.AppDataDirectory / Program.ConfigLocation 静态状态的测试
/// 串行执行, 避免 xUnit 跨类并行导致的静态字段竞态。
/// </summary>
[CollectionDefinition("SQLiteStaticState")]
public class SQLiteStaticStateCollection : ICollectionFixture<SQLiteStaticStateFixture>
{
}

/// <summary>
/// 在 collection 启动时保存 Program 静态字段原值, collection 结束时还原。
/// 单个测试类通过构造函数 + IDisposable 做更细粒度的 Setup/Teardown。
/// </summary>
public class SQLiteStaticStateFixture : IDisposable
{
    public string OriginalAppDataDirectory { get; }
    public string OriginalConfigLocation { get; }

    public SQLiteStaticStateFixture()
    {
        // 保存原值 — Program.AppDataDirectory 和 Program.ConfigLocation 均由
        // Stubs/ProgramStub.cs 提供 (public 可写), 直接读取即可
        OriginalAppDataDirectory = Program.AppDataDirectory;
        OriginalConfigLocation = Program.ConfigLocation;
    }

    public void Dispose()
    {
        // 还原原值 — 防止单个测试类 teardown 失败时, collection 级别兜底还原
        Program.AppDataDirectory = OriginalAppDataDirectory;
        Program.ConfigLocation = OriginalConfigLocation;
    }
}
