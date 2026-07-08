import { dbVars } from '../database';

import { adapter } from './adapter/index.js';

const avatarFavorites = {
    addAvatarToCache(entry) {
        adapter.insert('cache_avatar', {
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
        }, 'replace');
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
        var ref = {
            timeSpent: 0,
            avatarId
        };
        await adapter.execute(
            (row) => {
                ref.timeSpent = row[0];
            },
            `SELECT time FROM ${adapter.userTable(dbVars.userPrefix, 'avatar_history')} WHERE avatar_id = @avatarId`,
            {
                '@avatarId': avatarId
            }
        );

        return ref;
    },

    async getAllAvatarTimeSpent() {
        const map = new Map();
        await adapter.execute((row) => {
            map.set(row[0], row[1] || 0);
        }, `SELECT avatar_id, time FROM ${adapter.userTable(dbVars.userPrefix, 'avatar_history')}`);

        return map;
    },

    addAvatarTimeSpent(avatarId, timeSpent) {
        adapter.increment(`${adapter.userTable(dbVars.userPrefix, 'avatar_history')}`, 'time', timeSpent, { avatar_id: avatarId });
    },

    async getAvatarHistory(currentUserId, limit = 100) {
        var data = [];
        await adapter.execute((dbRow) => {
            var row = {
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
            };
            data.push(row);
        },             `SELECT * FROM ${adapter.userTable(dbVars.userPrefix, 'avatar_history')} INNER JOIN cache_avatar ON cache_avatar.id = ${adapter.userTable(dbVars.userPrefix, 'avatar_history')}.avatar_id WHERE author_id != @currentUserId ORDER BY ${adapter.userTable(dbVars.userPrefix, 'avatar_history')}.created_at DESC LIMIT @limit`,
            {
                '@currentUserId': currentUserId,
                '@limit': limit
            }
        );
        return data;
    },

    async getCachedAvatarById(id) {
        var data = null;
        await adapter.execute(
            (dbRow) => {
                data = {
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
            `SELECT * FROM cache_avatar WHERE id = @id`,
            {
                '@id': id
            }
        );
        return data;
    },

    clearAvatarHistory() {
        adapter.executeNonQuery(`DELETE FROM ${adapter.userTable(dbVars.userPrefix, 'avatar_history')}`);
        adapter.executeNonQuery('DELETE FROM cache_avatar');
    },

    addAvatarToFavorites(avatarId, groupName) {
        adapter.insert('favorite_avatar', {
            avatar_id: avatarId,
            group_name: groupName,
            created_at: new Date().toJSON()
        }, 'replace');
    },

    renameAvatarFavoriteGroup(newGroupName, groupName) {
        adapter.update('favorite_avatar',
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
        var data = [];
        await adapter.execute((dbRow) => {
            var row = {
                created_at: dbRow[1],
                avatarId: dbRow[2],
                groupName: dbRow[3]
            };
            data.push(row);
        }, 'SELECT * FROM favorite_avatar');
        return data;
    },

    removeAvatarFromCache(avatarId) {
        adapter.delete('cache_avatar', { id: avatarId });
    },

    async getAvatarCache() {
        var data = [];
        await adapter.execute((dbRow) => {
            var row = {
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
            data.push(row);
        }, 'SELECT * FROM cache_avatar');
        return data;
    }
};

export { avatarFavorites };
