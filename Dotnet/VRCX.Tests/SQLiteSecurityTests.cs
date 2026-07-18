// 设计稿 (Stage 2 solutions-architect 输出, Link+stub 方案)
// 文件名: SQLiteSecurityTests.cs
// 用途: 7.5.9 Phase — SQLite 路径验证器 + PRAGMA 净化器安全加固测试 (46 用例 / 60 执行用例)
// 最终位置: Dotnet/VRCX.Tests/SQLiteSecurityTests.cs (由 implementer 决定)
//
// 依赖策略 (2026-07-18 变更): Link SQLite.cs + ProgramStub + VRCXStorageStub
//   - SQLite.cs 通过 <Compile Include="..\SQLite.cs" Link="SQLite.cs" /> 编译进 VRCX.Tests.dll
//   - Program / VRCXStorage 由测试工程内 Stubs/ 目录的 stub 文件提供
//   - 不 ProjectReference VRCX-Cef.csproj, 不需 [InternalsVisibleTo], 不改 Program.cs
//
// 测试目标方法 (生产代码 Dotnet/SQLite.cs, 被 Link 进测试 assembly):
//   - SQLite.ValidateAndCanonicalizeDatabasePath(string name) → string   [L159, public]
//   - SQLite.SanitizePragmaValue(string key, string val)      → string   [L305, 需 private→internal]
//   - SQLite.ResolveDatabasePath(string name)                 → string   [L126, 需 private→internal, 本测试不直接调用]
//   - SQLite.ValidateDatabaseFile(string path)                → void     [L221, 需 private→internal, 本测试不直接调用]
//   注: 3 个 private→internal 改动仍需执行 — 测试代码不在 SQLite 类内, private 不可见;
//       同 assembly internal 可见, 无需 InternalsVisibleTo。
//
// 测试依赖的 Program 静态成员 (由测试工程内 Stubs/ProgramStub.cs 提供):
//   - Program.AppDataDirectory  [stub: public static field, 可写]
//   - Program.ConfigLocation    [stub: public static property { get; set; }, 可写]
//   注: stub 自定义可写 setter, 生产代码 Dotnet/Program.cs L22 零改动。
//
// 与主设计文档 PHASE_7_5_DESIGN.md 的差异 (基于实际代码核对, 以实际代码为准):
//
// 差异 1 — SEC-PATH-05 错误消息:
//   主设计文档预期: *outside the allowed data directory*
//   实际代码 L203 : 对含分隔符的相对路径先抛 *not an absolute path* (IsPathRooted 检查)
//                   boundary "outside" 分支 (L189-194) 仅对纯文件名 (无分隔符) 触发。
//   本测试修正  : 用 *not an absolute path* 与实际代码一致。
//
// 差异 2 — SEC-NULL-05 错误消息:
//   主设计文档预期: *ASCII letters* 或 *null*
//   实际代码 L312 : Layer 0 正则 ^[A-Za-z0-9_]+$ 不匹配 \0, 抛 *ASCII letters, digits* (消息不含 "null")
//   本测试修正  : 用 *ASCII letters* 与实际代码一致。
//
// 差异 3 — SEC-PATH-07 跨平台:
//   主设计文档建议: Windows 抛 *valid SQLite database extension*, Linux skip
//   实际代码      : Linux 上 "D:" 不被 Path.IsPathRooted 识别为绝对路径, 抛 *not an absolute path*
//   本测试修正  : 用 OperatingSystem.IsWindows() 分支断言两平台各自的真实行为, 不跳过。
//
// 用例计数 (46 条方法 / 60 执行用例):
//   PathTraversal              8  (SEC-PATH-01..08)
//   NullByteInjection          5  (SEC-NULL-01..05)
//   PragmaInjection-KeyWhitelist    7  (SEC-PRAGMA-KEY-01..07)
//   PragmaInjection-ForbiddenKeyBlacklist 7 (SEC-PRAGMA-FORBID-01..07)
//   PragmaInjection-ValueCharBlacklist    4 (SEC-PRAGMA-VAL-01..04)
//   QuoteInjection             3  (SEC-QUOTE-01..03)
//   Boundary                   8  (SEC-BOUND-01..08, 其中 SEC-BOUND-06 为 Theory × 8 InlineData)
//   HappyPath                  4  (SEC-HAPPY-01..04)

namespace VRCX.Tests;

[Collection("SQLiteStaticState")]
[Trait("Component", "SQLite.Security")]
public class SQLiteSecurityTests : IDisposable
{
    private readonly string _origAppDataDir;
    private readonly string _origConfigLocation;
    private readonly string _tempDir;

    public SQLiteSecurityTests()
    {
        // Setup: 保存 Program 静态字段原值 → 创建唯一临时目录 → 赋值
        // 保证每个测试用例都在隔离的 AppDataDirectory 下运行, 互不干扰。
        _origAppDataDir = Program.AppDataDirectory;
        _origConfigLocation = Program.ConfigLocation;
        _tempDir = Path.Combine(Path.GetTempPath(), "VRCX-Tests-" + Guid.NewGuid().ToString("N")[..8]);
        Directory.CreateDirectory(_tempDir);
        Program.AppDataDirectory = _tempDir;
        Program.ConfigLocation = Path.Combine(_tempDir, "VRCX.sqlite3");
    }

    public void Dispose()
    {
        // Teardown: 还原原值 → 删除临时目录 (try/catch 吞掉删除失败, 避免 teardown 抛错掩盖测试失败)
        Program.AppDataDirectory = _origAppDataDir;
        Program.ConfigLocation = _origConfigLocation;
        try { Directory.Delete(_tempDir, recursive: true); } catch { }
    }

    // ===========================================================================
    // PathTraversal (8 条) — [Trait("Category", "PathTraversal")]
    // 验证 ValidateAndCanonicalizeDatabasePath 对路径遍历攻击的拒绝。
    // 实际代码: SQLite.cs L159-215, boundary check L180-209
    // ===========================================================================

    [Fact]
    [Trait("Category", "PathTraversal")]
    public void ValidatePath_RelativePathWithForwardSlashSeparators_ThrowsInvalidOperationException()
    {
        // SEC-PATH-01: "../../evil.db" 含正斜杠分隔符 + 非绝对路径
        //   → L180 hasSeparators=true → L203 IsPathRooted=false → 拒绝
        var act = () => SQLite.ValidateAndCanonicalizeDatabasePath("../../evil.db");
        act.Should().Throw<InvalidOperationException>().WithMessage("*not an absolute path*");
    }

    [Fact]
    [Trait("Category", "PathTraversal")]
    public void ValidatePath_RelativePathWithBackslashSeparators_ThrowsInvalidOperationException()
    {
        // SEC-PATH-02: "..\\..\\evil.db" 含反斜杠分隔符 + 非绝对路径
        //   → L180 hasSeparators=true → L203 IsPathRooted=false → 拒绝
        var act = () => SQLite.ValidateAndCanonicalizeDatabasePath("..\\..\\evil.db");
        act.Should().Throw<InvalidOperationException>().WithMessage("*not an absolute path*");
    }

    [Fact]
    [Trait("Category", "PathTraversal")]
    public void ValidatePath_RelativePathWithDotDotOnly_ThrowsInvalidOperationException()
    {
        // SEC-PATH-03: "../evil.db" 单层 .. 仍含分隔符 + 非绝对路径 → 拒绝
        var act = () => SQLite.ValidateAndCanonicalizeDatabasePath("../evil.db");
        act.Should().Throw<InvalidOperationException>().WithMessage("*not an absolute path*");
    }

    [Fact]
    [Trait("Category", "PathTraversal")]
    public void ValidatePath_PlainFileName_ResolvesInsideAppDataDirectory()
    {
        // SEC-PATH-04: "mydb.db" 纯文件名 (无分隔符, 非裸盘符)
        //   → L140 Path.Join(AppData, name) → L183 走纯文件名分支 → L189 StartsWith(AppData+sep) 通过
        //   → ValidateDatabaseFile 通过 (假设文件不存在) → 返回 canonical
        var result = SQLite.ValidateAndCanonicalizeDatabasePath("mydb.db");
        var expectedPrefix = Path.GetFullPath(_tempDir).TrimEnd(Path.DirectorySeparatorChar)
            + Path.DirectorySeparatorChar;
        result.Should().StartWith(expectedPrefix);
        result.Should().EndWith("mydb.db");
    }

    [Fact]
    [Trait("Category", "PathTraversal")]
    public void ValidatePath_PlainFileNameWithTraversalSuffix_ThrowsInvalidOperationException()
    {
        // SEC-PATH-05: "subdir/../escape.db" 含分隔符 + 非绝对路径
        //   → L180 hasSeparators=true → L203 IsPathRooted("subdir/../escape.db")=false → 拒绝
        //
        // 注 (差异 1): 主设计文档预期 *outside the allowed data directory*, 但实际代码
        //   L203 对含分隔符的相对路径先抛 *not an absolute path* (IsPathRooted 检查在
        //   boundary StartsWith 之前)。boundary "outside" 分支 (L189-194) 仅对纯文件名
        //   (无分隔符) 触发, 本输入含 '/' 走 else 分支。本测试以实际代码为准。
        var act = () => SQLite.ValidateAndCanonicalizeDatabasePath("subdir/../escape.db");
        act.Should().Throw<InvalidOperationException>().WithMessage("*not an absolute path*");
    }

    [Fact]
    [Trait("Category", "PathTraversal")]
    public void ValidatePath_AbsolutePathOutsideAppData_AcceptedIfValidExtension()
    {
        // SEC-PATH-06: 绝对路径 + 合法扩展名
        //   → L180 hasSeparators=true → L203 IsPathRooted=true → 通过 boundary
        //   → ValidateDatabaseFile: 扩展名 .db ✓, 文件名无 ':' ✓, 非保留名 ✓, 非已存在目录 ✓
        //   → 返回 canonical
        // 用唯一文件名避免并发测试或残留文件影响。
        var uniqueName = "external-test-" + Guid.NewGuid().ToString("N")[..8] + ".db";
        var absPath = Path.Combine(Path.GetTempPath(), uniqueName);
        var result = SQLite.ValidateAndCanonicalizeDatabasePath(absPath);
        result.Should().Be(Path.GetFullPath(absPath));
    }

    [Fact]
    [Trait("Category", "PathTraversal")]
    public void ValidatePath_BareDriveLetter_TreatedAsDriveRoot()
    {
        // SEC-PATH-07: "D:" 裸盘符 → ResolveDatabasePath L136-137 返回 "D:\"
        //   跨平台行为分歧:
        //     Windows: "D:\" 是绝对路径 → 通过 boundary → ValidateDatabaseFile 检查扩展名
        //              → Path.GetExtension("D:\")="" → L245 IsNullOrEmpty → 拒绝 "valid SQLite database extension"
        //     Linux  : Path.IsPathRooted("D:\")=false (Linux 绝对路径以 / 开头) → 拒绝 "not an absolute path"
        //
        // 注 (差异 3): 主设计文档建议 Linux skip, 本测试改为分支断言两平台真实行为, 不跳过。
        var act = () => SQLite.ValidateAndCanonicalizeDatabasePath("D:");
        if (OperatingSystem.IsWindows())
        {
            act.Should().Throw<InvalidOperationException>()
                .WithMessage("*valid SQLite database extension*");
        }
        else
        {
            act.Should().Throw<InvalidOperationException>()
                .WithMessage("*not an absolute path*");
        }
    }

    [Fact]
    [Trait("Category", "PathTraversal")]
    public void ValidatePath_AbsolutePathWithRedundantSeparators_Canonicalized()
    {
        // SEC-PATH-08: <temp>/./test-<guid>.db 含冗余 . 段
        //   → Path.GetFullPath 规范化后 . 段被消除 → canonical 无 . 段
        //   → IsPathRooted=true → 通过 boundary → ValidateDatabaseFile 通过 → 返回 canonical
        var uniqueName = "test-" + Guid.NewGuid().ToString("N")[..8] + ".db";
        var input = Path.Combine(Path.GetTempPath(), ".", uniqueName);
        var result = SQLite.ValidateAndCanonicalizeDatabasePath(input);
        var expected = Path.GetFullPath(Path.Combine(Path.GetTempPath(), uniqueName));
        result.Should().Be(expected);
        result.Should().NotContain(Path.DirectorySeparatorChar + "." + Path.DirectorySeparatorChar);
    }

    // ===========================================================================
    // NullByteInjection (5 条) — [Trait("Category", "NullByteInjection")]
    // 验证 null 字节注入攻击的拒绝 (H-1 主门 + ForbiddenPragmaChars 含 \0)。
    // 实际代码: SQLite.cs L162-166 (path 主门) + L330-335 (pragma value Layer 2)
    // ===========================================================================

    [Fact]
    [Trait("Category", "NullByteInjection")]
    public void ValidatePath_WhenNameContainsTrailingNullByte_ThrowsInvalidOperationException()
    {
        // SEC-NULL-01: "evil.db\0" 尾部 null 字节 → L162 主门拒绝 (在任何字符串处理前)
        var act = () => SQLite.ValidateAndCanonicalizeDatabasePath("evil.db\0");
        act.Should().Throw<InvalidOperationException>().WithMessage("*null*");
    }

    [Fact]
    [Trait("Category", "NullByteInjection")]
    public void ValidatePath_WhenNameContainsEmbeddedNullByte_ThrowsInvalidOperationException()
    {
        // SEC-NULL-02: "ev\0il.db" 中间 null 字节 → L162 主门拒绝
        var act = () => SQLite.ValidateAndCanonicalizeDatabasePath("ev\0il.db");
        act.Should().Throw<InvalidOperationException>().WithMessage("*null*");
    }

    [Fact]
    [Trait("Category", "NullByteInjection")]
    public void ValidatePath_WhenNameIsOnlyNullByte_ThrowsInvalidOperationException()
    {
        // SEC-NULL-03: "\0" 仅 null 字节 → L162 主门拒绝
        var act = () => SQLite.ValidateAndCanonicalizeDatabasePath("\0");
        act.Should().Throw<InvalidOperationException>().WithMessage("*null*");
    }

    [Fact]
    [Trait("Category", "NullByteInjection")]
    public void SanitizePragmaValue_WhenValueContainsNullByte_ThrowsInvalidOperationException()
    {
        // SEC-NULL-04: val="5000\0" → L330 Layer 2 ForbiddenPragmaChars 含 \0 → 拒绝
        var act = () => SQLite.SanitizePragmaValue("busy_timeout", "5000\0");
        act.Should().Throw<InvalidOperationException>().WithMessage("*forbidden characters*");
    }

    [Fact]
    [Trait("Category", "NullByteInjection")]
    public void SanitizePragmaValue_WhenKeyContainsNullByte_ThrowsInvalidOperationException()
    {
        // SEC-NULL-05: key="busy_timeout\0" → L312 Layer 0 正则 ^[A-Za-z0-9_]+$ 不匹配 \0 → 拒绝
        //
        // 注 (差异 2): 主设计文档预期 *ASCII letters* 或 *null*, 实际错误消息
        //   "VRCX_Database.options key 'busy_timeout\0' is invalid — PRAGMA key names must
        //    consist only of ASCII letters, digits, and underscores ..."
        //   含 "ASCII letters, digits" 但不含 "null"。本测试用 *ASCII letters* 与实际代码一致。
        var act = () => SQLite.SanitizePragmaValue("busy_timeout\0", "5000");
        act.Should().Throw<InvalidOperationException>().WithMessage("*ASCII letters*");
    }

    // ===========================================================================
    // PragmaInjection — KeyWhitelist (7 条)
    // [Trait("Category", "PragmaInjection")] + [Trait("SubCategory", "KeyWhitelist")]
    // 验证 SanitizePragmaValue Layer 0 键名白名单正则 ^[A-Za-z0-9_]+$ (SEC-3a)。
    // 实际代码: SQLite.cs L312-318
    // ===========================================================================

    [Fact]
    [Trait("Category", "PragmaInjection")]
    [Trait("SubCategory", "KeyWhitelist")]
    public void SanitizePragmaValue_WhenKeyHasSemicolon_ThrowsInvalidOperationException()
    {
        // SEC-PRAGMA-KEY-01: "foo;PRAGMA rekey" 含分号 → 正则不匹配 → 拒绝 (防连接字符串注入)
        var act = () => SQLite.SanitizePragmaValue("foo;PRAGMA rekey", "x");
        act.Should().Throw<InvalidOperationException>().WithMessage("*ASCII letters, digits*");
    }

    [Fact]
    [Trait("Category", "PragmaInjection")]
    [Trait("SubCategory", "KeyWhitelist")]
    public void SanitizePragmaValue_WhenKeyHasLeadingSpace_ThrowsInvalidOperationException()
    {
        // SEC-PRAGMA-KEY-02: " key" 含前导空格 → 正则不匹配 → 拒绝
        //   关键: 防止绕过 ForbiddenPragmaKeys 全字符串匹配 (Layer 1) — " key" 不等于 "key"
        var act = () => SQLite.SanitizePragmaValue(" key", "x");
        act.Should().Throw<InvalidOperationException>().WithMessage("*ASCII letters, digits*");
    }

    [Fact]
    [Trait("Category", "PragmaInjection")]
    [Trait("SubCategory", "KeyWhitelist")]
    public void SanitizePragmaValue_WhenKeyHasEquals_ThrowsInvalidOperationException()
    {
        // SEC-PRAGMA-KEY-03: "key=value" 含等号 → 正则不匹配 → 拒绝
        var act = () => SQLite.SanitizePragmaValue("key=value", "x");
        act.Should().Throw<InvalidOperationException>().WithMessage("*ASCII letters, digits*");
    }

    [Fact]
    [Trait("Category", "PragmaInjection")]
    [Trait("SubCategory", "KeyWhitelist")]
    public void SanitizePragmaValue_WhenKeyIsEmpty_ThrowsInvalidOperationException()
    {
        // SEC-PRAGMA-KEY-04: "" 空字符串 → L312 IsNullOrEmpty → 拒绝
        var act = () => SQLite.SanitizePragmaValue("", "x");
        act.Should().Throw<InvalidOperationException>().WithMessage("*ASCII letters, digits*");
    }

    [Fact]
    [Trait("Category", "PragmaInjection")]
    [Trait("SubCategory", "KeyWhitelist")]
    public void SanitizePragmaValue_WhenKeyIsNull_ThrowsInvalidOperationException()
    {
        // SEC-PRAGMA-KEY-05: null → L312 IsNullOrEmpty → 拒绝
        //   错误消息: "VRCX_Database.options key '' is invalid — ..." (key=null 时 {key} 显示为空)
        //   含 "is invalid" + "ASCII letters, digits"。用 *is invalid* 精确匹配。
        var act = () => SQLite.SanitizePragmaValue(null!, "x");
        act.Should().Throw<InvalidOperationException>().WithMessage("*is invalid*");
    }

    [Fact]
    [Trait("Category", "PragmaInjection")]
    [Trait("SubCategory", "KeyWhitelist")]
    public void SanitizePragmaValue_WhenKeyIsValidAlphanumeric_ReturnsTrimmedValue()
    {
        // SEC-PRAGMA-KEY-06: "busy_timeout" 合法键 (字母+下划线) → 通过三层 → 返回 val.Trim()
        var result = SQLite.SanitizePragmaValue("busy_timeout", "5000");
        result.Should().Be("5000");
    }

    [Fact]
    [Trait("Category", "PragmaInjection")]
    [Trait("SubCategory", "KeyWhitelist")]
    public void SanitizePragmaValue_WhenKeyIsBlacklistedWithNullByte_RejectedByLayer0()
    {
        // SEC-PRAGMA-KEY-07: 验证 Layer 0 先于 Layer 1 (层序防绕过)
        //   key="key\0" — 若 Layer 0 失效, Layer 1 ForbiddenPragmaKeys.Contains("key\0")=false
        //   会绕过黑名单。Layer 0 正则 ^[A-Za-z0-9_]+$ 不匹配 \0 → 先拒绝,
        //   错误消息含 "ASCII letters" (Layer 0), 非 "forbidden for security reasons" (Layer 1)。
        //   这证明 Layer 0 在 Layer 1 之前执行, 防止 null 字节绕过黑名单全字符串匹配。
        var act = () => SQLite.SanitizePragmaValue("key\0", "x");
        act.Should().Throw<InvalidOperationException>()
            .WithMessage("*ASCII letters*");
    }

    // ===========================================================================
    // PragmaInjection — ForbiddenKeyBlacklist (7 条)
    // [Trait("Category", "PragmaInjection")] + [Trait("SubCategory", "ForbiddenKeyBlacklist")]
    // 验证 SanitizePragmaValue Layer 1 加密键黑名单 ForbiddenPragmaKeys (SEC-3b)。
    // 实际代码: SQLite.cs L32-37 (9 个 SEE 键) + L321-326 (检查)
    // ===========================================================================

    [Fact]
    [Trait("Category", "PragmaInjection")]
    [Trait("SubCategory", "ForbiddenKeyBlacklist")]
    public void SanitizePragmaValue_WhenKeyIsForbiddenKey_ThrowsInvalidOperationException()
    {
        // SEC-PRAGMA-FORBID-01: "key" 在 ForbiddenPragmaKeys → Layer 1 拒绝
        var act = () => SQLite.SanitizePragmaValue("key", "x");
        act.Should().Throw<InvalidOperationException>().WithMessage("*forbidden for security reasons*");
    }

    [Fact]
    [Trait("Category", "PragmaInjection")]
    [Trait("SubCategory", "ForbiddenKeyBlacklist")]
    public void SanitizePragmaValue_WhenKeyIsForbiddenRekey_ThrowsInvalidOperationException()
    {
        // SEC-PRAGMA-FORBID-02: "rekey" 在 ForbiddenPragmaKeys → Layer 1 拒绝
        var act = () => SQLite.SanitizePragmaValue("rekey", "x");
        act.Should().Throw<InvalidOperationException>().WithMessage("*forbidden for security reasons*");
    }

    [Fact]
    [Trait("Category", "PragmaInjection")]
    [Trait("SubCategory", "ForbiddenKeyBlacklist")]
    public void SanitizePragmaValue_WhenKeyIsForbiddenHexkey_ThrowsInvalidOperationException()
    {
        // SEC-PRAGMA-FORBID-03: "hexkey" 在 ForbiddenPragmaKeys → Layer 1 拒绝
        var act = () => SQLite.SanitizePragmaValue("hexkey", "x");
        act.Should().Throw<InvalidOperationException>().WithMessage("*forbidden for security reasons*");
    }

    [Fact]
    [Trait("Category", "PragmaInjection")]
    [Trait("SubCategory", "ForbiddenKeyBlacklist")]
    public void SanitizePragmaValue_WhenKeyIsForbiddenTextkeyCaseInsensitive_ThrowsInvalidOperationException()
    {
        // SEC-PRAGMA-FORBID-04: "TEXTKEY" 大写 → ForbiddenPragmaKeys 用 OrdinalIgnoreCase → 匹配 "textkey" → 拒绝
        var act = () => SQLite.SanitizePragmaValue("TEXTKEY", "x");
        act.Should().Throw<InvalidOperationException>().WithMessage("*forbidden for security reasons*");
    }

    [Fact]
    [Trait("Category", "PragmaInjection")]
    [Trait("SubCategory", "ForbiddenKeyBlacklist")]
    public void SanitizePragmaValue_WhenKeyIsForbiddenHexkeyMd5_ThrowsInvalidOperationException()
    {
        // SEC-PRAGMA-FORBID-05: "hexkey_md5" 在 ForbiddenPragmaKeys → Layer 1 拒绝
        var act = () => SQLite.SanitizePragmaValue("hexkey_md5", "x");
        act.Should().Throw<InvalidOperationException>().WithMessage("*forbidden for security reasons*");
    }

    [Theory]
    [InlineData("hexrekey")]
    [InlineData("textrekey")]
    [InlineData("hexdbkey")]
    [InlineData("hexrekey_md5")]
    [Trait("Category", "PragmaInjection")]
    [Trait("SubCategory", "ForbiddenKeyBlacklist")]
    public void SanitizePragmaValue_WhenKeyIsOtherForbiddenKey_ThrowsInvalidOperationException(string key)
    {
        // SEC-PRAGMA-FORBID-06: 补充覆盖 ForbiddenPragmaKeys 9 键中遗漏的 4 个
        //   ForbiddenPragmaKeys (SQLite.cs L32-37) 共 9 键:
        //     key, rekey, hexkey, hexrekey, textkey, textrekey, hexdbkey, hexrekey_md5, hexkey_md5
        //   SEC-PRAGMA-FORBID-01..05 已覆盖 5 个 (key/rekey/hexkey/textkey/hexkey_md5),
        //   本用例补充剩余 4 个 (hexrekey/textrekey/hexdbkey/hexrekey_md5), 验证黑名单完整性。
        var act = () => SQLite.SanitizePragmaValue(key, "x");
        act.Should().Throw<InvalidOperationException>()
            .WithMessage("*forbidden for security reasons*");
    }

    [Theory]
    [InlineData("KEY")]
    [InlineData("Key")]
    [InlineData("ReKey")]
    [InlineData("HEXKEY")]
    [Trait("Category", "PragmaInjection")]
    [Trait("SubCategory", "ForbiddenKeyBlacklist")]
    public void SanitizePragmaValue_WhenKeyIsForbiddenCaseVariant_ThrowsInvalidOperationException(string key)
    {
        // SEC-PRAGMA-FORBID-07: 验证 OrdinalIgnoreCase 对多种大小写变体生效
        //   ForbiddenPragmaKeys 用 StringComparer.OrdinalIgnoreCase (SQLite.cs L32),
        //   与 SEC-PRAGMA-FORBID-04 (TEXTKEY) 互补, 覆盖全大写 / 首字母大写 / 混合大小写变体。
        //   "KEY"→key, "Key"→key, "ReKey"→rekey, "HEXKEY"→hexkey 均应匹配黑名单。
        var act = () => SQLite.SanitizePragmaValue(key, "x");
        act.Should().Throw<InvalidOperationException>()
            .WithMessage("*forbidden for security reasons*");
    }

    // ===========================================================================
    // PragmaInjection — ValueCharBlacklist (4 条)
    // [Trait("Category", "PragmaInjection")] + [Trait("SubCategory", "ValueCharBlacklist")]
    // 验证 SanitizePragmaValue Layer 2 值字符黑名单 ForbiddenPragmaChars (SEC-3c)。
    // 实际代码: SQLite.cs L46 (6 字符: ; ' " \n \r \0) + L330-335 (检查)
    // ===========================================================================

    [Fact]
    [Trait("Category", "PragmaInjection")]
    [Trait("SubCategory", "ValueCharBlacklist")]
    public void SanitizePragmaValue_WhenValueContainsSemicolon_ThrowsInvalidOperationException()
    {
        // SEC-PRAGMA-VAL-01: "5000;PRAGMA rekey=evil" 含分号 → Layer 2 拒绝 (防连接字符串注入)
        var act = () => SQLite.SanitizePragmaValue("busy_timeout", "5000;PRAGMA rekey=evil");
        act.Should().Throw<InvalidOperationException>().WithMessage("*forbidden characters*");
    }

    [Fact]
    [Trait("Category", "PragmaInjection")]
    [Trait("SubCategory", "ValueCharBlacklist")]
    public void SanitizePragmaValue_WhenValueContainsSingleQuote_ThrowsInvalidOperationException()
    {
        // SEC-PRAGMA-VAL-02: "5000'" 含单引号 → Layer 2 拒绝
        var act = () => SQLite.SanitizePragmaValue("busy_timeout", "5000'");
        act.Should().Throw<InvalidOperationException>().WithMessage("*forbidden characters*");
    }

    [Fact]
    [Trait("Category", "PragmaInjection")]
    [Trait("SubCategory", "ValueCharBlacklist")]
    public void SanitizePragmaValue_WhenValueContainsDoubleQuote_ThrowsInvalidOperationException()
    {
        // SEC-PRAGMA-VAL-03: "5000\"" 含双引号 → Layer 2 拒绝
        var act = () => SQLite.SanitizePragmaValue("busy_timeout", "5000\"");
        act.Should().Throw<InvalidOperationException>().WithMessage("*forbidden characters*");
    }

    [Theory]
    [InlineData("5000\n")]
    [InlineData("5000\r")]
    [Trait("Category", "PragmaInjection")]
    [Trait("SubCategory", "ValueCharBlacklist")]
    public void SanitizePragmaValue_WhenValueContainsNewline_ThrowsInvalidOperationException(string val)
    {
        // SEC-PRAGMA-VAL-04: \n 或 \r 换行符 → Layer 2 拒绝 (防行注入)
        var act = () => SQLite.SanitizePragmaValue("busy_timeout", val);
        act.Should().Throw<InvalidOperationException>().WithMessage("*forbidden characters*");
    }

    // ===========================================================================
    // QuoteInjection (3 条) — [Trait("Category", "QuoteInjection")]
    // 验证 Data Source 连接字符串引号注入防护 (H-4)。
    // 实际代码: SQLite.cs L236-241 (ValidateDatabaseFile 步骤 0b) + L330-335 (PragmaValue Layer 2)
    // ===========================================================================

    [Fact]
    [Trait("Category", "QuoteInjection")]
    public void ValidatePath_WhenPathContainsDoubleQuote_ThrowsInvalidOperationException()
    {
        // SEC-QUOTE-01: "evil\".db" 纯文件名含双引号
        //   → Path.Join(AppData, "evil\".db") → GetFullPath → StartsWith AppData 通过
        //   → ValidateDatabaseFile L236 path.Contains('"')=true → 拒绝
        //   跨平台: Linux 上 " 是合法文件名字符, 此 guard 是 defense-in-depth。
        var act = () => SQLite.ValidateAndCanonicalizeDatabasePath("evil\".db");
        act.Should().Throw<InvalidOperationException>().WithMessage("*character '\"'*");
    }

    [Fact]
    [Trait("Category", "QuoteInjection")]
    public void ValidatePath_WhenAbsolutePathContainsDoubleQuote_ThrowsInvalidOperationException()
    {
        // SEC-QUOTE-02: 绝对路径含双引号 → ValidateDatabaseFile L236 拒绝
        // 用唯一文件名避免并发或残留影响。
        var uniqueName = "evil-quote-" + Guid.NewGuid().ToString("N")[..8] + "\".db";
        var absPath = Path.Combine(Path.GetTempPath(), uniqueName);
        var act = () => SQLite.ValidateAndCanonicalizeDatabasePath(absPath);
        act.Should().Throw<InvalidOperationException>().WithMessage("*character '\"'*");
    }

    [Fact]
    [Trait("Category", "QuoteInjection")]
    public void SanitizePragmaValue_WhenValueContainsDoubleQuote_QuoteInjection_ThrowsInvalidOperationException()
    {
        // SEC-QUOTE-03: val="5000\"" → Layer 2 ForbiddenPragmaChars 含 " → 拒绝
        //   与 SEC-PRAGMA-VAL-03 互补: 跨 Category (QuoteInjection vs PragmaInjection) 验证同一防御。
        //   注: 方法名加 _QuoteInjection 后缀以避免与 SEC-PRAGMA-VAL-03 同名方法 CS0111 冲突
        //       (C# 不允许同类同名同参数方法, Trait 不影响方法签名)。
        var act = () => SQLite.SanitizePragmaValue("busy_timeout", "5000\"");
        act.Should().Throw<InvalidOperationException>().WithMessage("*forbidden characters*");
    }

    // ===========================================================================
    // Boundary (8 条) — [Trait("Category", "Boundary")]
    // 验证 ValidateAndCanonicalizeDatabasePath 的边界条件处理。
    // 实际代码: SQLite.cs L168-171 (null/empty/whitespace) + L243-276 (ValidateDatabaseFile)
    // ===========================================================================

    [Fact]
    [Trait("Category", "Boundary")]
    public void ValidatePath_WhenNameIsNull_ReturnsDefaultConfigLocation()
    {
        // SEC-BOUND-01: null → L169 name?.Trim() ?? string.Empty → L170 IsNullOrEmpty → 返回 default
        var result = SQLite.ValidateAndCanonicalizeDatabasePath(null!);
        result.Should().Be(Path.GetFullPath(Program.ConfigLocation));
    }

    [Fact]
    [Trait("Category", "Boundary")]
    public void ValidatePath_WhenNameIsEmptyString_ReturnsDefaultConfigLocation()
    {
        // SEC-BOUND-02: "" → Trim 后 IsNullOrEmpty → 返回 default
        var result = SQLite.ValidateAndCanonicalizeDatabasePath("");
        result.Should().Be(Path.GetFullPath(Program.ConfigLocation));
    }

    [Fact]
    [Trait("Category", "Boundary")]
    public void ValidatePath_WhenNameIsWhitespaceOnly_ReturnsDefaultConfigLocation()
    {
        // SEC-BOUND-03: "   " → Trim 后 IsNullOrEmpty → 返回 default
        var result = SQLite.ValidateAndCanonicalizeDatabasePath("   ");
        result.Should().Be(Path.GetFullPath(Program.ConfigLocation));
    }

    [Fact]
    [Trait("Category", "Boundary")]
    public void ValidatePath_WhenNameHasInvalidExtension_ThrowsInvalidOperationException()
    {
        // SEC-BOUND-04: "evil.txt" → ValidateDatabaseFile L245 扩展名不在 AllowedDatabaseExtensions → 拒绝
        var act = () => SQLite.ValidateAndCanonicalizeDatabasePath("evil.txt");
        act.Should().Throw<InvalidOperationException>().WithMessage("*valid SQLite database extension*");
    }

    [Fact]
    [Trait("Category", "Boundary")]
    public void ValidatePath_WhenNameHasNoExtension_ThrowsInvalidOperationException()
    {
        // SEC-BOUND-05: "evil" → Path.GetExtension 返回 "" → L245 IsNullOrEmpty → 拒绝
        var act = () => SQLite.ValidateAndCanonicalizeDatabasePath("evil");
        act.Should().Throw<InvalidOperationException>().WithMessage("*valid SQLite database extension*");
    }

    [Theory]
    [InlineData("CON.db")]
    [InlineData("PRN.db")]
    [InlineData("AUX.db")]      // SEC-BOUND-06: 唯一未测的非 COM/LPT 系列 (AUX)
    [InlineData("NUL.db")]
    [InlineData("COM1.db")]
    [InlineData("COM2.db")]     // SEC-BOUND-06: COM 系列中间值
    [InlineData("LPT1.db")]     // SEC-BOUND-06: LPT 系列首值
    [InlineData("LPT9.db")]
    [Trait("Category", "Boundary")]
    public void ValidatePath_WhenFileNameIsReservedDeviceName_ThrowsInvalidOperationException(string name)
    {
        // SEC-BOUND-06: 保留设备名 (CON/PRN/AUX/NUL/COM*/LPT*) → ValidateDatabaseFile L263 拒绝
        //   跨平台: Linux 上这些是合法文件名, 但代码用字符串比较 ReservedDeviceNames (OrdinalIgnoreCase),
        //   行为一致 (defense-in-depth, 防止 Windows 上文件创建后被解释为设备)。
        //   InlineData 覆盖: 4 个基础名 + COM 系列首尾与中间值 + LPT 系列首尾值, 验证黑名单完整性。
        var act = () => SQLite.ValidateAndCanonicalizeDatabasePath(name);
        act.Should().Throw<InvalidOperationException>().WithMessage("*reserved system name*");
    }

    [Fact]
    [Trait("Category", "Boundary")]
    public void ValidatePath_WhenPathIsExistingDirectory_ThrowsInvalidOperationException()
    {
        // SEC-BOUND-07: 在 _tempDir 下创建子目录 "existingdir.db", 输入纯文件名
        //   → ResolveDatabasePath 返回 <_tempDir>/existingdir.db
        //   → ValidateDatabaseFile L271 Directory.Exists=true → 拒绝
        var dirPath = Path.Combine(_tempDir, "existingdir.db");
        Directory.CreateDirectory(dirPath);
        var act = () => SQLite.ValidateAndCanonicalizeDatabasePath("existingdir.db");
        act.Should().Throw<InvalidOperationException>().WithMessage("*existing directory*");
    }

    [Fact]
    [Trait("Category", "Boundary")]
    public void ValidatePath_WhenFileNameContainsColon_ThrowsInvalidOperationException()
    {
        // SEC-BOUND-08: ValidateDatabaseFile L253 GetFileName 含 ':' → 拒绝 (Windows ADS risk)
        // 注意: 输入必须是纯文件名 (无分隔符), 否则会先被 boundary check 拒绝 (not an absolute path)
        // "ev:il.db" 是纯文件名 (无 / 或 \), Path.Join(AppData, "ev:il.db") 后
        // ValidateDatabaseFile 检查 GetFileName 含 ':' → L254-259 拒绝
        var act = () => SQLite.ValidateAndCanonicalizeDatabasePath("ev:il.db");
        act.Should().Throw<InvalidOperationException>()
            .WithMessage("*character ':' in the filename*");
    }

    // ===========================================================================
    // HappyPath (4 条) — [Trait("Category", "HappyPath")]
    // 验证合法输入的正确处理 (确保安全加固不破坏正常功能)。
    // ===========================================================================

    [Fact]
    [Trait("Category", "HappyPath")]
    public void ValidatePath_WhenPlainDbFileName_ReturnsCanonicalAbsolutePathInAppData()
    {
        // SEC-HAPPY-01: "vrcx.db" 纯文件名 + .db 扩展 → <AppData>/vrcx.db 规范化路径
        var result = SQLite.ValidateAndCanonicalizeDatabasePath("vrcx.db");
        var expected = Path.GetFullPath(Path.Combine(_tempDir, "vrcx.db"));
        result.Should().Be(expected);
        var expectedPrefix = Path.GetFullPath(_tempDir).TrimEnd(Path.DirectorySeparatorChar)
            + Path.DirectorySeparatorChar;
        result.Should().StartWith(expectedPrefix);
    }

    [Fact]
    [Trait("Category", "HappyPath")]
    public void ValidatePath_WhenDb3Extension_Accepted()
    {
        // SEC-HAPPY-02: "vrcx.db3" → .db3 在 AllowedDatabaseExtensions → 通过
        var result = SQLite.ValidateAndCanonicalizeDatabasePath("vrcx.db3");
        var expected = Path.GetFullPath(Path.Combine(_tempDir, "vrcx.db3"));
        result.Should().Be(expected);
    }

    [Fact]
    [Trait("Category", "HappyPath")]
    public void ValidatePath_WhenSqlite3Extension_Accepted()
    {
        // SEC-HAPPY-03: "vrcx.sqlite3" → .sqlite3 在 AllowedDatabaseExtensions → 通过
        var result = SQLite.ValidateAndCanonicalizeDatabasePath("vrcx.sqlite3");
        var expected = Path.GetFullPath(Path.Combine(_tempDir, "vrcx.sqlite3"));
        result.Should().Be(expected);
    }

    [Fact]
    [Trait("Category", "HappyPath")]
    public void SanitizePragmaValue_WhenValidKeyAndValue_ReturnsTrimmedValue()
    {
        // SEC-HAPPY-04: key="journal_mode" val="  WAL  " → 三层通过 → 返回 "WAL" (val.Trim())
        var result = SQLite.SanitizePragmaValue("journal_mode", "  WAL  ");
        result.Should().Be("WAL");
    }
}
