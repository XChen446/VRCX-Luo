import { dbVars } from '../database';

import { adapter } from './adapter/index.js';

const friendLogCurrent = {
    async getFriendLogCurrent() {
        const rows = await adapter.select(
            adapter.userTable(dbVars.userPrefix, 'friend_log_current'),
            '*'
        );
        return rows.map((dbRow) => ({
            userId: dbRow[0],
            displayName: dbRow[1],
            trustLevel: dbRow[2],
            friendNumber: dbRow[3]
        }));
    },

    setFriendLogCurrent(entry) {
        adapter.insert(
            `${adapter.userTable(dbVars.userPrefix, 'friend_log_current')}`,
            {
                user_id: entry.userId,
                display_name: entry.displayName,
                trust_level: entry.trustLevel,
                friend_number: entry.friendNumber
            },
            'replace'
        );
    },

    async setFriendLogCurrentArray(inputData) {
        if (inputData.length === 0) {
            return;
        }
        const rows = inputData.map((line) => ({
            user_id: typeof line.userId === 'string' ? line.userId : '',
            display_name:
                typeof line.displayName === 'string' ? line.displayName : '',
            trust_level:
                typeof line.trustLevel === 'string' ? line.trustLevel : '',
            friend_number:
                typeof line.friendNumber === 'number' ? line.friendNumber : 0
        }));
        await adapter.bulkInsert(
            `${adapter.userTable(dbVars.userPrefix, 'friend_log_current')}`,
            rows,
            'replace'
        );
    },

    deleteFriendLogCurrent(userId) {
        adapter.delete(
            `${adapter.userTable(dbVars.userPrefix, 'friend_log_current')}`,
            { user_id: userId }
        );
    }
};

export { friendLogCurrent };
