import { dbVars } from '../database';

import { adapter } from './adapter/index.js';

const moderation = {
    async getModeration(userId) {
        const dbRow = await adapter.selectOne(
            adapter.userTable(dbVars.userPrefix, 'moderation'),
            '*',
            { user_id: userId }
        );
        if (!dbRow) return {};
        return {
            userId: dbRow[0],
            updatedAt: dbRow[1],
            displayName: dbRow[2],
            block: dbRow[3] === 1,
            mute: dbRow[4] === 1
        };
    },

    setModeration(entry) {
        var block = 0;
        var mute = 0;
        if (entry.block) {
            block = 1;
        }
        if (entry.mute) {
            mute = 1;
        }
        adapter.insert(
            `${adapter.userTable(dbVars.userPrefix, 'moderation')}`,
            {
                user_id: entry.userId,
                updated_at: entry.updatedAt,
                display_name: entry.displayName,
                block: block,
                mute: mute
            },
            'replace'
        );
    },

    deleteModeration(userId) {
        adapter.delete(
            `${adapter.userTable(dbVars.userPrefix, 'moderation')}`,
            { user_id: userId }
        );
    }
};

export { moderation };
