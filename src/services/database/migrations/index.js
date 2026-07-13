/**
 * 数据库迁移运行器
 *
 * 提供基于 .map JSON 文件的声明式数据库迁移系统。
 * 每个版本有独立的目录，包含 schema.map 和/或 data.map 文件。
 *
 * 功能特性:
 * - 基于版本号的迁移排序
 * - 通配符表名展开 (%_前缀匹配)
 * - 参数解析 (子查询、固定值、旧库)
 * - 幂等性操作 (可安全重复执行)
 * - 版本中途检查点记录
 * - 拓扑依赖排序
 */

import { adapter } from '../adapter/index.js';
import configRepository from '../../config.js';

/**
 * 从 currentVersion 迁移到 targetVersion，执行所有迁移。
 *
 * @param {number} currentVersion - 当前数据库版本 (0 或正数)
 * @param {number} targetVersion - 目标版本
 * @param {object} [options] - 迁移选项
 * @param {string} [options.oldDbPath] - 旧数据库路径 (用于迁移)
 * @returns {Promise<boolean>} - 全部成功返回 true
 */
async function runMigrations(currentVersion, targetVersion, options = {}) {
    if (currentVersion >= targetVersion) {
        console.log(`[迁移] 无需迁移: ${currentVersion} >= ${targetVersion}`);
        return true;
    }

    console.log(`[迁移] 开始从 v${currentVersion} 迁移到 v${targetVersion}`);

    // 阶段 1: 扫描并收集所有迁移文件
    const migrations = await scanMigrationDir(targetVersion);
    if (migrations.length === 0) {
        console.log('[迁移] 未找到迁移文件');
        return true;
    }

    // 阶段 2: 筛选并排序迁移
    const sortedMigrations = topologicalSort(
        migrations.filter(
            (m) => m.version > currentVersion && m.version <= targetVersion
        )
    );

    if (sortedMigrations.length === 0) {
        console.log(
            `[迁移] 范围内无迁移版本 (${currentVersion}, ${targetVersion}]`
        );
        return true;
    }

    console.log(
        `[迁移] 已选中 ${sortedMigrations.length} 个迁移: ${sortedMigrations.map((m) => m.version).join(' -> ')}`
    );

    // 获取当前数据库引擎（全局统一，避免重复调用）
    const currentEngine = getDatabaseEngine();

    // 阶段 3: 执行迁移
    for (const migration of sortedMigrations) {
        await executeMigration(migration, options, currentEngine);
    }

    // 迁移完成后执行维护命令
    try {
        await adapter.vacuum();
        await adapter.optimize();
    } catch (err) {
        console.warn('[迁移] 迁移后维护命令执行失败（非关键）:', err.message);
    }

    console.log('[迁移] 所有迁移执行完成');
    return true;
}

/**
 * 扫描 migrations 目录，收集所有 .map 文件。
 * 由调用者指定最大版本号，而非依赖内部常量。
 * @param {number} maxVersion - 最大扫描版本号
 * @returns {Promise<Array<{version: number, type: string, data: object}>>}
 */
async function scanMigrationDir(maxVersion) {
    const migrations = [];

    // 动态导入 map 文件，由调用者传入 maxVersion 控制扫描范围
    // 结构: /migrations/{version}/{schema,data}.map
    for (let version = 1; version <= maxVersion; version++) {
        try {
            const schemaData = await loadMapFile(version, 'schema');
            if (schemaData) {
                migrations.push({
                    version,
                    type: 'schema',
                    data: schemaData
                });
            }

            const dataData = await loadMapFile(version, 'data');
            if (dataData) {
                migrations.push({
                    version,
                    type: 'data',
                    data: dataData
                });
            }
        } catch (e) {
            // 该版本迁移文件不存在，跳过
        }
    }

    return migrations;
}

/**
 * 加载指定版本和类型的 .map 文件。
 * @param {number} version
 * @param {string} type - 'schema' 或 'data'
 * @returns {Promise<object|null>}
 */
async function loadMapFile(version, type) {
    // 动态导入 map 文件
    // 允许 Vite 将文件打包到 bundle 中
    try {
        const path = `./${version}/${type}.map`;
        const module = await import(/* @vite-ignore */ path);
        const data = module.default || module;
        return validateMapFile(data, type);
    } catch (e) {
        // 文件不存在
        return null;
    }
}

/**
 * 验证 .map 文件结构。
 * @param {object} data - 解析后的 JSON 数据
 * @param {string} type - 期望的类型 ('schema' 或 'data')
 * @returns {object} 验证后的数据
 */
function validateMapFile(data, type) {
    if (!data || typeof data !== 'object') {
        throw new Error('无效的 .map 文件: 不是对象');
    }

    if (typeof data.version !== 'number') {
        throw new Error('无效的 .map 文件: 缺少或无效的 "version" 字段');
    }

    if (data.type !== type) {
        throw new Error(
            `无效的 .map 文件: 期望类型 "${type}", 实际为 "${data.type}"`
        );
    }

    if (type === 'schema') {
        if (!Array.isArray(data.changes)) {
            throw new Error('无效的 .map 文件: schema 类型需要 "changes" 数组');
        }
    } else if (type === 'data') {
        if (!Array.isArray(data.fixes)) {
            throw new Error('无效的 .map 文件: data 类型需要 "fixes" 数组');
        }
    }

    // 校验 database 字段（如果存在）
    if (data.database !== undefined && data.database !== null) {
        validateDatabaseField(data.database);
    }

    return data;
}

/**
 * 校验 database 字段结构。
 * @param {object} database - database 字段值
 */
function validateDatabaseField(database) {
    if (typeof database !== 'object' || Array.isArray(database)) {
        throw new Error('无效的 .map 文件: "database" 字段必须是对象');
    }

    const validKeys = ['before', 'after'];
    for (const key of validKeys) {
        const val = database[key];
        if (val !== undefined && val !== null && typeof val !== 'string') {
            throw new Error(`无效的 .map 文件: "database.${key}" 必须是字符串`);
        }
    }
}

/**
 * 获取当前数据库引擎类型。
 * @returns {string} 引擎类型标识（当前固定返回 "sqlite"）
 */
function getDatabaseEngine() {
    return 'sqlite';
}

/**
 * 检查迁移的 database 限制与当前引擎是否兼容。
 * @param {object|null|undefined} database - map 文件中的 database 字段
 * @param {string} engine - 当前数据库引擎
 */
function checkDatabaseCompatibility(database, engine) {
    if (!database || typeof database !== 'object') return;

    const check = (key, label) => {
        const val = database[key];
        if (
            val &&
            typeof val === 'string' &&
            val.toLowerCase() !== engine.toLowerCase()
        ) {
            throw new Error(
                `数据库引擎不匹配: 迁移要求 ${label} = "${val}", 当前引擎为 "${engine}"`
            );
        }
    };

    check('before', 'database.before');
    check('after', 'database.after');
}

/**
 * 基于依赖关系对迁移进行拓扑排序 (Kahn 算法)。
 *
 * 解析每个 migration.data.dependencies 字段，构建 DAG 并排序。
 * 依赖语义：
 *   - data.map 的 dependencies: [N] 表示依赖于 vN 的 schema 迁移
 *   - schema.map 的 dependencies: [N] 表示依赖于 vN 的 schema 迁移
 *   - 同一版本内隐式 schema → data
 *   - 跨版本按版本号 + dependencies 排序
 *
 * 检测到循环依赖时回退到简单版本排序。
 *
 * @param {Array} migrations
 * @returns {Array} 排序后的迁移
 */
function topologicalSort(migrations) {
    if (migrations.length === 0) return [];

    // 构建节点索引
    const nodeMap = new Map(); // key: "v{version}-{type}" → migration
    for (const m of migrations) {
        nodeMap.set(`${m.version}-${m.type}`, m);
    }

    // Kahn 算法：邻接表 + 入度
    const adj = new Map();
    const inDegree = new Map();

    for (const m of migrations) {
        const id = `${m.version}-${m.type}`;
        adj.set(id, []);
        inDegree.set(id, 0);
    }

    // 边 1: 同版本内 schema → data (隐式)
    for (const m of migrations) {
        if (m.type === 'data') {
            const schemaKey = `${m.version}-schema`;
            if (nodeMap.has(schemaKey)) {
                adj.get(schemaKey).push(`${m.version}-data`);
                inDegree.set(
                    `${m.version}-data`,
                    inDegree.get(`${m.version}-data`) + 1
                );
            }
        }
    }

    // 边 2: 显式 dependencies
    // data.map → 依赖指定版本的 schema
    // schema.map → 依赖指定版本的 schema
    for (const m of migrations) {
        const deps = m.data.dependencies || [];
        if (!Array.isArray(deps)) continue;
        const myKey = `${m.version}-${m.type}`;
        for (const depVer of deps) {
            const depType = 'schema'; // 都依赖 schema
            const depKey = `${depVer}-${depType}`;
            if (nodeMap.has(depKey) && depKey !== myKey) {
                adj.get(depKey).push(myKey);
                inDegree.set(myKey, inDegree.get(myKey) + 1);
            }
        }
    }

    // 边 3: 跨版本顺序 — 每个版本的最后一个迁移连接到下一版本的第一个迁移
    const sortedNodes = Array.from(nodeMap.keys()).sort((a, b) => {
        const [vA] = a.split('-');
        const [vB] = b.split('-');
        return parseInt(vA) - parseInt(vB);
    });
    for (let i = 0; i < sortedNodes.length - 1; i++) {
        const [vCurr] = sortedNodes[i].split('-');
        const [vNext] = sortedNodes[i + 1].split('-');
        if (Number(vNext) > Number(vCurr)) {
            adj.get(sortedNodes[i]).push(sortedNodes[i + 1]);
            inDegree.set(
                sortedNodes[i + 1],
                inDegree.get(sortedNodes[i + 1]) + 1
            );
        }
    }

    // Kahn: 从入度为 0 的节点开始
    const queue = [];
    for (const [id, deg] of inDegree) {
        if (deg === 0) queue.push(id);
    }

    const result = [];
    while (queue.length > 0) {
        // 稳定排序：同入度时按版本号 + schema优先
        queue.sort((a, b) => {
            const [vA, tA] = a.split('-');
            const [vB, tB] = b.split('-');
            if (vA !== vB) return parseInt(vA) - parseInt(vB);
            return tA === 'schema' ? -1 : 1;
        });

        const id = queue.shift();
        const [verStr, type] = id.split('-');
        const match = migrations.find(
            (m) => m.version === parseInt(verStr) && m.type === type
        );
        if (match) result.push(match);

        for (const next of adj.get(id) || []) {
            const newDeg = inDegree.get(next) - 1;
            inDegree.set(next, newDeg);
            if (newDeg === 0) queue.push(next);
        }
    }

    // 循环依赖检测
    if (result.length !== migrations.length) {
        throw new Error(
            `[迁移] DAG 拓扑排序检测到循环引用：已解析 ${result.length}/${migrations.length} 个节点，` +
                `剩余节点存在无法满足的依赖关系，终止迁移`
        );
    }

    return result;
}

/**
 * 执行单个迁移 (schema 或 data)。
 * @param {object} migration
 * @param {object} options
 * @param {string} engine - 当前数据库引擎
 */
async function executeMigration(migration, options, engine) {
    const { version, type, data } = migration;

    // 检查 database 引擎兼容性
    checkDatabaseCompatibility(data.database, engine);

    console.log(
        `[迁移] 执行 v${version} ${type}.map: ${data.description || '无描述'}`
    );

    // 每个版本包一层事务
    // 注意：同版本内 schema.map 和 data.map 是分开的两个事务（各自执行一次 executeMigration）
    // 如果 data fix 失败而 schema change 成功，未更新的版本号会阻止下次重试（checkpoint 在 COMMIT 前）
    // 但由于所有操作设计为幂等，重试迁移即可安全恢复
    try {
        await adapter.begin();

        if (type === 'schema') {
            await executeSchemaMigration(data, version);
        } else if (type === 'data') {
            await executeDataMigration(data, options, version);
        }

        // 执行成功后记录检查点
        await recordCheckpoint(version);
        await adapter.commit();

        console.log(`[迁移] v${version} ${type} 完成`);
    } catch (err) {
        try {
            await adapter.rollback();
        } catch (rollbackErr) {
            console.error(`[迁移] v${version} ${type} 回滚失败:`, rollbackErr);
        }
        console.error(`[迁移] v${version} ${type} 失败:`, err);
        throw new Error(`迁移 v${version} (${type}) 失败: ${err.message}`);
    }
}

/**
 * 执行 schema 迁移 (add_column, create_index)。
 * @param {object} schemaData
 * @param {number} version
 */
async function executeSchemaMigration(schemaData, version) {
    const operations = schemaData.changes || [];

    for (const op of operations) {
        await executeSchemaOperation(op);
    }
}

/**
 * 执行单个 schema 操作。
 * @param {object} op
 */
async function executeSchemaOperation(op) {
    const { table, operation } = op;

    if (operation === 'add_column') {
        await executeAddColumn(table, op);
    } else if (operation === 'create_index') {
        await executeCreateIndex(table, op);
    } else if (operation === 'drop_column') {
        await executeDropColumn(table, op);
    } else if (operation === 'rename_table') {
        await executeRenameTable(table, op);
    } else if (operation === 'execute_sql') {
        await executeRawSql(table, op);
    } else {
        console.warn(`[迁移] 未知 schema 操作: ${operation}`);
    }
}

/**
 * 执行原始 SQL 操作（用于 schema 迁移中的非 DDL 逻辑，如数据迁移）。
 * @param {string} tablePattern
 * @param {object} op
 */
async function executeRawSql(tablePattern, op) {
    const { sql } = op;
    if (!sql) {
        console.warn('[迁移] execute_sql 操作缺少 sql 字段');
        return;
    }
    try {
        await adapter.executeNonQuery(sql);
        console.log(`[迁移] 已执行 SQL: ${sql.substring(0, 80)}...`);
    } catch (e) {
        console.error(`[迁移] 执行 SQL 失败:`, e);
        throw e;
    }
}

/**
 * 执行 ADD COLUMN 操作 (支持幂等)。
 * @param {string} tablePattern
 * @param {object} op
 */
async function executeAddColumn(tablePattern, op) {
    const { column, type, default: defaultValue } = op;
    const tables = await expandWildcard(tablePattern);

    for (const table of tables) {
        try {
            const columnDef = `${column} ${type} DEFAULT ${defaultValue}`;
            await adapter.alterTableAddColumn(table, columnDef);
            console.log(`[迁移] 已添加列 ${column} 到 ${table}`);
        } catch (e) {
            const errStr = e.toString();
            // 幂等处理: 忽略 "duplicate column name" 错误
            if (errStr.includes('duplicate column name')) {
                console.log(`[迁移] 列 ${column} 已存在于 ${table}，跳过`);
            } else if (errStr.includes('no such table')) {
                console.warn(`[迁移] 表 ${table} 不存在，跳过`);
            } else {
                throw e;
            }
        }
    }
}

/**
 * 执行 CREATE INDEX 操作 (支持幂等)。
 * @param {string} tablePattern
 * @param {object} op
 */
async function executeCreateIndex(tablePattern, op) {
    const { name, columns } = op;
    const tables = await expandWildcard(tablePattern);

    for (const table of tables) {
        const indexName = name || `${table}_${columns.join('_')}_idx`;
        const columnsStr = columns.join(', ');

        try {
            await adapter.createIndex(indexName, table, columns);
            console.log(`[迁移] 已在 ${table} 上创建索引 ${indexName}`);
        } catch (e) {
            console.error(`[迁移] 创建索引 ${indexName} 失败:`, e);
            throw e;
        }
    }
}

/**
 * 执行 DROP COLUMN 操作。
 * @param {string} tablePattern
 * @param {object} op
 */
async function executeDropColumn(tablePattern, op) {
    const { column } = op;
    const tables = await expandWildcard(tablePattern);

    for (const table of tables) {
        try {
            await adapter.alterTableDropColumn(table, column);
            console.log(`[迁移] 已删除 ${table} 的列 ${column}`);
        } catch (e) {
            const errStr = e.toString();
            // 幂等处理: 忽略 "no such column" 错误
            if (errStr.includes('no such column')) {
                console.log(`[迁移] 列 ${column} 不存在于 ${table}，跳过`);
            } else {
                throw e;
            }
        }
    }
}

/**
 * 执行 RENAME TABLE 操作。
 * @param {string} tablePattern
 * @param {object} op
 */
async function executeRenameTable(tablePattern, op) {
    const { newName } = op;
    const tables = await expandWildcard(tablePattern);

    for (const table of tables) {
        try {
            await adapter.alterTableRename(table, newName);
            console.log(`[迁移] 已重命名 ${table} 为 ${newName}`);
        } catch (e) {
            const errStr = e.toString();
            // 幂等处理: 表已被重命名或不存在，跳过
            if (errStr.includes('no such table')) {
                console.log(
                    `[迁移] 表 ${table} 不存在（可能已被重命名），跳过`
                );
            } else if (errStr.includes('already exists')) {
                console.log(`[迁移] 目标表 ${newName} 已存在，跳过`);
            } else {
                console.error(`[迁移] 重命名 ${table} 失败:`, e);
                throw e;
            }
        }
    }
}

/**
 * 执行 data 迁移 (delete, update, insert)。
 * @param {object} dataData
 * @param {object} options
 * @param {number} version
 */
async function executeDataMigration(dataData, options, version) {
    const operations = dataData.fixes || [];
    const params = dataData.params || {};

    for (const op of operations) {
        await executeDataOperation(op, params, options);
    }
}

/**
 * 执行单个 data 操作。
 * @param {object} op
 * @param {object} params - 参数定义
 * @param {object} options - 运行时选项
 */
async function executeDataOperation(op, params, options) {
    const { table, operation } = op;

    if (operation === 'delete') {
        await executeDelete(table, op);
    } else if (operation === 'update') {
        await executeUpdate(table, op, params, options);
    } else if (operation === 'insert') {
        await executeInsert(table, op);
    } else {
        console.warn(`[迁移] 未知 data 操作: ${operation}`);
    }
}

/**
 * 执行 DELETE 操作。
 * @param {string} tablePattern
 * @param {object} op
 */
async function executeDelete(tablePattern, op) {
    const { where } = op;
    const tables = await expandWildcard(tablePattern);

    for (const table of tables) {
        try {
            const result = await adapter.deleteWhere(table, where);
            if (Number(result) > 0) {
                console.log(`[迁移] 从 ${table} 删除了 ${Number(result)} 行`);
            }
        } catch (e) {
            console.error(`[迁移] 从 ${table} 删除失败:`, e);
        }
    }
}

/**
 * 执行 UPDATE 操作 (带参数解析)。
 * @param {string} tablePattern
 * @param {object} op
 * @param {object} params
 * @param {object} options
 */
async function executeUpdate(tablePattern, op, params, options) {
    const { set, where } = op;
    const tables = await expandWildcard(tablePattern);

    for (const table of tables) {
        // 解析 set 子句中的 @param 引用
        const resolvedSet = await resolveParamsInObject(set, params, options);
        const setClause = buildSetClause(resolvedSet);

        try {
            const sql = `UPDATE ${table} SET ${setClause} WHERE ${where}`;
            const result = await adapter.executeNonQuery(
                sql,
                flattenArgs(resolvedSet)
            );
            if (Number(result) > 0) {
                console.log(`[迁移] 更新了 ${table} 的 ${Number(result)} 行`);
            }
        } catch (e) {
            console.error(`[迁移] 更新 ${table} 失败:`, e);
        }
    }
}

/**
 * 执行 INSERT 操作 (支持幂等)。
 * @param {string} tablePattern
 * @param {object} op
 */
async function executeInsert(tablePattern, op) {
    const { columns, values } = op;
    const tables = await expandWildcard(tablePattern);

    for (const table of tables) {
        try {
            const data = {};
            columns.forEach((col, i) => {
                data[col] = values[i];
            });
            const result = await adapter.insert(table, data, 'ignore');
            if (Number(result) > 0) {
                console.log(`[迁移] 插入到 ${table} ${Number(result)} 行`);
            }
        } catch (e) {
            console.error(`[迁移] 插入到 ${table} 失败:`, e);
        }
    }
}

/**
 * 展开通配符表名模式为实际表名。
 * @param {string} tablePattern - 例如 '%_feed_gps' 或 'gamelog_location'
 * @returns {Promise<string[]>} - 匹配的表名列表
 */
async function expandWildcard(tablePattern) {
    // 精确匹配 (无通配符)
    if (!tablePattern.startsWith('%')) {
        return [tablePattern];
    }

    // 通配符模式: %_suffix
    // adapter.listTables 等价查询但不含 ESCAPE '\\'（通配符模式不含反斜杠，可忽略）
    const tables = await adapter.listTables(tablePattern);

    return tables;
}

/**
 * 解析对象中的 @param 引用。
 * @param {object} obj - 可能包含 @param 引用的对象
 * @param {object} params - 参数定义
 * @param {object} options - 运行时选项
 * @returns {Promise<object>} - 已解析值的对象
 */
async function resolveParamsInObject(obj, params, options) {
    const result = {};

    for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'string' && value.startsWith('@')) {
            const paramName = value.substring(1);
            result[key] = await resolveParam(paramName, params, options);
        } else {
            result[key] = value;
        }
    }

    return result;
}

/**
 * 解析单个参数。
 * @param {string} paramName
 * @param {object} params
 * @param {object} options
 * @returns {Promise<*>}
 */
async function resolveParam(paramName, params, options) {
    const paramDef = params[paramName];

    if (!paramDef) {
        // 参数未定义，按原样返回 (可能是字面值 @value)
        return paramName;
    }

    const { source, sql, bind } = paramDef;

    if (source === 'fixed') {
        return paramDef.value;
    }

    if (source === 'subquery') {
        // 在当前数据库执行子查询，返回第一个结果行的第一列
        if (!sql) {
            console.warn(`[迁移] 子查询参数 ${paramName} 缺少 SQL`);
            return null;
        }

        // 如果定义了 bind 参数，构造参数化查询的 args
        // bind 数组中的值从 paramDef 的对应字段获取
        let queryArgs = {};
        if (Array.isArray(bind) && bind.length > 0) {
            for (const key of bind) {
                if (paramDef[key] !== undefined) {
                    queryArgs[`@${key}`] = paramDef[key];
                }
            }
        }

        const rows = await executeWithParams(sql, queryArgs);
        return rows && rows.length > 0 ? rows[0][0] : null;
    }

    if (source === 'sql_embed') {
        // SQL 嵌入模式：返回原始 SQL 文本，用于构建带子查询的 SET 子句
        // 适用于无法用标量参数化查询实现的场景（如逐行相关子查询）
        if (!sql) {
            console.warn(`[迁移] 参数 ${paramName} 缺少 SQL`);
            return null;
        }
        // 基本安全校验：确保嵌入内容是 SQL 子查询（以 ( 开头）
        const trimmed = sql.trim();
        if (!trimmed.startsWith('(')) {
            console.warn(
                `[迁移] sql_embed 参数 ${paramName} 应以 ( 开头，实际: ${trimmed.slice(0, 40)}`
            );
            return null;
        }
        // 特殊标记，表示这不是一个值而是要嵌入的 SQL 片段
        return { __sqlEmbed: true, sql: trimmed };
    }

    if (source === 'old_db') {
        // 在旧数据库上执行子查询 (用于迁移)
        if (!options.oldDbPath) {
            console.warn(`[迁移] 参数 ${paramName} 缺少 oldDbPath`);
            return null;
        }

        const rows = await adapter.executeReadOnly(options.oldDbPath, sql, {});
        return rows && rows.length > 0 ? rows[0][0] : null;
    }

    return paramDef.value;
}

/**
 * 带参数执行 SQL。
 * @param {string} sql
 * @param {object} args
 * @returns {Promise<Array>}
 */
async function executeWithParams(sql, args) {
    const results = [];
    try {
        await adapter.execute(
            (row) => {
                results.push(Array.from(row));
            },
            sql,
            args
        );
        return results;
    } catch (e) {
        console.error('[迁移] 子查询执行失败:', e);
        return [];
    }
}

/**
 * 从对象构建 UPDATE 的 SET 子句。
 * 支持两种值类型：
 *   - 普通值 → 参数化 @key 占位符
 *   - sql_embed → 直接嵌入原始 SQL（如相关子查询）
 * @param {object} setObj - { column: value, ... }
 * @returns {string} - "col1 = @col1, col2 = (SELECT ...), ..."
 */
function buildSetClause(setObj) {
    return Object.keys(setObj)
        .map((key) => {
            const val = setObj[key];
            if (val && typeof val === 'object' && val.__sqlEmbed) {
                return `${key} = ${val.sql}`;
            }
            return `${key} = @${key}`;
        })
        .join(', ');
}

/**
 * 将对象展平为 SQLite executeNonQuery 的 @key 参数。
 * 自动跳过 __sqlEmbed 类型的值（已嵌入 SQL，无需参数化）。
 * @param {object} obj
 * @returns {object}
 */
function flattenArgs(obj) {
    const args = {};
    for (const [key, value] of Object.entries(obj)) {
        if (value && typeof value === 'object' && value.__sqlEmbed) continue;
        args[`@${key}`] = value;
    }
    return args;
}

/**
 * 记录迁移检查点。
 * @param {number} version
 */
async function recordCheckpoint(version) {
    await configRepository.setInt('VRCX_databaseVersion', version);
    console.log(`[迁移] 检查点已记录: VRCX_databaseVersion = ${version}`);
}

export { runMigrations };
