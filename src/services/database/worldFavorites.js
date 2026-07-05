import { adapter } from './adapter/index.js';

const worldFavorites = {
    addWorldToCache(entry) {
        adapter.insert('cache_world', 'replace', {
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
        });
    },

    addWorldToFavorites(worldId, groupName) {
        adapter.insert('favorite_world', 'replace', {
            world_id: worldId,
            group_name: groupName,
            created_at: new Date().toJSON()
        });
    },

    renameWorldFavoriteGroup(newGroupName, groupName) {
        adapter.update('favorite_world',
            { group_name: newGroupName },
            { group_name: groupName }
        );
    },

    deleteWorldFavoriteGroup(groupName) {
        adapter.delete('favorite_world', { group_name: groupName });
    },

    removeWorldFromFavorites(worldId, groupName) {
        adapter.delete('favorite_world', {
            world_id: worldId,
            group_name: groupName
        });
    },

    async getWorldFavorites() {
        var data = [];
        await adapter.execute((dbRow) => {
            var row = {
                created_at: dbRow[1],
                worldId: dbRow[2],
                groupName: dbRow[3]
            };
            data.push(row);
        }, 'SELECT * FROM favorite_world');
        return data;
    },

    removeWorldFromCache(worldId) {
        adapter.delete('cache_world', { id: worldId });
    },

    async getWorldCache() {
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
        }, 'SELECT * FROM cache_world');
        return data;
    },

    async getCachedWorldById(id) {
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
            `SELECT * FROM cache_world WHERE id = @id`,
            {
                '@id': id
            }
        );
        return data;
    }
};

export { worldFavorites };
