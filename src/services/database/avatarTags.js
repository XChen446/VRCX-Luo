import { adapter } from './adapter/index.js';

const avatarTags = {
    async getAvatarTags(avatarId) {
        const tags = [];
        await adapter.execute(
            (dbRow) => {
                tags.push({ tag: dbRow[0], color: dbRow[1] || null });
            },
            `SELECT tag, color FROM avatar_tags WHERE avatar_id = @avatar_id`,
            {
                '@avatar_id': avatarId
            }
        );
        return tags;
    },

    async getAllAvatarTags() {
        const map = new Map();
        await adapter.execute((dbRow) => {
            const avatarId = dbRow[0];
            const tag = dbRow[1];
            const color = dbRow[2] || null;
            if (!map.has(avatarId)) {
                map.set(avatarId, []);
            }
            map.get(avatarId).push({ tag, color });
        }, `SELECT avatar_id, tag, color FROM avatar_tags`);
        return map;
    },

    async getAllDistinctTags() {
        const tags = [];
        await adapter.execute((dbRow) => {
            tags.push(dbRow[0]);
        }, `SELECT DISTINCT tag FROM avatar_tags ORDER BY tag`);
        return tags;
    },

    async addAvatarTag(avatarId, tag, color = null) {
        await adapter.insert('avatar_tags', {
            avatar_id: avatarId,
            tag: tag,
            color: color
        }, 'ignore');
    },

    async updateAvatarTagColor(avatarId, tag, color) {
        await adapter.update('avatar_tags',
            { color: color },
            { avatar_id: avatarId, tag: tag }
        );
    },

    async removeAvatarTag(avatarId, tag) {
        await adapter.delete('avatar_tags', {
            avatar_id: avatarId,
            tag: tag
        });
    },

    async removeAllAvatarTags(avatarId) {
        await adapter.delete('avatar_tags', { avatar_id: avatarId });
    }
};

export { avatarTags };
