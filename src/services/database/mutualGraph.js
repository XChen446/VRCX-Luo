import { dbVars } from '../database';

import { adapter } from './adapter/index.js';

const mutualGraph = {
    async getMutualGraphSnapshot() {
        const snapshot = new Map();
        if (!dbVars.userPrefix) {
            return snapshot;
        }
        const friendTable = `${adapter.userTable(dbVars.userPrefix, 'mutual_graph_friends')}`;
        const linkTable = `${adapter.userTable(dbVars.userPrefix, 'mutual_graph_links')}`;
        const friendRows = await adapter.select(friendTable, ['friend_id']);
        for (const dbRow of friendRows) {
            const friendId = dbRow[0];
            if (friendId && !snapshot.has(friendId)) {
                snapshot.set(friendId, []);
            }
        }
        const linkRows = await adapter.select(linkTable, [
            'friend_id',
            'mutual_id'
        ]);
        for (const dbRow of linkRows) {
            const friendId = dbRow[0];
            const mutualId = dbRow[1];
            if (!friendId || !mutualId) {
                continue;
            }
            let list = snapshot.get(friendId);
            if (!list) {
                list = [];
                snapshot.set(friendId, list);
            }
            list.push(mutualId);
        }
        return snapshot;
    },

    async saveMutualGraphSnapshot(entries) {
        if (!dbVars.userPrefix) {
            return;
        }
        const friendTable = `${adapter.userTable(dbVars.userPrefix, 'mutual_graph_friends')}`;
        const linkTable = `${adapter.userTable(dbVars.userPrefix, 'mutual_graph_links')}`;
        const metaTable = `${adapter.userTable(dbVars.userPrefix, 'mutual_graph_meta')}`;
        const pairs = entries instanceof Map ? entries : new Map();
        await adapter.begin();
        try {
            await adapter.deleteWhere(
                linkTable,
                'friend_id NOT IN (SELECT friend_id FROM ' +
                    metaTable +
                    ' WHERE opted_out = 1)'
            );
            await adapter.deleteWhere(
                friendTable,
                'friend_id NOT IN (SELECT friend_id FROM ' +
                    metaTable +
                    ' WHERE opted_out = 1)'
            );
            if (pairs.size === 0) {
                await adapter.commit();
                return;
            }
            const idsToClean = [];
            const friendRows = [];
            const edgeRows = [];
            pairs.forEach((mutualIds, friendId) => {
                if (!friendId) return;
                idsToClean.push(friendId);
                friendRows.push({ friend_id: friendId });
                let collection = [];
                if (Array.isArray(mutualIds)) {
                    collection = mutualIds;
                } else if (mutualIds instanceof Set) {
                    collection = Array.from(mutualIds);
                }
                for (const mutual of collection) {
                    if (!mutual) continue;
                    edgeRows.push({ friend_id: friendId, mutual_id: mutual });
                }
            });
            if (idsToClean.length > 0) {
                const delParams = {};
                const delPlaceholders = idsToClean.map((id, i) => {
                    delParams[`@id_${i}`] = id;
                    return `@id_${i}`;
                });
                await adapter.deleteWhere(
                    linkTable,
                    'friend_id IN (' + delPlaceholders.join(', ') + ')',
                    delParams
                );
            }
            if (friendRows.length > 0) {
                await adapter.bulkInsert(friendTable, friendRows, 'replace');
            }
            if (edgeRows.length > 0) {
                await adapter.bulkInsert(linkTable, edgeRows, 'replace');
            }
            await adapter.commit();
        } catch (err) {
            await adapter.rollback();
            throw err;
        }
    },

    async updateMutualsForFriend(friendId, mutualIds) {
        if (!dbVars.userPrefix || !friendId) {
            return;
        }
        const friendTable = `${adapter.userTable(dbVars.userPrefix, 'mutual_graph_friends')}`;
        const linkTable = `${adapter.userTable(dbVars.userPrefix, 'mutual_graph_links')}`;
        await adapter.insert(friendTable, { friend_id: friendId }, 'replace');
        await adapter.delete(linkTable, { friend_id: friendId });
        const edgeRows = [];
        for (const mutual of mutualIds) {
            if (!mutual) continue;
            edgeRows.push({ friend_id: friendId, mutual_id: mutual });
        }
        if (edgeRows.length > 0) {
            await adapter.bulkInsert(linkTable, edgeRows, 'replace');
        }
    },

    async getMutualCountForAllUsers() {
        const mutualCountMap = new Map();
        if (!dbVars.userPrefix) {
            return mutualCountMap;
        }
        const linkTable = `${adapter.userTable(dbVars.userPrefix, 'mutual_graph_links')}`;
        const rows = await adapter.selectGroupBy(linkTable, {
            columns: ['mutual_id'],
            aggregates: [{ expr: 'COUNT(*)', alias: 'cnt' }],
            groupBy: ['mutual_id']
        });
        for (const dbRow of rows) {
            const mutualId = dbRow[0];
            const count = dbRow[1];
            if (mutualId) {
                mutualCountMap.set(mutualId, count);
            }
        }
        return mutualCountMap;
    },

    async getMutualGraphSnapshotFromOld() {
        const snapshot = new Map();
        if (!dbVars.userPrefix) {
            return snapshot;
        }
        const oldTable = `${adapter.userTable(dbVars.userPrefix, 'mutual_graph_links_old')}`;
        const rows = await adapter.select(oldTable, ['friend_id', 'mutual_id']);
        for (const dbRow of rows) {
            const friendId = dbRow[0];
            const mutualId = dbRow[1];
            if (!friendId || !mutualId) {
                continue;
            }
            let list = snapshot.get(friendId);
            if (!list) {
                list = [];
                snapshot.set(friendId, list);
            }
            list.push(mutualId);
        }
        return snapshot;
    },

    async getMutualsForFriendWithDateFromOld(friendId) {
        const results = [];
        if (!dbVars.userPrefix || !friendId) {
            return results;
        }
        const oldTable = `${adapter.userTable(dbVars.userPrefix, 'mutual_graph_links_old')}`;
        const rows = await adapter.select(oldTable, ['mutual_id', 'date'], {
            friend_id: friendId
        });
        for (const dbRow of rows) {
            const mutualId = dbRow[0];
            const date = dbRow[1];
            if (mutualId) {
                results.push({ id: mutualId, date: date || null });
            }
        }
        return results;
    },

    async mergeMutualLinksToOld(entries) {
        if (!dbVars.userPrefix) {
            return;
        }
        const oldTable = `${adapter.userTable(dbVars.userPrefix, 'mutual_graph_links_old')}`;
        const pairs = entries instanceof Map ? entries : new Map();
        if (pairs.size === 0) {
            return;
        }
        const now = new Date().toISOString();
        const rows = [];
        pairs.forEach((mutualIds, friendId) => {
            if (!friendId) return;
            let collection = [];
            if (Array.isArray(mutualIds)) {
                collection = mutualIds;
            } else if (mutualIds instanceof Set) {
                collection = Array.from(mutualIds);
            }
            for (const mutual of collection) {
                if (!mutual) continue;
                rows.push({
                    friend_id: friendId,
                    mutual_id: mutual,
                    date: now
                });
            }
        });
        if (rows.length === 0) return;
        await adapter.bulkInsert(oldTable, rows, 'replace');
    },

    async updateMutualsForFriendInOld(friendId, mutualIds) {
        if (!dbVars.userPrefix || !friendId) {
            return;
        }
        const oldTable = `${adapter.userTable(dbVars.userPrefix, 'mutual_graph_links_old')}`;
        const now = new Date().toISOString();
        const rows = [];
        for (const mutual of mutualIds) {
            if (!mutual) continue;
            rows.push({ friend_id: friendId, mutual_id: mutual, date: now });
        }
        if (rows.length === 0) return;
        await adapter.bulkInsert(oldTable, rows, 'replace');
    },

    async updateFriendFetchTimeInOld(friendId) {
        if (!dbVars.userPrefix || !friendId) {
            return;
        }
        const friendsOldTable = `${adapter.userTable(dbVars.userPrefix, 'mutual_graph_friends_old')}`;
        await adapter.insert(
            friendsOldTable,
            {
                friend_id: friendId,
                last_updated: new Date().toISOString()
            },
            'replace'
        );
    },

    async bulkUpdateFriendFetchTimesInOld(friendIds) {
        if (!dbVars.userPrefix || !friendIds || friendIds.length === 0) {
            return;
        }
        const friendsOldTable = `${adapter.userTable(dbVars.userPrefix, 'mutual_graph_friends_old')}`;
        const now = new Date().toISOString();
        const rows = [];
        for (const friendId of friendIds) {
            if (!friendId) continue;
            rows.push({ friend_id: friendId, last_updated: now });
        }
        if (rows.length === 0) return;
        await adapter.bulkInsert(friendsOldTable, rows, 'replace');
    },

    async getFriendLastFetchedFromOld(friendId) {
        if (!dbVars.userPrefix || !friendId) {
            return null;
        }
        const friendsOldTable = `${adapter.userTable(dbVars.userPrefix, 'mutual_graph_friends_old')}`;
        const dbRow = await adapter.selectOne(
            friendsOldTable,
            ['last_updated'],
            { friend_id: friendId }
        );
        return dbRow ? dbRow[0] || null : null;
    },

    async upsertMutualGraphMeta(friendId, { lastFetchedAt, optedOut }) {
        if (!dbVars.userPrefix || !friendId) {
            return;
        }
        await adapter.insert(
            `${adapter.userTable(dbVars.userPrefix, 'mutual_graph_meta')}`,
            {
                friend_id: friendId,
                last_fetched_at: lastFetchedAt || new Date().toISOString(),
                opted_out: optedOut ? 1 : 0
            },
            'replace'
        );
    },

    async bulkUpsertMutualGraphMeta(entries) {
        if (!dbVars.userPrefix || !entries || entries.size === 0) {
            return;
        }
        const metaTable = `${adapter.userTable(dbVars.userPrefix, 'mutual_graph_meta')}`;
        const now = new Date().toISOString();
        const rows = [];
        entries.forEach(({ optedOut }, friendId) => {
            if (!friendId) return;
            rows.push({
                friend_id: friendId,
                last_fetched_at: now,
                opted_out: optedOut ? 1 : 0
            });
        });
        if (rows.length === 0) return;
        await adapter.bulkInsert(metaTable, rows, 'replace');
    },

    async getMutualGraphMeta() {
        const metaMap = new Map();
        if (!dbVars.userPrefix) {
            return metaMap;
        }
        const metaTable = `${adapter.userTable(dbVars.userPrefix, 'mutual_graph_meta')}`;
        const rows = await adapter.select(metaTable, [
            'friend_id',
            'last_fetched_at',
            'opted_out'
        ]);
        for (const dbRow of rows) {
            const friendId = dbRow[0];
            if (friendId) {
                metaMap.set(friendId, {
                    lastFetchedAt: dbRow[1] || null,
                    optedOut: dbRow[2] === 1
                });
            }
        }
        return metaMap;
    }
};

export { mutualGraph };
