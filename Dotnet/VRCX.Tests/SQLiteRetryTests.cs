// 文件名: SQLiteRetryTests.cs
// 用途: §9.1 — SQLite 连接 ID 规范化、异常过滤、重试逻辑、退避延迟单元测试
// 最终位置: Dotnet/VRCX.Tests/SQLiteRetryTests.cs
//
// 依赖策略 (同 SQLiteSecurityTests.cs): Link SQLite.cs 编译进 VRCX.Tests.dll
//   - SQLite.cs 通过 <Compile Include="..\SQLite.cs" Link="SQLite.cs" /> 编译进 VRCX.Tests.dll
//   - 不 ProjectReference VRCX-Cef.csproj, 不需 [InternalsVisibleTo], 不改 Program.cs
//
// 测试目标方法 (生产代码 Dotnet/SQLite.cs, 被 Link 进测试 assembly):
//   - SQLite.NormalizeConnId(object? connId)          → long?      [L701, internal static]
//   - SQLite.IsRetryableSqliteException(Exception ex)  → bool       [L721, internal static]
//   - SQLite.ExecuteWithRetry<T>(Func<T>, string)      → T          [L731, internal static]
//   - SQLite.CalculateRetryDelay(int attempt)          → int        [L756, internal static]
//
// 用例计数 (19 条方法 / 19 执行用例):
//   NormalizeConnId             10
//   IsRetryableSqliteException   3
//   ExecuteWithRetry             4
//   CalculateRetryDelay          2

using System.Data.SQLite;
using System.Reflection;
using System.Runtime.CompilerServices;
using FluentAssertions;
using Xunit;

namespace VRCX.Tests;

[Collection("SQLiteStaticState")]
[Trait("Component", "SQLite.Retry")]
public class SQLiteRetryTests
{
    /// <summary>
    /// Creates a SQLiteException with the given ResultCode without loading
    /// the native e_sqlite3 DLL. All public constructors on SQLiteException call
    /// GetErrorString() which requires the native DLL. We use
    /// RuntimeHelpers.GetUninitializedObject (zero-constructor creation) +
    /// reflection to set the private _errorCode and _message fields.
    /// </summary>
    private static SQLiteException CreateSqliteException(SQLiteErrorCode errorCode, string message)
    {
        var ex = (SQLiteException)RuntimeHelpers.GetUninitializedObject(typeof(SQLiteException));
        var errorField = typeof(SQLiteException).GetField("_errorCode",
            BindingFlags.NonPublic | BindingFlags.Instance);
        errorField!.SetValue(ex, errorCode);
        var messageField = typeof(Exception).GetField("_message",
            BindingFlags.NonPublic | BindingFlags.Instance);
        messageField!.SetValue(ex, message);
        return ex;
    }
    // ===========================================================================
    // NormalizeConnId (10 条) — [Trait("Category", "NormalizeConnId")]
    // 验证 connId 参数从 object? → long? 的规范化转换。
    // 处理: null, DBNull, Missing, int, long, 整值 double。
    // 实际代码: SQLite.cs L701-716
    // ===========================================================================

    [Fact]
    [Trait("Category", "NormalizeConnId")]
    public void NormalizeConnId_Null_ReturnsNull()
    {
        var result = SQLite.NormalizeConnId(null);
        result.Should().BeNull();
    }

    [Fact]
    [Trait("Category", "NormalizeConnId")]
    public void NormalizeConnId_DBNull_ReturnsNull()
    {
        var result = SQLite.NormalizeConnId(DBNull.Value);
        result.Should().BeNull();
    }

    [Fact]
    [Trait("Category", "NormalizeConnId")]
    public void NormalizeConnId_Missing_ReturnsNull()
    {
        var result = SQLite.NormalizeConnId(Missing.Value);
        result.Should().BeNull();
    }

    [Fact]
    [Trait("Category", "NormalizeConnId")]
    public void NormalizeConnId_IntValue_ReturnsLong()
    {
        var result = SQLite.NormalizeConnId((int)1);
        result.Should().Be(1L);
    }

    [Fact]
    [Trait("Category", "NormalizeConnId")]
    public void NormalizeConnId_LongValue_ReturnsLong()
    {
        var result = SQLite.NormalizeConnId((long)999);
        result.Should().Be(999L);
    }

    [Fact]
    [Trait("Category", "NormalizeConnId")]
    public void NormalizeConnId_IntegralDouble_ReturnsLong()
    {
        var result = SQLite.NormalizeConnId((double)3.0);
        result.Should().Be(3L);
    }

    [Fact]
    [Trait("Category", "NormalizeConnId")]
    public void NormalizeConnId_NonIntegralDouble_ThrowsArgumentException()
    {
        var act = () => SQLite.NormalizeConnId((double)3.14);
        act.Should().Throw<ArgumentException>().WithMessage("*connId*");
    }

    [Fact]
    [Trait("Category", "NormalizeConnId")]
    public void NormalizeConnId_NaN_ThrowsArgumentException()
    {
        var act = () => SQLite.NormalizeConnId(double.NaN);
        act.Should().Throw<ArgumentException>().WithMessage("*connId*");
    }

    [Fact]
    [Trait("Category", "NormalizeConnId")]
    public void NormalizeConnId_PositiveInfinity_ThrowsArgumentException()
    {
        var act = () => SQLite.NormalizeConnId(double.PositiveInfinity);
        act.Should().Throw<ArgumentException>().WithMessage("*connId*");
    }

    [Fact]
    [Trait("Category", "NormalizeConnId")]
    public void NormalizeConnId_String_ThrowsArgumentException()
    {
        var act = () => SQLite.NormalizeConnId("abc");
        act.Should().Throw<ArgumentException>().WithMessage("*connId*");
    }

    // ===========================================================================
    // IsRetryableSqliteException (3 条) — [Trait("Category", "IsRetryableSqliteException")]
    // 判断异常是否为可重试的 SQLite 错误（BUSY, LOCKED）。
    // 实际代码: SQLite.cs L721-726
    // ===========================================================================

    [Fact]
    [Trait("Category", "IsRetryableSqliteException")]
    public void IsRetryableSqliteException_Busy_ReturnsTrue()
    {
        var ex = CreateSqliteException(SQLiteErrorCode.Busy, "database is locked");
        var result = SQLite.IsRetryableSqliteException(ex);
        result.Should().BeTrue();
    }

    [Fact]
    [Trait("Category", "IsRetryableSqliteException")]
    public void IsRetryableSqliteException_Locked_ReturnsTrue()
    {
        var ex = CreateSqliteException(SQLiteErrorCode.Locked, "database table is locked");
        var result = SQLite.IsRetryableSqliteException(ex);
        result.Should().BeTrue();
    }

    [Fact]
    [Trait("Category", "IsRetryableSqliteException")]
    public void IsRetryableSqliteException_Corrupt_ReturnsFalse()
    {
        var ex = CreateSqliteException(SQLiteErrorCode.Corrupt, "database disk image is malformed");
        var result = SQLite.IsRetryableSqliteException(ex);
        result.Should().BeFalse();
    }

    // ===========================================================================
    // ExecuteWithRetry (4 条) — [Trait("Category", "ExecuteWithRetry")]
    // 验证重试逻辑: 首次成功、第 2 次成功、重试耗尽抛出、非重试异常直接抛出。
    // 实际代码: SQLite.cs L731-751
    // ===========================================================================

    [Fact]
    [Trait("Category", "ExecuteWithRetry")]
    public void ExecuteWithRetry_FirstAttemptSucceeds_ReturnsResult()
    {
        var result = SQLite.ExecuteWithRetry(() => 42, "test");
        result.Should().Be(42);
    }

    [Fact]
    [Trait("Category", "ExecuteWithRetry")]
    public void ExecuteWithRetry_SecondAttemptSucceeds_ReturnsResult()
    {
        var callCount = 0;
        int Operation()
        {
            callCount++;
            if (callCount == 1)
                throw CreateSqliteException(SQLiteErrorCode.Busy, "database is locked");
            return 99;
        }
        var result = SQLite.ExecuteWithRetry<int>(Operation, "test");
        result.Should().Be(99);
        callCount.Should().Be(2);
    }

    [Fact]
    [Trait("Category", "ExecuteWithRetry")]
    public void ExecuteWithRetry_AllAttemptsExhausted_Throws()
    {
        var callCount = 0;
        int Operation()
        {
            callCount++;
            throw CreateSqliteException(SQLiteErrorCode.Busy, "database is locked");
        }
        var act = () => SQLite.ExecuteWithRetry<int>(Operation, "test");
        act.Should().Throw<SQLiteException>().WithMessage("*database is locked*");
        // 1 initial attempt + MaxRetryAttempts(5) retries = 6 total calls before rethrow
        callCount.Should().Be(6);
    }

    [Fact]
    [Trait("Category", "ExecuteWithRetry")]
    public void ExecuteWithRetry_NonRetryableException_ThrowsImmediately()
    {
        var callCount = 0;
        int Operation()
        {
            callCount++;
            throw new InvalidOperationException("not retryable");
        }
        var act = () => SQLite.ExecuteWithRetry<int>(Operation, "test");
        act.Should().Throw<InvalidOperationException>().WithMessage("*not retryable*");
        callCount.Should().Be(1);
    }

    // ===========================================================================
    // CalculateRetryDelay (2 条) — [Trait("Category", "CalculateRetryDelay")]
    // 验证指数退避延迟计算（带 ±25% jitter，上限 RetryMaxDelayMs）。
    // 实际代码: SQLite.cs L756-766
    // ===========================================================================

    [Fact]
    [Trait("Category", "CalculateRetryDelay")]
    public void CalculateRetryDelay_Attempt1_WithinExpectedRange()
    {
        // attempt=1: base=50*1=50, capped=50, jitter=±12.5 → [37, 63]
        // 注: 实际随机范围约 [44, 56], 规划书要求 [37, 63] 更宽松, 以此为准。
        for (var i = 0; i < 100; i++)
        {
            var delay = SQLite.CalculateRetryDelay(1);
            delay.Should().BeInRange(37, 63);
        }
    }

    [Fact]
    [Trait("Category", "CalculateRetryDelay")]
    public void CalculateRetryDelay_Attempt5_DoesNotExceedMaxDelay()
    {
        // attempt=5: base=50*16=800, capped=800, jitter=±100 → [700, 900] < 2000
        // 验证即使加上最大 jitter 也不超过 RetryMaxDelayMs (2000)。
        for (var i = 0; i < 100; i++)
        {
            var delay = SQLite.CalculateRetryDelay(5);
            delay.Should().BeLessThanOrEqualTo(2000);
        }
    }
}
