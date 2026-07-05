import { dbVars } from '../database';

import { adapter } from './adapter/index.js';

const trackedNonFriends = {
    async addTrackedNonFriend(userId, displayName) {
        if (!dbVars.userPrefix || !userId) return;
        await adapter.insert(`${dbVars.userPrefix}_tracked_nonfriends`, 'ignore', {
            user_id: userId,
            display_name: displayName || '',
            added_at: new Date().toISOString()
        });
    },

    async removeTrackedNonFriend(userId) {
        if (!dbVars.userPrefix || !userId) return;
        await adapter.delete(`${dbVars.userPrefix}_tracked_nonfriends`, { user_id: userId });
    },

    async getTrackedNonFriends() {
        const results = [];
        if (!dbVars.userPrefix) return results;
        const rows = await adapter.selectWhere(
            `${dbVars.userPrefix}_tracked_nonfriends`,
            ['user_id', 'display_name', 'added_at'],
            null, null,
            { order: 'added_at DESC' }
        );
        for (const row of rows) {
            results.push({
                userId: row[0],
                displayName: row[1],
                addedAt: row[2]
            });
        }
        return results;
    },

    async isTrackedNonFriend(userId) {
        if (!dbVars.userPrefix || !userId) return false;
        const rows = await adapter.selectWhere(
            `${dbVars.userPrefix}_tracked_nonfriends`,
            ['1'],
            'user_id = @userId',
            { '@userId': userId },
            { limit: 1 }
        );
        return rows.length > 0;
    },

    async updateTrackedNonFriendDisplayName(userId, displayName) {
        if (!dbVars.userPrefix || !userId) return;
        await adapter.update(`${dbVars.userPrefix}_tracked_nonfriends`,
            { display_name: displayName || '' },
            { user_id: userId }
        );
    }
};

export { trackedNonFriends };
