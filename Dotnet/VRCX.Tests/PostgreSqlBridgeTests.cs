// 设计稿 (Stage 2 solutions-architect 输出, PR #17 回归测试)
// 文件名: PostgreSqlBridgeTests.cs
// 用途: PostgreSQL 引擎 connId 桥接回归测试 — NormalizeConnId 全量 14 条 + 桥接 9 条
// 最终位置: Dotnet/VRCX.Tests/PostgreSqlBridgeTests.cs
//
// 依赖策略 (同 SQLiteRetryTests.cs): Link PostgreSQL.cs 编译进 VRCX.Tests.dll,
//   同 assembly internal 直接可见, 不需 [InternalsVisibleTo], 不改生产代码。
//   默认并行 (不入 collection): 所有用例只触达 NormalizeConnId 静态纯函数与
//   Execute* 的 connId 归一化早抛点 (DB 访问之前), 无共享可变静态状态;
//   每个测试用 fresh 实例 new PostgreSQL() (构造器仅 new ReaderWriterLockSlim,
//   空副作用), 不触碰 .Instance 静态, 不调用 SetChangeEnabled/Init。
//
// 用例计数 (23 条 / 23 执行用例):
//   NormalizeConnId 全量 14 (Valid: MemberData 5 + Missing Fact 1; Invalid: MemberData 8,
//   数据源 BridgeTestHelper, 与 MySqlBridgeTests 共享; Missing 不在 MemberData 的原因
//   见 BridgeTestHelper.cs 文件头 F2)
//   桥接 9 (ExecuteJson/Execute/ExecuteNonQuery × 3.14d/NaN/"abc")
//
// 桥接判别: 见 BridgeTestHelper.cs 文件头 — GetMethodOrFail 以精确参数类型数组
//   (string, object, object) 定位 (PG 的 args 参数为 object?, 与 SQLite/MySQL 的
//   IDictionary<string,object>? 不同); AssertDomainException 只接受域内 inner
//   ArgumentException 且消息含 "connId" (C2), 裸 ArgumentException (绑定层) /
//   未抛异常均 Fail。
//   C1: 桥接代表值禁用 Missing.Value 与 null — 只用 3.14d / double.NaN / "abc"。
//   PG 桥接 args 传 List<object> { 1 } — CefSharp 将 JS 数组编组为 List<object>,
//   NormalizeArgs 接受该形态 (CefSharp 编组忠实度)。

using System.Reflection;

namespace VRCX.Tests;

[Trait("Component", "PostgreSQL.Bridge")]
public class PostgreSqlBridgeTests
{
    // ===========================================================================
    // NormalizeConnId 全量 (14 条) — [Trait("Category", "NormalizeConnId")]
    // 覆盖: 有效 6 (null/DBNull/Missing/1/999L/3.0d) + 无效 8
    // (3.14d/NaN/±Infinity/1e300/MaxValue/MinValue/"abc")。
    // 数据源: BridgeTestHelper.ValidNormalizeCases / InvalidNormalizeCases
    // (单一事实源, 与 MySqlBridgeTests 共享); Missing 因 xUnit 反射限制 (F2)
    // 用独立 Fact 覆盖 (同 SQLiteRetryTests 先例)。
    // 实际代码: PostgreSQL.cs L1260-1275 (internal static long? NormalizeConnId(object? connId))
    // ===========================================================================

    [Theory]
    [MemberData(nameof(BridgeTestHelper.ValidNormalizeCases), MemberType = typeof(BridgeTestHelper))]
    [Trait("Category", "NormalizeConnId")]
    public void NormalizeConnId_ValidValue_ReturnsNormalizedLong(object? input, long? expected)
    {
        var result = PostgreSQL.NormalizeConnId(input);
        result.Should().Be(expected);
    }

    [Fact]
    [Trait("Category", "NormalizeConnId")]
    public void NormalizeConnId_Missing_ReturnsNull()
    {
        var result = PostgreSQL.NormalizeConnId(Missing.Value);
        result.Should().BeNull();
    }

    [Theory]
    [MemberData(nameof(BridgeTestHelper.InvalidNormalizeCases), MemberType = typeof(BridgeTestHelper))]
    [Trait("Category", "NormalizeConnId")]
    public void NormalizeConnId_InvalidValue_ThrowsArgumentException(object? input)
    {
        var act = () => PostgreSQL.NormalizeConnId(input);
        act.Should().Throw<ArgumentException>().WithMessage("*connId*");
    }

    // ===========================================================================
    // 桥接 (9 条) — [Trait("Category", "Bridge")]
    // 验证 ExecuteJson/Execute/ExecuteNonQuery 三方法的 object? connId 参数在收到
    // 无效值时于 NormalizeConnId 域内早抛 (ArgumentException 含 "connId"), 而不是
    // 延迟到 DB 层/绑定层。C1: 桥接代表值禁用 Missing.Value 与 null, 只用
    // 3.14d / double.NaN / "abc" (见 BridgeTestHelper.cs 文件头)。
    // GetMethod 参数类型数组: (string, object, object) — PG 的 args 参数是 object?。
    // args 传 List<object> { 1 } — CefSharp 将 JS 数组编组为 List<object>,
    // NormalizeArgs 接受该形态 (CefSharp 编组忠实度)。
    // ===========================================================================

    [Fact]
    [Trait("Category", "Bridge")]
    public void ExecuteJson_DoubleConnId_ThrowsNormalizeArgumentException()
    {
        var method = BridgeTestHelper.GetMethodOrFail(typeof(PostgreSQL), "ExecuteJson",
            typeof(string), typeof(object), typeof(object));
        var instance = new PostgreSQL();
        var args = new object?[] { "SELECT 1", new List<object> { 1 }, (double)3.14 };
        BridgeTestHelper.AssertDomainException(method, instance, args);
    }

    [Fact]
    [Trait("Category", "Bridge")]
    public void ExecuteJson_NaNDoubleConnId_ThrowsNormalizeArgumentException()
    {
        var method = BridgeTestHelper.GetMethodOrFail(typeof(PostgreSQL), "ExecuteJson",
            typeof(string), typeof(object), typeof(object));
        var instance = new PostgreSQL();
        var args = new object?[] { "SELECT 1", new List<object> { 1 }, double.NaN };
        BridgeTestHelper.AssertDomainException(method, instance, args);
    }

    [Fact]
    [Trait("Category", "Bridge")]
    public void ExecuteJson_StringConnId_ThrowsNormalizeArgumentException()
    {
        var method = BridgeTestHelper.GetMethodOrFail(typeof(PostgreSQL), "ExecuteJson",
            typeof(string), typeof(object), typeof(object));
        var instance = new PostgreSQL();
        var args = new object?[] { "SELECT 1", new List<object> { 1 }, "abc" };
        BridgeTestHelper.AssertDomainException(method, instance, args);
    }

    [Fact]
    [Trait("Category", "Bridge")]
    public void Execute_DoubleConnId_ThrowsNormalizeArgumentException()
    {
        var method = BridgeTestHelper.GetMethodOrFail(typeof(PostgreSQL), "Execute",
            typeof(string), typeof(object), typeof(object));
        var instance = new PostgreSQL();
        var args = new object?[] { "SELECT 1", new List<object> { 1 }, (double)3.14 };
        BridgeTestHelper.AssertDomainException(method, instance, args);
    }

    [Fact]
    [Trait("Category", "Bridge")]
    public void Execute_NaNDoubleConnId_ThrowsNormalizeArgumentException()
    {
        var method = BridgeTestHelper.GetMethodOrFail(typeof(PostgreSQL), "Execute",
            typeof(string), typeof(object), typeof(object));
        var instance = new PostgreSQL();
        var args = new object?[] { "SELECT 1", new List<object> { 1 }, double.NaN };
        BridgeTestHelper.AssertDomainException(method, instance, args);
    }

    [Fact]
    [Trait("Category", "Bridge")]
    public void Execute_StringConnId_ThrowsNormalizeArgumentException()
    {
        var method = BridgeTestHelper.GetMethodOrFail(typeof(PostgreSQL), "Execute",
            typeof(string), typeof(object), typeof(object));
        var instance = new PostgreSQL();
        var args = new object?[] { "SELECT 1", new List<object> { 1 }, "abc" };
        BridgeTestHelper.AssertDomainException(method, instance, args);
    }

    [Fact]
    [Trait("Category", "Bridge")]
    public void ExecuteNonQuery_DoubleConnId_ThrowsNormalizeArgumentException()
    {
        var method = BridgeTestHelper.GetMethodOrFail(typeof(PostgreSQL), "ExecuteNonQuery",
            typeof(string), typeof(object), typeof(object));
        var instance = new PostgreSQL();
        var args = new object?[] { "SELECT 1", new List<object> { 1 }, (double)3.14 };
        BridgeTestHelper.AssertDomainException(method, instance, args);
    }

    [Fact]
    [Trait("Category", "Bridge")]
    public void ExecuteNonQuery_NaNDoubleConnId_ThrowsNormalizeArgumentException()
    {
        var method = BridgeTestHelper.GetMethodOrFail(typeof(PostgreSQL), "ExecuteNonQuery",
            typeof(string), typeof(object), typeof(object));
        var instance = new PostgreSQL();
        var args = new object?[] { "SELECT 1", new List<object> { 1 }, double.NaN };
        BridgeTestHelper.AssertDomainException(method, instance, args);
    }

    [Fact]
    [Trait("Category", "Bridge")]
    public void ExecuteNonQuery_StringConnId_ThrowsNormalizeArgumentException()
    {
        var method = BridgeTestHelper.GetMethodOrFail(typeof(PostgreSQL), "ExecuteNonQuery",
            typeof(string), typeof(object), typeof(object));
        var instance = new PostgreSQL();
        var args = new object?[] { "SELECT 1", new List<object> { 1 }, "abc" };
        BridgeTestHelper.AssertDomainException(method, instance, args);
    }
}
