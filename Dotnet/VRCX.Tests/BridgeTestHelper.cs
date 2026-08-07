// 设计稿 (Stage 2 solutions-architect 输出, PR #17 回归测试共享基础设施)
// 文件名: BridgeTestHelper.cs
// 用途: 三引擎 (SQLite/PostgreSQL/MySQL) connId 桥接回归测试的共享 helper
//       (internal static class, 无测试用例, 仅服务 3 个 BridgeTests 文件)
// 最终位置: Dotnet/VRCX.Tests/BridgeTestHelper.cs
//
// 依赖策略 (同 SQLiteRetryTests.cs): Link SQLite.cs / PostgreSQL.cs / MySQL.cs 编译进
//   VRCX.Tests.dll, 同 assembly internal 直接可见, 不需 [InternalsVisibleTo],
//   不改任何生产代码。桥接测试只触达 Execute* 的 connId 归一化早抛点
//   (NormalizeConnId 在访问 DB 之前执行), 不建真实连接。
//
// 用例计数:
//   NormalizeConnId: SQLite 4 (补缺, 另 10 条在 SQLiteRetryTests.cs) + PG 14 + MySQL 14 = 32
//   桥接 (ExecuteJson/Execute/ExecuteNonQuery × 3 无效值): 3 文件 × 9 = 27
//   合计 59 条 (全套 79 + 59 = 138)
//
// 判别断言说明 (PR #17 修复目标 = connId 参数类型 object? + NormalizeConnId 归一化):
//   GetMethodOrFail — 以精确参数类型数组定位 public instance 方法。若 connId 参数
//   类型回退为 long?, 则定位失败返回 null → Assert.Fail (签名漂移, 测试不可跳过,
//   绝不 Skip)。消息明确指向 PR #17 修复目标。
//   AssertDomainException — 桥接调用判别器:
//     ① 裸 ArgumentException (反射绑定层, 参数类型不匹配) → Assert.Fail
//        ("桥接绑定层 ArgumentException — 回归 (PR #17 修复目标)")
//     ② TargetInvocationException (域内异常的反射包装) → 断言 InnerException 为
//        ArgumentException 且消息含 "connId" (严格版, 其它任何 inner 类型 → Fail)
//     ③ 未抛异常 → Assert.Fail ("域内早抛点未命中")
//
// F1: 无效值代表 "abc" (string) 为 NormalizeConnId switch 的 else 分支代表 —
//     uint/float/decimal 等非 int/long/整值 double 的装箱类型与 string 一样
//     不匹配任何显式分支, 落入同一 else 分支 → ArgumentException。
//     有效值事实源 (ValidNormalizeCases, 5 条, MemberData 可承载部分):
//       null→null / DBNull.Value→null / 1→1L / 999L→999L / 3.0d→3L
//     无效值事实源 (InvalidNormalizeCases, 8 条):
//       3.14d / NaN / ±Infinity / 1e300d / MaxValue / MinValue / "abc"
//
// F2 (xUnit 反射限制, 2026-08-07 实测): Missing.Value 不能作为 Theory 的 MemberData
//     行参数 — xUnit 反射调用测试方法时, 参数数组中的 Missing.Value 被反射绑定器
//     解释为"使用参数默认值"标记, 因理论参数无默认值而抛
//     "Missing parameter does not have a default value"。
//     → Missing 用例从 MemberData 移出, 由 PG/MySQL 各文件独立 [Fact] 覆盖
//       (同 SQLiteRetryTests.cs 的 NormalizeConnId_Missing_ReturnsNull 先例,
//       直接调用不受反射影响)。覆盖与用例计数不变 (5 + 1 + 8 = 14 / 文件)。

using System.Reflection;

namespace VRCX.Tests;

internal static class BridgeTestHelper
{
    /// <summary>
    /// 以精确参数类型数组定位 public instance 方法; 定位失败 (签名漂移,
    /// 如 connId 回退为 long?) 即 Assert.Fail — 测试不可跳过。
    /// </summary>
    public static MethodInfo GetMethodOrFail(Type type, string name, params Type[] parameterTypes)
    {
        var method = type.GetMethod(
            name,
            BindingFlags.Public | BindingFlags.Instance,
            binder: null,
            types: parameterTypes,
            modifiers: null);
        if (method == null)
        {
            var signature = string.Join(", ", Array.ConvertAll(parameterTypes, t => t.Name));
            Assert.Fail(
                $"GetMethod 未找到 {type.Name}.{name}({signature}) — 签名漂移 " +
                $"(connId 参数回退为 long? 等) 意味着 PR #17 修复目标 (connId object? + " +
                $"NormalizeConnId 归一化) 已被破坏, 此回归测试不可跳过");
        }
        return method;
    }

    /// <summary>
    /// 桥接调用判别器 (见文件头 ②): 只接受域内 inner ArgumentException 且消息含
    /// "connId" (C2 严格版); 裸 ArgumentException (绑定层) 与未抛异常均 Fail。
    /// </summary>
    public static void AssertDomainException(MethodInfo method, object? instance, object?[] args)
    {
        try
        {
            method.Invoke(instance, args);
        }
        catch (TargetInvocationException ex)
        {
            var inner = ex.InnerException;
            if (inner is ArgumentException ae &&
                ae.Message.Contains("connId", StringComparison.Ordinal))
            {
                return;
            }
            Assert.Fail(
                $"域内异常不符: 期望 InnerException 为消息含 \"connId\" 的 " +
                $"ArgumentException, 实际 inner={inner?.GetType().FullName ?? "null"}, " +
                $"message=\"{inner?.Message}\" — 回归 (PR #17 修复目标)");
            return;
        }
        catch (ArgumentException)
        {
            Assert.Fail("桥接绑定层 ArgumentException — 回归 (PR #17 修复目标)");
            return;
        }
        Assert.Fail("域内早抛点未命中 — 未抛异常 (PR #17 修复目标)");
    }

    /// <summary>
    /// NormalizeConnId 有效值单一事实源 (5 条 MemberData 可承载部分), 供 PG/MySQL
    /// 全量 Theory 共享。Missing.Value 用例因 xUnit 反射限制 (见文件头 F2) 不在
    /// MemberData 内, 由各文件独立 [Fact] 覆盖。
    /// 元素格式: (object? 输入, long? 期望)。
    /// </summary>
    public static IEnumerable<object?[]> ValidNormalizeCases { get; } = new object?[][]
    {
        new object?[] { null, null },
        new object?[] { DBNull.Value, null },
        new object?[] { (int)1, (long)1 },
        new object?[] { (long)999, (long)999 },
        new object?[] { (double)3.0, (long)3 },
    };

    /// <summary>
    /// NormalizeConnId 无效值单一事实源 (8 条), 供 PG/MySQL 全量 Theory 共享。
    /// 元素格式: (object? 输入), 全部应抛 ArgumentException 且消息含 "connId"。
    /// </summary>
    public static IEnumerable<object?[]> InvalidNormalizeCases { get; } = new object?[][]
    {
        new object?[] { (double)3.14 },
        new object?[] { double.NaN },
        new object?[] { double.PositiveInfinity },
        new object?[] { double.NegativeInfinity },
        new object?[] { (double)1e300 },
        new object?[] { double.MaxValue },
        new object?[] { double.MinValue },
        new object?[] { "abc" },
    };
}
