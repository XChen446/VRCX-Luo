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

import sqliteService from '../sqlite.js';
import configRepository from '../config.js';

// MIGRATION_ENABLED: 切换新旧迁移系统
// 设置为 true 以使用新的 .map 迁移系统
const MIGRATION_ENABLED = true;

// 目标数据库版本 (需与 vrcx.js 中的 TARGET_DB_VERSION 保持一致)
const TARGET_VERSION = 16;

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
    const migrations = await scanMigrationDir();
    if (migrations.length === 0) {
        console.log('[迁移] 未找到迁移文件');
        return true;
    }

    // 阶段 2: 筛选并排序迁移
    const sortedMigrations = topologicalSort(
        migrations.filter(m => m.version > currentVersion && m.version <= targetVersion)
    );

    if (sortedMigrations.length === 0) {
        console.log(`[迁移] 范围内无迁移版本 (${currentVersion}, ${targetVersion}]`);
        return true;
    }

    console.log(`[迁移] 已选中 ${sortedMigrations.length} 个迁移: ${sortedMigrations.map(m => m.version).join(' -> ')}`);

    // 阶段 3: 执行迁移
    for (const migration of sortedMigrations) {
        await executeMigration(migration, options);
    }

    console.log('[迁移] 所有迁移执行完成');
    return true;
}

/**
 * 扫描 migrations 目录，收集所有 .map 文件。
 * @returns {Promise<Array<{version: number, type: string, path: string, data: object}>>}
 */
async function scanMigrationDir() {
    const migrations = [];

    // 尝试动态导入所有版本目录
    // 结构: /migrations/{version}/{schema,data}.map
    for (let version = 1; version <= TARGET_VERSION; version++) {
        try {
            const schemaData = await loadMapFile(version, 'schema');
            if (schemaData) {
                migrations.push({
                    version,
                    type: 'schema',
                    data: schemaData,
                    hasData: false
                });
            }

            const dataData = await loadMapFile(version, 'data');
            if (dataData) {
                migrations.push({
                    version,
                    type: 'data',
                    data: dataData,
                    hasSchema: !!schemaData
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
        throw new Error(`无效的 .map 文件: 期望类型 "${type}", 实际为 "${data.type}"`);
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

    return data;
}

/**
 * 基于依赖关系对迁移进行拓扑排序。
 * @param {Array} migrations
 * @returns {Array} 排序后的迁移
 */
function topologicalSort(migrations) {
    // 按版本分组
    const byVersion = new Map();
    for (const m of migrations) {
        if (!byVersion.has(m.version)) {
            byVersion.set(m.version, []);
        }
        byVersion.get(m.version).push(m);
    }

    // 版本排序
    const sortedVersions = Array.from(byVersion.keys()).sort((a, b) => a - b);
    const result = [];

    for (const version of sortedVersions) {
        const versionMigrations = byVersion.get(version);
        // 同一版本内，schema 始终在 data 之前
        const schema = versionMigrations.find(m => m.type === 'schema');
        const data = versionMigrations.find(m => m.type === 'data');

        if (schema) result.push(schema);
        if (data) result.push(data);
    }

    return result;
}

/**
 * 执行单个迁移 (schema 或 data)。
 * @param {object} migration
 * @param {object} options
 */
async function executeMigration(migration, options) {
    const { version, type, data } = migration;

    console.log(`[迁移] 执行 v${version} ${type}.map: ${data.description || '无描述'}`);

    try {
        if (type === 'schema') {
            await executeSchemaMigration(data, version);
        } else if (type === 'data') {
            await executeDataMigration(data, options, version);
        }

        // 执行成功后记录检查点
        await recordCheckpoint(version);

        console.log(`[迁移] v${version} ${type} 完成`);
    } catch (err) {
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
    } else {
        console.warn(`[迁移] 未知 schema 操作: ${operation}`);
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
            const sql = `ALTER TABLE ${table} ADD COLUMN ${column} ${type} DEFAULT ${defaultValue}`;
            await sqliteService.executeNonQuery(sql);
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
            const sql = `CREATE INDEX IF NOT EXISTS ${indexName} ON ${table} (${columnsStr})`;
            await sqliteService.executeNonQuery(sql);
            console.log(`[迁移] 已在 ${table} 上创建索引 ${indexName}`);
        } catch (e) {
            console.error(`[迁移] 创建索引 ${indexName} 失败:`, e);
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
            const sql = `ALTER TABLE ${table} DROP COLUMN ${column}`;
            await sqliteService.executeNonQuery(sql);
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
            const sql = `ALTER TABLE ${table} RENAME TO ${newName}`;
            await sqliteService.executeNonQuery(sql);
            console.log(`[迁移] 已重命名 ${table} 为 ${newName}`);
        } catch (e) {
            console.error(`[迁移] 重命名 ${table} 失败:`, e);
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
            const sql = `DELETE FROM ${table} WHERE ${where}`;
            const result = await sqliteService.executeNonQuery(sql);
            if (result > 0) {
                console.log(`[迁移] 从 ${table} 删除了 ${result} 行`);
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
            const result = await sqliteService.executeNonQuery(sql, flattenArgs(resolvedSet));
            if (result > 0) {
                console.log(`[迁移] 更新了 ${table} 的 ${result} 行`);
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
            const colList = columns.join(', ');
            const placeholders = columns.map((_, i) => `@p${i}`).join(', ');
            const sql = `INSERT OR IGNORE INTO ${table} (${colList}) VALUES (${placeholders})`;

            const args = {};
            columns.forEach((col, i) => {
                args[`@p${i}`] = values[i];
            });

            const result = await sqliteService.executeNonQuery(sql, args);
            if (result > 0) {
                console.log(`[迁移] 插入到 ${table} ${result} 行`);
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
    // 匹配以 suffix 结尾的任何表
    const suffix = tablePattern.substring(1); // 移除开头的 %
    const escapedSuffix = suffix.replace(/[_%]/g, '\\$&');

    const tables = [];
    await sqliteService.execute((row) => {
        tables.push(row[0]);
    }, `SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE '%${suffix}' ESCAPE '\\'`);

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
        // 在当前数据库执行子查询
        // 注: 这是简化实现，实际使用可能需要行迭代
        if (!sql) {
            console.warn(`[迁移] 子查询参数 ${paramName} 缺少 SQL`);
            return null;
        }

        // 对于简单标量子查询，执行并返回第一个值
        const rows = await executeWithParams(sql, {});
        return rows && rows.length > 0 ? rows[0][0] : null;
    }

    if (source === 'old_db') {
        // 在旧数据库上执行子查询 (用于迁移)
        if (!options.oldDbPath) {
            console.warn(`[迁移] 参数 ${paramName} 缺少 oldDbPath`);
            return null;
        }

        const rows = await sqliteService.executeReadOnly(options.oldDbPath, sql, {});
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
    return new Promise((resolve, reject) => {
        const results = [];
        sqliteService.execute((row) => {
            results.push(Array.from(row));
        }, sql, args, (err) => {
            if (err) {
                reject(err);
            } else {
                resolve(results);
            }
        });
    });
}

/**
 * 从对象构建 UPDATE 的 SET 子句。
 * @param {object} setObj - { column: value, ... }
 * @returns {string} - "col1 = @col1, col2 = @col2, ..."
 */
function buildSetClause(setObj) {
    return Object.keys(setObj).map(key => `${key} = @${key}`).join(', ');
}

/**
 * 将对象展平为 SQLite executeNonQuery 的 @key 参数。
 * @param {object} obj
 * @returns {object}
 */
function flattenArgs(obj) {
    const args = {};
    for (const [key, value] of Object.entries(obj)) {
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

/**
 * 遗留迁移函数 (用于回退)。
 * 这些函数在过渡期间保留以维持向后兼容。
 */
const legacyMigrations = {
    async runLegacyFixes() {
        const database = window.database;
        await database.cleanLegendFromFriendLog();
        await database.fixGameLogTraveling();
        await database.fixNegativeGPS();
        await database.fixBrokenLeaveEntries();
        await database.fixBrokenGroupInvites();
        await database.fixBrokenNotifications();
        await database.fixBrokenGroupChange();
        await database.fixCancelFriendRequestTypo();
        await database.fixBrokenGameLogDisplayNames();
        await database.upgradeDatabaseVersion();
        await database.vacuum();
        await database.optimize();
    }
};

export {
    runMigrations,
    MIGRATION_ENABLED,
    TARGET_VERSION,
    legacyMigrations
};
