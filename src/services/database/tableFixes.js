import { dbVars } from '../database';

import { adapter } from './adapter/index.js';

const tableFixes = {
    async cleanLegendFromFriendLog() {
        var tables = await adapter.listTables('%_friend_log_history');
        for (var tableName of tables) {
            await adapter.executeNonQuery(
                `DELETE FROM ${tableName}
                WHERE type = 'TrustLevel' AND created_at > '2022-05-04T01:00:00.000Z'
                AND ((trust_level = 'Veteran User' AND previous_trust_level = 'Trusted User') OR (trust_level = 'Trusted User' AND previous_trust_level = 'Veteran User'))`
            );
        }
    },

    async fixGameLogTraveling() {
        var travelingList = [];
        await adapter.execute((dbRow) => {
            var row = {
                rowId: dbRow[0],
                created_at: dbRow[1],
                type: dbRow[2],
                displayName: dbRow[3],
                location: dbRow[4],
                userId: dbRow[5],
                time: dbRow[6]
            };
            travelingList.unshift(row);
        }, "SELECT * FROM gamelog_join_leave WHERE type = 'OnPlayerLeft' AND location = 'traveling'");
        travelingList.forEach(async (travelingEntry) => {
            await adapter.execute(
                (dbRow) => {
                    var onPlayingJoin = {
                        rowId: dbRow[0],
                        created_at: dbRow[1],
                        type: dbRow[2],
                        displayName: dbRow[3],
                        location: dbRow[4],
                        userId: dbRow[5],
                        time: dbRow[6]
                    };
                    adapter.executeNonQuery(
                        `UPDATE gamelog_join_leave SET location = @location WHERE id = @rowId`,
                        {
                            '@rowId': travelingEntry.rowId,
                            '@location': onPlayingJoin.location
                        }
                    );
                },
                "SELECT * FROM gamelog_join_leave WHERE type = 'OnPlayerJoined' AND display_name = @displayName AND created_at <= @created_at ORDER BY created_at DESC LIMIT 1",
                {
                    '@displayName': travelingEntry.displayName,
                    '@created_at': travelingEntry.created_at
                }
            );
        });
    },

    async fixNegativeGPS() {
        var gpsTables = await adapter.listTables('%_gps');
        gpsTables.forEach((tableName) => {
            adapter.executeNonQuery(
                `UPDATE ${tableName} SET time = 0 WHERE time < 0`
            );
        });
    },

    async getBrokenLeaveEntries() {
        var instances = await this.getGameLogInstancesTime();
        var badEntries = [];
        await adapter.execute((dbRow) => {
            if (typeof dbRow[1] === 'number') {
                var ref = instances.get(dbRow[0]);
                if (typeof ref !== 'undefined' && dbRow[1] > ref) {
                    badEntries.push(dbRow[2]);
                }
            }
        }, `SELECT location, time, id FROM gamelog_join_leave WHERE type = 'OnPlayerLeft' AND time > 0`);
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

        adapter.executeNonQuery(
            `UPDATE gamelog_join_leave SET time = 0 WHERE id IN (${badEntriesList})`
        );
    },

    async fixBrokenGroupInvites() {
        var notificationTables = await adapter.listTables('%_notifications');
        notificationTables.forEach((tableName) => {
            adapter.executeNonQuery(
                `DELETE FROM ${tableName} WHERE type LIKE '%.%'`
            );
        });
    },

    async fixBrokenNotifications() {
        var tables = await adapter.listTables('%_notifications');
        for (var tableName of tables) {
            await adapter.executeNonQuery(
                `DELETE FROM ${tableName} WHERE (created_at is null or created_at = '')`
            );
        }
    },

    async fixBrokenGroupChange() {
        var tables = await adapter.listTables('%_notifications');
        for (var tableName of tables) {
            await adapter.executeNonQuery(
                `DELETE FROM ${tableName} WHERE type = 'groupChange' AND created_at < '2024-04-23T03:00:00.000Z'`
            );
        }
    },

    async fixCancelFriendRequestTypo() {
        var tables = await adapter.listTables('%_friend_log_history');
        for (var tableName of tables) {
            await adapter.executeNonQuery(
                `UPDATE ${tableName} SET type = 'CancelFriendRequest' WHERE type = 'CancelFriendRequst'`
            );
        }
    },

    async getBrokenGameLogDisplayNames() {
        var badEntries = [];
        await adapter.execute((dbRow) => {
            badEntries.push({
                id: dbRow[0],
                displayName: dbRow[1]
            });
        }, "SELECT id, display_name FROM gamelog_join_leave WHERE display_name LIKE '% (%'");
        return badEntries;
    },

    async fixBrokenGameLogDisplayNames() {
        var badEntries = await this.getBrokenGameLogDisplayNames();
        badEntries.forEach((entry) => {
            var newDisplayName = entry.displayName.split(' (')[0];
            adapter.update('gamelog_join_leave', { display_name: newDisplayName }, { id: entry.id });
        });
    }
};

export { tableFixes };
