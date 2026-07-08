import { dbVars } from '../database';

import { adapter } from './adapter/index.js';

const friendLogHistory = {
    async getFriendLogHistory() {
        var friendLogHistory = [];
        await adapter.execute((dbRow) => {
            var row = {
                rowId: dbRow[0],
                created_at: dbRow[1],
                type: dbRow[2],
                userId: dbRow[3],
                displayName: dbRow[4],
                friendNumber: dbRow[8]
            };
            if (row.type === 'DisplayName') {
                row.previousDisplayName = dbRow[5];
            } else if (row.type === 'TrustLevel') {
                row.trustLevel = dbRow[6];
                row.previousTrustLevel = dbRow[7];
            }
            friendLogHistory.unshift(row);
        }, `SELECT * FROM ${adapter.userTable(dbVars.userPrefix, 'friend_log_history')}`);
        return friendLogHistory;
    },

    addFriendLogHistory(entry) {
        adapter.insert(`${adapter.userTable(dbVars.userPrefix, 'friend_log_history')}`, {
            created_at: entry.created_at,
            type: entry.type,
            user_id: entry.userId,
            display_name: entry.displayName,
            previous_display_name: entry.previousDisplayName,
            trust_level: entry.trustLevel,
            previous_trust_level: entry.previousTrustLevel,
            friend_number: entry.friendNumber
        }, 'ignore');
    },

    // @deprecated Currently unused — kept for future batch-insert callers
    async addFriendLogHistoryArray(inputData) {
        if (inputData.length === 0) {
            return;
        }
        const rows = inputData.map((line) => ({
            created_at: typeof line.created_at === 'string' ? line.created_at : null,
            type: typeof line.type === 'string' ? line.type : null,
            user_id: typeof line.userId === 'string' ? line.userId : null,
            display_name: typeof line.displayName === 'string' ? line.displayName : null,
            previous_display_name: typeof line.previousDisplayName === 'string' ? line.previousDisplayName : null,
            trust_level: typeof line.trustLevel === 'string' ? line.trustLevel : null,
            previous_trust_level: typeof line.previousTrustLevel === 'string' ? line.previousTrustLevel : null,
            friend_number: typeof line.friendNumber === 'string' ? line.friendNumber : null
        }));
        await adapter.bulkInsert(`${adapter.userTable(dbVars.userPrefix, 'friend_log_history')}`, rows, 'ignore');
    },

    async getFriendLogHistoryForUserId(userId, types) {
        let friendLogHistory = [];
        let typeFilter = '';
        const typeParams = {};
        if (types && types.length > 0) {
            const placeholders = types.map((_, i) => `@type_${i}`);
            types.forEach((t, i) => { typeParams[`@type_${i}`] = t; });
            typeFilter = ` AND type IN (${placeholders.join(', ')})`;
        }
        await adapter.execute(
            (dbRow) => {
                const row = {
                    rowId: dbRow[0],
                    created_at: dbRow[1],
                    type: dbRow[2],
                    userId: dbRow[3],
                    displayName: dbRow[4],
                    friendNumber: dbRow[8]
                };
                if (row.type === 'DisplayName') {
                    row.previousDisplayName = dbRow[5];
                } else if (row.type === 'TrustLevel') {
                    row.trustLevel = dbRow[6];
                    row.previousTrustLevel = dbRow[7];
                }
                friendLogHistory.push(row);
            },
            `SELECT * FROM ${adapter.userTable(dbVars.userPrefix, 'friend_log_history')} WHERE user_id = @user_id${typeFilter}`,
            {
                '@user_id': userId,
                ...typeParams
            }
        );
        return friendLogHistory;
    },

    deleteFriendLogHistory(entry) {
        if (entry.rowId != null) {
            adapter.delete(`${adapter.userTable(dbVars.userPrefix, 'friend_log_history')}`, { id: entry.rowId });
        } else {
            adapter.delete(`${adapter.userTable(dbVars.userPrefix, 'friend_log_history')}`, {
                created_at: entry.created_at,
                type: entry.type,
                user_id: entry.userId
            });
        }
    }
};

export { friendLogHistory };
