import { dbVars } from '../database';

import { adapter } from './adapter/index.js';

const friendLogCurrent = {
    async getFriendLogCurrent() {
        var friendLogCurrent = [];
        await adapter.execute((dbRow) => {
            var row = {
                userId: dbRow[0],
                displayName: dbRow[1],
                trustLevel: dbRow[2],
                friendNumber: dbRow[3]
            };
            friendLogCurrent.unshift(row);
        }, `SELECT * FROM ${dbVars.userPrefix}_friend_log_current`);
        return friendLogCurrent;
    },

    setFriendLogCurrent(entry) {
        adapter.insert(`${dbVars.userPrefix}_friend_log_current`, {
            user_id: entry.userId,
            display_name: entry.displayName,
            trust_level: entry.trustLevel,
            friend_number: entry.friendNumber
        }, 'replace');
    },

    setFriendLogCurrentArray(inputData) {
        if (inputData.length === 0) {
            return;
        }
        const rows = inputData.map((line) => ({
            user_id: typeof line.userId === 'string' ? line.userId : '',
            display_name: typeof line.displayName === 'string' ? line.displayName : '',
            trust_level: typeof line.trustLevel === 'string' ? line.trustLevel : '',
            friend_number: line.friendNumber
        }));
        adapter.bulkInsert(`${dbVars.userPrefix}_friend_log_current`, rows, 'replace');
    },

    deleteFriendLogCurrent(userId) {
        adapter.delete(`${dbVars.userPrefix}_friend_log_current`, { user_id: userId });
    }
};

export { friendLogCurrent };
