// 设计稿 (Stage 2 solutions-architect 输出, PR #17 回归测试)
// 文件名: SQLiteBridgeTests.cs
// 用途: SQLite 引擎 connId 桥接回归测试 — NormalizeConnId 补缺 4 条 + 桥接 9 条
// 最终位置: Dotnet/VRCX.Tests/SQLiteBridgeTests.cs
//
// 依赖策略 (同 SQLiteRetryTests.cs): Link SQLite.cs 编译进 VRCX.Tests.dll, 同 assembly
//   internal 直接可见, 不需 [InternalsVisibleTo], 不改生产代码。
//   [Collection("SQLiteStaticState")]: 与 SQLiteSecurityTests/SQLiteRetryTests 串行,
//   共享 Program 静态状态 fixture (本类不触碰静态, 仅为避免与同类静态测试并发)。
//
// 补缺归属 (C7): NormalizeConnId 前 10 条已在 SQLiteRetryTests.cs 覆盖
//   (有效: null/DBNull/Missing/1/999L/3.0d; 无效: 3.14d/NaN/+Infinity/"abc"),
//   本文件只补 SQLite 侧缺失的 4 条无效值: -Infinity / 1e300d / MaxValue / MinValue
//   (1 个 Theory × 4 InlineData; PG/MySQL 侧全量 14 条共享 BridgeTestHelper MemberData)。
//
// 用例计数 (13 条 / 13 执行用例):
//   NormalizeConnId 补缺 4 (Theory × 4 InlineData)
//   桥接 9 (ExecuteJson/Execute/ExecuteNonQuery × 3.14d/NaN/"abc")
//
// 桥接判别: 见 BridgeTestHelper.cs 文件头 — GetMethodOrFail 以精确参数类型数组
//   (string, IDictionary<string,object>, object) 定位; AssertDomainException 只接受
//   域内 inner ArgumentException 且消息含 "connId" (C2), 裸 ArgumentException
//   (绑定层) / 未抛异常均 Fail。
//   C1: 桥接代表值禁用 Missing.Value 与 null — 只用 3.14d / double.NaN / "abc"。
//   SQLite 桥接 args 传 Dictionary<string, object> { { "@x", 1 } }
//   (与生产 Execute* 签名 IDictionary<string, object>? args 一致)。

namespace VRCX.Tests;

[Collection("SQLiteStaticState")]
[Trait("Component", "SQLite.Bridge")]
public class SQLiteBridgeTests
{
    // ===========================================================================
    // NormalizeConnId 补缺 (4 条) — [Trait("Category", "NormalizeConnId")]
    // 补缺归属: 见文件头 (C7)。这 4 个 double 值 (-Infinity / 1e300 / MaxValue /
    // MinValue) 不在 SQLiteRetryTests.cs 的 10 条覆盖内: 前两者命中
    // !double.IsInfinity / d >= long.MinValue 守卫, 后两者命中 d <= long.MaxValue 守卫。
    // 实际代码: SQLite.cs L808-823 (internal static long? NormalizeConnId(object? connId))
    // ===========================================================================

    [Theory]
    [InlineData(double.NegativeInfinity)]
    [InlineData(1e300d)]
    [InlineData(double.MaxValue)]
    [InlineData(double.MinValue)]
    [Trait("Category", "NormalizeConnId")]
    public void NormalizeConnId_NonRepresentableDouble_ThrowsArgumentException(double value)
    {
        var act = () => SQLite.NormalizeConnId(value);
        act.Should().Throw<ArgumentException>().WithMessage("*connId*");
    }

    // ===========================================================================
    // 桥接 (9 条) — [Trait("Category", "Bridge")]
    // 验证 ExecuteJson/Execute/ExecuteNonQuery 三方法的 object? connId 参数在收到
    // 无效值时于 NormalizeConnId 域内早抛 (ArgumentException 含 "connId"), 而不是
    // 延迟到 DB 层/绑定层。C1: 桥接代表值禁用 Missing.Value 与 null, 只用
    // 3.14d / double.NaN / "abc" (见 BridgeTestHelper.cs 文件头)。
    // GetMethod 参数类型数组: (string, IDictionary<string,object>, object)。
    // args 传 Dictionary<string, object> { { "@x", 1 } } — 与生产签名一致,
    // 验证对象通过反射绑定 (Execute* 是 public instance, 反射只为精确断言签名,
    // 判别器逻辑见 BridgeTestHelper.AssertDomainException)。
    // ===========================================================================

    [Fact]
    [Trait("Category", "Bridge")]
    public void ExecuteJson_DoubleConnId_ThrowsNormalizeArgumentException()
    {
        var method = BridgeTestHelper.GetMethodOrFail(typeof(SQLite), "ExecuteJson",
            typeof(string), typeof(IDictionary<string, object>), typeof(object));
        var instance = new SQLite();
        var args = new object?[] { "SELECT 1", new Dictionary<string, object> { { "@x", 1 } }, (double)3.14 };
        BridgeTestHelper.AssertDomainException(method, instance, args);
    }

    [Fact]
    [Trait("Category", "Bridge")]
    public void ExecuteJson_NaNDoubleConnId_ThrowsNormalizeArgumentException()
    {
        var method = BridgeTestHelper.GetMethodOrFail(typeof(SQLite), "ExecuteJson",
            typeof(string), typeof(IDictionary<string, object>), typeof(object));
        var instance = new SQLite();
        var args = new object?[] { "SELECT 1", new Dictionary<string, object> { { "@x", 1 } }, double.NaN };
        BridgeTestHelper.AssertDomainException(method, instance, args);
    }

    [Fact]
    [Trait("Category", "Bridge")]
    public void ExecuteJson_StringConnId_ThrowsNormalizeArgumentException()
    {
        var method = BridgeTestHelper.GetMethodOrFail(typeof(SQLite), "ExecuteJson",
            typeof(string), typeof(IDictionary<string, object>), typeof(object));
        var instance = new SQLite();
        var args = new object?[] { "SELECT 1", new Dictionary<string, object> { { "@x", 1 } }, "abc" };
        BridgeTestHelper.AssertDomainException(method, instance, args);
    }

    [Fact]
    [Trait("Category", "Bridge")]
    public void Execute_DoubleConnId_ThrowsNormalizeArgumentException()
    {
        var method = BridgeTestHelper.GetMethodOrFail(typeof(SQLite), "Execute",
            typeof(string), typeof(IDictionary<string, object>), typeof(object));
        var instance = new SQLite();
        var args = new object?[] { "SELECT 1", new Dictionary<string, object> { { "@x", 1 } }, (double)3.14 };
        BridgeTestHelper.AssertDomainException(method, instance, args);
    }

    [Fact]
    [Trait("Category", "Bridge")]
    public void Execute_NaNDoubleConnId_ThrowsNormalizeArgumentException()
    {
        var method = BridgeTestHelper.GetMethodOrFail(typeof(SQLite), "Execute",
            typeof(string), typeof(IDictionary<string, object>), typeof(object));
        var instance = new SQLite();
        var args = new object?[] { "SELECT 1", new Dictionary<string, object> { { "@x", 1 } }, double.NaN };
        BridgeTestHelper.AssertDomainException(method, instance, args);
    }

    [Fact]
    [Trait("Category", "Bridge")]
    public void Execute_StringConnId_ThrowsNormalizeArgumentException()
    {
        var method = BridgeTestHelper.GetMethodOrFail(typeof(SQLite), "Execute",
            typeof(string), typeof(IDictionary<string, object>), typeof(object));
        var instance = new SQLite();
        var args = new object?[] { "SELECT 1", new Dictionary<string, object> { { "@x", 1 } }, "abc" };
        BridgeTestHelper.AssertDomainException(method, instance, args);
    }

    [Fact]
    [Trait("Category", "Bridge")]
    public void ExecuteNonQuery_DoubleConnId_ThrowsNormalizeArgumentException()
    {
        var method = BridgeTestHelper.GetMethodOrFail(typeof(SQLite), "ExecuteNonQuery",
            typeof(string), typeof(IDictionary<string, object>), typeof(object));
        var instance = new SQLite();
        var args = new object?[] { "SELECT 1", new Dictionary<string, object> { { "@x", 1 } }, (double)3.14 };
        BridgeTestHelper.AssertDomainException(method, instance, args);
    }

    [Fact]
    [Trait("Category", "Bridge")]
    public void ExecuteNonQuery_NaNDoubleConnId_ThrowsNormalizeArgumentException()
    {
        var method = BridgeTestHelper.GetMethodOrFail(typeof(SQLite), "ExecuteNonQuery",
            typeof(string), typeof(IDictionary<string, object>), typeof(object));
        var instance = new SQLite();
        var args = new object?[] { "SELECT 1", new Dictionary<string, object> { { "@x", 1 } }, double.NaN };
        BridgeTestHelper.AssertDomainException(method, instance, args);
    }

    [Fact]
    [Trait("Category", "Bridge")]
    public void ExecuteNonQuery_StringConnId_ThrowsNormalizeArgumentException()
    {
        var method = BridgeTestHelper.GetMethodOrFail(typeof(SQLite), "ExecuteNonQuery",
            typeof(string), typeof(IDictionary<string, object>), typeof(object));
        var instance = new SQLite();
        var args = new object?[] { "SELECT 1", new Dictionary<string, object> { { "@x", 1 } }, "abc" };
        BridgeTestHelper.AssertDomainException(method, instance, args);
    }
}
