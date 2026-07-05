import { adapter } from './adapter/index.js';

const tableAlter = {
    async upgradeDatabaseVersion() {
        await this.updateTableForGroupNames();
        await this.addFriendLogFriendNumber();
        await this.updateTableForAvatarHistory();
        await this.addPerformanceIndexes();
    },

    async updateTableForGroupNames() {
        var tables = await adapter.listTables('%_feed_gps');
        tables.push(...await adapter.listTables('%_feed_online_offline'));
        if (!tables.includes('gamelog_location')) tables.push('gamelog_location');
        for (var tableName of tables) {
            try {
                await adapter.executeNonQuery(
                    `ALTER TABLE ${tableName} ADD COLUMN group_name TEXT DEFAULT ''`
                );
            } catch (e) {
                e = e.toString();
                if (e.indexOf('duplicate column name') === -1) {
                    console.error(e);
                }
            }
        }
        try {
            await adapter.executeNonQuery(
                `ALTER TABLE gamelog_location DROP COLUMN groupName`
            );
        } catch (e) {
            e = e.toString();
            if (e.indexOf('no such column') === -1) {
                console.error(e);
            }
        }
    },

    async addFriendLogFriendNumber() {
        var tables = await adapter.listTables('%_friend_log_current');
        tables.push(...await adapter.listTables('%_friend_log_history'));
        for (var tableName of tables) {
            try {
                await adapter.executeNonQuery(
                    `ALTER TABLE ${tableName} ADD COLUMN friend_number INTEGER DEFAULT 0`
                );
            } catch (e) {
                e = e.toString();
                if (e.indexOf('duplicate column name') === -1) {
                    console.error(e);
                }
            }
        }
    },

    async updateTableForAvatarHistory() {
        var tables = await adapter.listTables('%_avatar_history');
        for (var tableName of tables) {
            try {
                await adapter.executeNonQuery(
                    `ALTER TABLE ${tableName} ADD COLUMN time INTEGER DEFAULT 0`
                );
            } catch (e) {
                e = e.toString();
                if (e.indexOf('duplicate column name') === -1) {
                    console.error(e);
                }
            }
        }
    },

    async addPerformanceIndexes() {
        await adapter.createIndex('idx_gamelog_location_world_created', 'gamelog_location', ['world_id', 'created_at']);
        await adapter.createIndex('idx_gamelog_jl_location', 'gamelog_join_leave', ['location']);
        await adapter.createIndex('idx_gamelog_jl_user_created', 'gamelog_join_leave', ['user_id', 'created_at']);
        await adapter.createIndex('idx_gamelog_jl_display_created', 'gamelog_join_leave', ['display_name', 'created_at']);

        var tables = await adapter.listTables('%_friend_log_history');
        for (var tableName of tables) {
            try {
                await adapter.createIndex(`${tableName}_user_id_idx`, tableName, ['user_id']);
            } catch (e) {
                console.error(e);
            }
        }
    }
};

export { tableAlter };
