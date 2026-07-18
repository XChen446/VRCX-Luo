// 设计稿 (Stage 2 solutions-architect 输出, Link+stub 方案)
// 文件名: Usings.cs
// 用途: VRCX.Tests 工程全局 using
// 最终位置: Dotnet/VRCX.Tests/Usings.cs (由 implementer 决定)
//
// 说明:
//   - global using Xunit;                 // [Fact]/[Theory]/[InlineData]/[Collection]/[Trait]
//   - global using FluentAssertions;      // .Should().Throw<>().WithMessage("*...*") / .Be() / .StartWith()
//   - global using System;                // InvalidOperationException, Guid, OperatingSystem
//   - global using System.IO;             // Path, Directory, File
//   - global using VRCX;                  // SQLite (Link'd from Dotnet/SQLite.cs), Program (stub), VRCXStorage (stub)
//
// 注意: ImplicitUsings=enable 已隐式引入 System.* 常用命名空间, 此处显式声明仅为可读性 + 明确意图。
//
// 变更 (2026-07-18): 移除 global using System.Reflection
//   原因: 原 ProjectReference 方案预留用于 InternalsVisibleTo 反射;
//         新 Link+stub 方案不需 InternalsVisibleTo (同 assembly internal 直接可见), 不需反射。

global using Xunit;
global using FluentAssertions;
global using System;
global using System.IO;
global using VRCX;
