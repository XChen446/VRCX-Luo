import { adapter } from './adapter/index.js';

const avatarTags = {
    async getAvatarTags(avatarId) {
        const rows = await adapter.select('avatar_tags', ['tag', 'color'], {
            avatar_id: avatarId
        });
        return rows.map((dbRow) => ({
            tag: dbRow[0],
            color: dbRow[1] || null
        }));
    },

    async getAllAvatarTags() {
        const rows = await adapter.select('avatar_tags', [
            'avatar_id',
            'tag',
            'color'
        ]);
        const map = new Map();
        for (const dbRow of rows) {
            const avatarId = dbRow[0];
            const tag = dbRow[1];
            const color = dbRow[2] || null;
            if (!map.has(avatarId)) {
                map.set(avatarId, []);
            }
            map.get(avatarId).push({ tag, color });
        }
        return map;
    },

    async getAllDistinctTags() {
        const rows = await adapter.selectWhere(
            'avatar_tags',
            ['tag'],
            null,
            null,
            { distinct: true, order: 'tag' }
        );
        return rows.map((dbRow) => dbRow[0]);
    },

    async addAvatarTag(avatarId, tag, color = null) {
        await adapter.insert(
            'avatar_tags',
            {
                avatar_id: avatarId,
                tag: tag,
                color: color
            },
            'ignore'
        );
    },

    async updateAvatarTagColor(avatarId, tag, color) {
        await adapter.update(
            'avatar_tags',
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
