import { dbVars } from '../database';

import { adapter } from './adapter/index.js';

const avatarFavorites = {
    addAvatarToCache(entry) {
        adapter.insert(
            'cache_avatar',
            {
                id: entry.id,
                added_at: new Date().toJSON(),
                author_id: entry.authorId,
                author_name: entry.authorName,
                created_at: entry.created_at,
                description: entry.description,
                image_url: entry.imageUrl,
                name: entry.name,
                release_status: entry.releaseStatus,
                thumbnail_image_url: entry.thumbnailImageUrl,
                updated_at: entry.updated_at,
                version: entry.version
            },
            'replace'
        );
    },

    addAvatarToHistory(avatarId) {
        const createdAt = new Date().toJSON();
        adapter.upsertPartial(
            `${adapter.userTable(dbVars.userPrefix, 'avatar_history')}`,
            { avatar_id: avatarId, created_at: createdAt, time: 0 },
            { created_at: createdAt },
            'avatar_id'
        );
    },

    async getAvatarTimeSpent(avatarId) {
        const dbRow = await adapter.selectOne(
            adapter.userTable(dbVars.userPrefix, 'avatar_history'),
            ['time'],
            { avatar_id: avatarId }
        );
        return {
            timeSpent: dbRow ? dbRow[0] : 0,
            avatarId
        };
    },

    async getAllAvatarTimeSpent() {
        const rows = await adapter.select(
            adapter.userTable(dbVars.userPrefix, 'avatar_history'),
            ['avatar_id', 'time']
        );
        const map = new Map();
        for (const row of rows) {
            map.set(row[0], row[1] || 0);
        }
        return map;
    },

    addAvatarTimeSpent(avatarId, timeSpent) {
        adapter.increment(
            `${adapter.userTable(dbVars.userPrefix, 'avatar_history')}`,
            'time',
            timeSpent,
            { avatar_id: avatarId }
        );
    },

    async getAvatarHistory(currentUserId, limit = 100) {
        const historyTable = adapter.userTable(
            dbVars.userPrefix,
            'avatar_history'
        );
        const rows = await adapter.selectJoin({
            from: historyTable,
            alias: 'h',
            joins: [
                {
                    type: 'INNER',
                    table: 'cache_avatar',
                    alias: 'c',
                    on: 'c.id = h.avatar_id'
                }
            ],
            columns: ['h.*', 'c.*'],
            where: 'c.author_id != @currentUserId',
            params: { currentUserId },
            order: 'h.created_at DESC',
            limit
        });
        return rows.map((dbRow) => ({
            id: dbRow[0],
            authorId: dbRow[5],
            authorName: dbRow[6],
            created_at: dbRow[7],
            description: dbRow[8],
            imageUrl: dbRow[9],
            name: dbRow[10],
            releaseStatus: dbRow[11],
            thumbnailImageUrl: dbRow[12],
            updated_at: dbRow[13],
            version: dbRow[14]
        }));
    },

    async getCachedAvatarById(id) {
        const dbRow = await adapter.selectOne('cache_avatar', '*', { id: id });
        if (!dbRow) return null;
        return {
            id: dbRow[0],
            authorId: dbRow[2],
            authorName: dbRow[3],
            created_at: dbRow[4],
            description: dbRow[5],
            imageUrl: dbRow[6],
            name: dbRow[7],
            releaseStatus: dbRow[8],
            thumbnailImageUrl: dbRow[9],
            updated_at: dbRow[10],
            version: dbRow[11]
        };
    },

    async clearAvatarHistory() {
        await adapter.withTransaction(async () => {
            await adapter.deleteAll(
                adapter.userTable(dbVars.userPrefix, 'avatar_history')
            );
            await adapter.deleteAll('cache_avatar');
        });
    },

    addAvatarToFavorites(avatarId, groupName) {
        adapter.insert(
            'favorite_avatar',
            {
                avatar_id: avatarId,
                group_name: groupName,
                created_at: new Date().toJSON()
            },
            'replace'
        );
    },

    renameAvatarFavoriteGroup(newGroupName, groupName) {
        adapter.update(
            'favorite_avatar',
            { group_name: newGroupName },
            { group_name: groupName }
        );
    },

    deleteAvatarFavoriteGroup(groupName) {
        adapter.delete('favorite_avatar', { group_name: groupName });
    },

    removeAvatarFromFavorites(avatarId, groupName) {
        adapter.delete('favorite_avatar', {
            avatar_id: avatarId,
            group_name: groupName
        });
    },

    async getAvatarFavorites() {
        const rows = await adapter.select('favorite_avatar', '*');
        return rows.map((dbRow) => ({
            created_at: dbRow[1],
            avatarId: dbRow[2],
            groupName: dbRow[3]
        }));
    },

    removeAvatarFromCache(avatarId) {
        adapter.delete('cache_avatar', { id: avatarId });
    },

    async getAvatarCache() {
        const rows = await adapter.select('cache_avatar', '*');
        return rows.map((dbRow) => ({
            id: dbRow[0],
            authorId: dbRow[2],
            authorName: dbRow[3],
            created_at: dbRow[4],
            description: dbRow[5],
            imageUrl: dbRow[6],
            name: dbRow[7],
            releaseStatus: dbRow[8],
            thumbnailImageUrl: dbRow[9],
            updated_at: dbRow[10],
            version: dbRow[11]
        }));
    }
};

export { avatarFavorites };
