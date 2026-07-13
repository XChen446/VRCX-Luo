import { dbVars } from '../database';

import { adapter } from './adapter/index.js';

const tableFixes = {
    async cleanLegendFromFriendLog() {
        var tables = await adapter.listTables('%_friend_log_history');
        for (var tableName of tables) {
            await adapter.deleteWhere(
                tableName,
                "type = 'TrustLevel' AND created_at > '2022-05-04T01:00:00.000Z' AND ((trust_level = 'Veteran User' AND previous_trust_level = 'Trusted User') OR (trust_level = 'Trusted User' AND previous_trust_level = 'Veteran User'))"
            );
        }
    },

    async fixGameLogTraveling() {
        var travelingList = [];
        const rows = await adapter.selectWhere(
            'gamelog_join_leave',
            '*',
            "type = 'OnPlayerLeft' AND location = 'traveling'"
        );
        for (const dbRow of rows) {
            travelingList.unshift({
                rowId: dbRow[0],
                created_at: dbRow[1],
                type: dbRow[2],
                displayName: dbRow[3],
                location: dbRow[4],
                userId: dbRow[5],
                time: dbRow[6]
            });
        }
        travelingList.forEach(async (travelingEntry) => {
            const joinRows = await adapter.selectWhere(
                'gamelog_join_leave',
                ['location'],
                "type = 'OnPlayerJoined' AND display_name = @displayName AND created_at <= @created_at",
                { displayName: travelingEntry.displayName, created_at: travelingEntry.created_at },
                { order: 'created_at DESC', limit: 1 }
            );
            if (joinRows.length > 0) {
                adapter.update(
                    'gamelog_join_leave',
                    { location: joinRows[0][0] },
                    { id: travelingEntry.rowId }
                );
            }
        });
    },

    async fixNegativeGPS() {
        var gpsTables = await adapter.listTables('%_gps');
        gpsTables.forEach((tableName) => {
            adapter.updateWhere(tableName, { time: 0 }, 'time < 0');
        });
    },

    async getBrokenLeaveEntries() {
        var instances = await this.getGameLogInstancesTime();
        var badEntries = [];
        const rows = await adapter.selectWhere(
            'gamelog_join_leave',
            ['location', 'time', 'id'],
            "type = 'OnPlayerLeft' AND time > 0"
        );
        for (const dbRow of rows) {
            if (typeof dbRow[1] === 'number') {
                var ref = instances.get(dbRow[0]);
                if (typeof ref !== 'undefined' && dbRow[1] > ref) {
                    badEntries.push(dbRow[2]);
                }
            }
        }
        return badEntries;
    },

    async fixBrokenLeaveEntries() {
        var badEntries = await this.getBrokenLeaveEntries();
        var badEntriesList = '';
        var count = badEntries.length;
        badEntries.forEach((entry) => {
            count--;
            if (count === 0) {
                badEntriesList = badEntriesList.concat(entry);
            } else {
                badEntriesList = badEntriesList.concat(`${entry}, `);
            }
        });

        adapter.updateWhere(
            'gamelog_join_leave',
            { time: 0 },
            `id IN (${badEntriesList})`
        );
    },

    async fixBrokenGroupInvites() {
        var notificationTables = await adapter.listTables('%_notifications');
        notificationTables.forEach((tableName) => {
            adapter.deleteWhere(tableName, "type LIKE '%.%'");
        });
    },

    async fixBrokenNotifications() {
        var tables = await adapter.listTables('%_notifications');
        for (var tableName of tables) {
            await adapter.deleteWhere(
                tableName,
                "created_at is null or created_at = ''"
            );
        }
    },

    async fixBrokenGroupChange() {
        var tables = await adapter.listTables('%_notifications');
        for (var tableName of tables) {
            await adapter.deleteWhere(
                tableName,
                "type = 'groupChange' AND created_at < '2024-04-23T03:00:00.000Z'"
            );
        }
    },

    async fixCancelFriendRequestTypo() {
        var tables = await adapter.listTables('%_friend_log_history');
        for (var tableName of tables) {
            await adapter.updateWhere(
                tableName,
                { type: 'CancelFriendRequest' },
                "type = 'CancelFriendRequst'"
            );
        }
    },

    async getBrokenGameLogDisplayNames() {
        const rows = await adapter.selectWhere(
            'gamelog_join_leave',
            ['id', 'display_name'],
            "display_name LIKE '% (%'"
        );
        return rows.map((dbRow) => ({
            id: dbRow[0],
            displayName: dbRow[1]
        }));
    },

    async fixBrokenGameLogDisplayNames() {
        var badEntries = await this.getBrokenGameLogDisplayNames();
        badEntries.forEach((entry) => {
            var newDisplayName = entry.displayName.split(' (')[0];
            adapter.update(
                'gamelog_join_leave',
                { display_name: newDisplayName },
                { id: entry.id }
            );
        });
    }
};

export { tableFixes };
