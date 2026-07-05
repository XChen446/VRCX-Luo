import { dbVars } from '../database';

import { adapter } from './adapter/index.js';

const moderation = {
    async getModeration(userId) {
        var row = {};
        await adapter.execute(
            (dbRow) => {
                var block = false;
                var mute = false;
                if (dbRow[3] === 1) {
                    block = true;
                }
                if (dbRow[4] === 1) {
                    mute = true;
                }
                row = {
                    userId: dbRow[0],
                    updatedAt: dbRow[1],
                    displayName: dbRow[2],
                    block,
                    mute
                };
            },
            `SELECT * FROM ${dbVars.userPrefix}_moderation WHERE user_id = @userId`,
            {
                '@userId': userId
            }
        );
        return row;
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
        adapter.insert(`${dbVars.userPrefix}_moderation`, 'replace', {
            user_id: entry.userId,
            updated_at: entry.updatedAt,
            display_name: entry.displayName,
            block: block,
            mute: mute
        });
    },

    deleteModeration(userId) {
        adapter.delete(`${dbVars.userPrefix}_moderation`, { user_id: userId });
    }
};

export { moderation };
