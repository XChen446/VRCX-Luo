/**
 * C# 桥集成测试加载基建(测试专用,不进生产构建)。
 *
 * 在 vitest 进程内用 node-api-dotnet 加载 Dotnet/VRCX-Electron.csproj 的
 * net9.0 产物(build/Electron/),实例化 VRCX.MySQL / VRCX.PostgreSQL 并注入
 * globalThis,覆盖 vitest.setup.js 的 noopAsync Proxy stub,使 MySQLAdapter /
 * PgSQLAdapter 走真实 C# 桥执行 SQL。
 *
 * 顶层零副作用:默认 `npm test`(MYSQL_TEST_HOST / PG_TEST_HOST 未设)导入
 * 本文件不触发 .NET 加载;`require('node-api-dotnet')` 与 `dotnet.load()` 全部
 * 在函数体内,由测试文件的 env 门控 beforeAll 调用。
 *
 * 全程 OnConnection 路径(ExecuteJsonOnConnection / BeginTransactionOnConnection
 * 带连接串),绕开 C# Init()/IsConnected 的 VRCXStorage 依赖。
 *
 * args 序列化(node-api-dotnet marshal 规则,探针实证):
 * - C# `IDictionary<string, object>` 参数投影为 `Map<string, unknown>`,直接传
 *   普通 JS 对象会抛 "JSValue cannot be casted to target type JSMap"。普通对象
 *   参数必须转 Map(与生产 LINUX 分支 `new Map(Object.entries(args))` 同款转换)。
 * - JS 数组 → C# `object` 参数会 marshal 失败(NormalizeArgs 收不到 object[]/
 *   IList,表现为 Npgsql "bind message supplies 0 parameters")。数组参数必须
 *   显式转为托管 `object[]`(Type.GetType('System.Object') + Array.CreateInstance
 *   + 索引器赋值,探针实证可行)。
 * - JS number → C# object 参数正常(connId 透传即可,无需包装)。
 * loadBridge() 用 Proxy 包裹桥实例:MySQL(命名参数对象)走 Map 转换,
 * PgSQL(位置参数数组)走托管数组转换,保证 adapter 的真实参数路径可执行。
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// createRequire(import.meta.url) 使 require('node-api-dotnet/net9.0') 从本文件
// 所在目录沿 node_modules 链解析到仓库根(不依赖 process.cwd(),vitest 从任何
// 目录启动都稳)。
const requireFromHelper = createRequire(import.meta.url);

/**
 * 把普通 JS 对象参数转为 Map(null/数组/Map 原样透传)。
 * C# `IDictionary<string, object>` 经 node-api-dotnet 投影为 JSMap,
 * 普通对象会触发 "JSValue cannot be casted to target type JSMap"。
 * @param {*} args
 * @returns {*}
 */
function toMapArgs(args) {
    if (
        args == null ||
        typeof args !== 'object' ||
        Array.isArray(args) ||
        args instanceof Map
    ) {
        return args;
    }
    return new Map(Object.entries(args));
}

/**
 * 惰性获取 System.Object 的 Type(进程内缓存)。
 * @param {object} dotnet - node-api-dotnet 根对象
 * @returns {() => object} 返回 Type 的工厂函数
 */
function makeObjectTypeGetter(dotnet) {
    /** @type {object|null} */
    let objectType = null;
    return () => {
        if (!objectType) {
            objectType = dotnet.System.Type.GetType('System.Object');
        }
        return objectType;
    };
}

/**
 * 把 JS 数组转为托管 object[](索引器赋值,探针实证)。
 * C# `NormalizeArgs` 只认 object[]/IList;node-api-dotnet 对 JS 数组 →
 * object 参数 marshal 失败(变 null,Npgsql 报 "bind message supplies 0
 * parameters"),必须显式构造托管数组。
 * @param {*} args
 * @param {object} dotnet - node-api-dotnet 根对象
 * @param {() => object} getObjectType - System.Object Type 工厂
 * @returns {*}
 */
function toBridgeArgs(args, dotnet, getObjectType) {
    if (Array.isArray(args)) {
        const arr = dotnet.System.Array.CreateInstance(
            getObjectType(),
            args.length
        );
        for (let i = 0; i < args.length; i++) {
            arr[i] = args[i];
        }
        return arr;
    }
    return toMapArgs(args);
}

/**
 * 桥实例代理:方法调用的每个参数先过 convert。
 * MySQL(命名参数对象):toMapArgs(普通对象 → Map)。
 * PgSQL(位置参数数组):toBridgeArgs(数组 → 托管 object[],对象 → Map)。
 * 桥方法参数均为 string/number/null/object[]/IDictionary,转换无损。
 * @param {object} instance
 * @param {(arg: *) => *} convert - 参数转换函数
 * @returns {object}
 */
function wrapBridge(instance, convert) {
    return new Proxy(instance, {
        get(target, prop, receiver) {
            const value = Reflect.get(target, prop, receiver);
            if (typeof value !== 'function') return value;
            return (...callArgs) => value.apply(target, callArgs.map(convert));
        }
    });
}

/**
 * 从模块位置向上找含 package.json 的仓库根目录。
 * @returns {string|null} 仓库根绝对路径;未找到返回 null
 */
export function findRepoRoot() {
    let dir = import.meta.dirname;
    for (;;) {
        if (existsSync(path.join(dir, 'package.json'))) return dir;
        const parent = path.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

/**
 * 解析 C# 桥程序集路径。
 *
 * 产物名双名兼容:CI 全新构建产出 build/Electron/VRCX-K.dll(AssemblyName
 * 漂移后),本地旧产物为 VRCX-Electron.dll —— 优先前者,回退后者。
 *
 * @param {string} [baseDir] 产物目录,默认 <repoRoot>/build/Electron
 * @returns {string|null} dll 绝对路径;未找到返回 null
 */
export function resolveBridgeDll(baseDir) {
    const dir = baseDir ?? path.join(findRepoRoot() ?? '', 'build', 'Electron');
    for (const name of ['VRCX-K.dll', 'VRCX-Electron.dll']) {
        const candidate = path.join(dir, name);
        if (existsSync(candidate)) return candidate;
    }
    return null;
}

/**
 * @type {{ dotnet: object, mysql: object, pg: object, dllPath: string } | null}
 */
let cachedBridge = null;

/**
 * 幂等加载 C# 桥并注入 globalThis.MySQL / globalThis.PostgreSQL。
 *
 * 进程内单例:首次调用加载并缓存,后续调用直接返回缓存。产物缺失时抛错,
 * 错误消息带构建指引。
 *
 * @returns {{ dotnet: object, mysql: object, pg: object, dllPath: string }}
 */
export function loadBridge() {
    if (cachedBridge) return cachedBridge;
    const dllPath = resolveBridgeDll();
    if (!dllPath) {
        throw new Error(
            '未找到 C# 桥产物(build/Electron/VRCX-K.dll 或 VRCX-Electron.dll),' +
                '请先执行:dotnet build Dotnet/VRCX-Electron.csproj -c Debug'
        );
    }
    const dotnet = requireFromHelper('node-api-dotnet/net9.0');
    dotnet.load(dllPath);
    const getObjectType = makeObjectTypeGetter(dotnet);
    const mysql = wrapBridge(new dotnet.VRCX.MySQL(), toMapArgs);
    const pg = wrapBridge(new dotnet.VRCX.PostgreSQL(), (arg) =>
        toBridgeArgs(arg, dotnet, getObjectType)
    );
    globalThis.MySQL = mysql;
    globalThis.PostgreSQL = pg;
    cachedBridge = { dotnet, mysql, pg, dllPath };
    return cachedBridge;
}

/**
 * MySQL 连接串:mysql:// URI 形式(经 MySQLAdapter._buildConnectionString 真值
 * 路径转换为 Server=..;Port=..;User ID=..;Password=..;Database=..)。
 * 密码不做 URL 编码(CI/local 均为纯字母数字;含特殊字符的连接串本任务不支持)。
 *
 * env 变量(与 CI 一致):MYSQL_TEST_HOST / MYSQL_TEST_PORT / MYSQL_TEST_USER /
 * MYSQL_TEST_PASSWORD / MYSQL_TEST_DATABASE
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function buildMySqlConnectionString(env = process.env) {
    const host = env.MYSQL_TEST_HOST ?? '127.0.0.1';
    const port = env.MYSQL_TEST_PORT ?? '3306';
    const user = env.MYSQL_TEST_USER ?? 'root';
    const password = env.MYSQL_TEST_PASSWORD ?? 'root';
    const database = env.MYSQL_TEST_DATABASE ?? 'vrcx_test';
    return `mysql://${user}:${password}@${host}:${port}/${database}`;
}

/**
 * PG 连接串:Npgsql 风格(PgSQLAdapter 构造原样透传,无 URI 解析)。
 *
 * env 变量(与 CI 一致):PG_TEST_HOST / PG_TEST_PORT / PG_TEST_USER /
 * PG_TEST_PASSWORD / PG_TEST_DB
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function buildPgConnectionString(env = process.env) {
    const host = env.PG_TEST_HOST ?? 'localhost';
    const port = env.PG_TEST_PORT ?? '5432';
    const user = env.PG_TEST_USER ?? 'vrcx';
    const password = env.PG_TEST_PASSWORD ?? 'vrcx';
    const database = env.PG_TEST_DB ?? 'vrcx';
    return `Host=${host};Port=${port};Username=${user};Password=${password};Database=${database}`;
}
