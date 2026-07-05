import { dbVars } from '../database';

import { adapter } from './adapter/index.js';

const mutualGraph = {
    async getMutualGraphSnapshot() {
        const snapshot = new Map();
        if (!dbVars.userPrefix) {
            return snapshot;
        }
        const friendTable = `${dbVars.userPrefix}_mutual_graph_friends`;
        const linkTable = `${dbVars.userPrefix}_mutual_graph_links`;
        await adapter.execute((dbRow) => {
            const friendId = dbRow[0];
            if (friendId && !snapshot.has(friendId)) {
                snapshot.set(friendId, []);
            }
        }, `SELECT friend_id FROM ${friendTable}`);
        await adapter.execute((dbRow) => {
            const friendId = dbRow[0];
            const mutualId = dbRow[1];
            if (!friendId || !mutualId) {
                return;
            }
            let list = snapshot.get(friendId);
            if (!list) {
                list = [];
                snapshot.set(friendId, list);
            }
            list.push(mutualId);
        }, `SELECT friend_id, mutual_id FROM ${linkTable}`);
        return snapshot;
    },

    async saveMutualGraphSnapshot(entries) {
        if (!dbVars.userPrefix) {
            return;
        }
        const friendTable = `${dbVars.userPrefix}_mutual_graph_friends`;
        const linkTable = `${dbVars.userPrefix}_mutual_graph_links`;
        const metaTable = `${dbVars.userPrefix}_mutual_graph_meta`;
        const pairs = entries instanceof Map ? entries : new Map();
        await adapter.begin();
        try {
            await adapter.executeNonQuery(
                `DELETE FROM ${linkTable} WHERE friend_id NOT IN (SELECT friend_id FROM ${metaTable} WHERE opted_out = 1)`
            );
            await adapter.executeNonQuery(
                `DELETE FROM ${friendTable} WHERE friend_id NOT IN (SELECT friend_id FROM ${metaTable} WHERE opted_out = 1)`
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
                await adapter.executeNonQuery(
                    `DELETE FROM ${linkTable} WHERE friend_id IN (${delPlaceholders.join(', ')})`,
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
        const friendTable = `${dbVars.userPrefix}_mutual_graph_friends`;
        const linkTable = `${dbVars.userPrefix}_mutual_graph_links`;
        await adapter.insert(friendTable, 'replace', { friend_id: friendId });
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
        const linkTable = `${dbVars.userPrefix}_mutual_graph_links`;
        await adapter.execute((dbRow) => {
            const mutualId = dbRow[0];
            const count = dbRow[1];
            if (mutualId) {
                mutualCountMap.set(mutualId, count);
            }
        }, `SELECT mutual_id, COUNT(*) FROM ${linkTable} GROUP BY mutual_id`);
        return mutualCountMap;
    },

    async getMutualGraphSnapshotFromOld() {
        const snapshot = new Map();
        if (!dbVars.userPrefix) {
            return snapshot;
        }
        const oldTable = `${dbVars.userPrefix}_mutual_graph_links_old`;
        await adapter.execute((dbRow) => {
            const friendId = dbRow[0];
            const mutualId = dbRow[1];
            if (!friendId || !mutualId) {
                return;
            }
            let list = snapshot.get(friendId);
            if (!list) {
                list = [];
                snapshot.set(friendId, list);
            }
            list.push(mutualId);
        }, `SELECT friend_id, mutual_id FROM ${oldTable}`);
        return snapshot;
    },

    async getMutualsForFriendWithDateFromOld(friendId) {
        const results = [];
        if (!dbVars.userPrefix || !friendId) {
            return results;
        }
        const oldTable = `${dbVars.userPrefix}_mutual_graph_links_old`;
        await adapter.execute((dbRow) => {
            const mutualId = dbRow[0];
            const date = dbRow[1];
            if (mutualId) {
                results.push({ id: mutualId, date: date || null });
            }
        }, `SELECT mutual_id, date FROM ${oldTable} WHERE friend_id = @friendId`,
            { '@friendId': friendId }
        );
        return results;
    },

    async mergeMutualLinksToOld(entries) {
        if (!dbVars.userPrefix) {
            return;
        }
        const oldTable = `${dbVars.userPrefix}_mutual_graph_links_old`;
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
                rows.push({ friend_id: friendId, mutual_id: mutual, date: now });
            }
        });
        if (rows.length === 0) return;
        await adapter.bulkInsert(oldTable, rows, 'replace');
    },

    async updateMutualsForFriendInOld(friendId, mutualIds) {
        if (!dbVars.userPrefix || !friendId) {
            return;
        }
        const oldTable = `${dbVars.userPrefix}_mutual_graph_links_old`;
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
        const friendsOldTable = `${dbVars.userPrefix}_mutual_graph_friends_old`;
        await adapter.insert(friendsOldTable, 'replace', {
            friend_id: friendId,
            last_updated: new Date().toISOString()
        });
    },

    async bulkUpdateFriendFetchTimesInOld(friendIds) {
        if (!dbVars.userPrefix || !friendIds || friendIds.length === 0) {
            return;
        }
        const friendsOldTable = `${dbVars.userPrefix}_mutual_graph_friends_old`;
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
        const friendsOldTable = `${dbVars.userPrefix}_mutual_graph_friends_old`;
        let result = null;
        await adapter.execute((dbRow) => {
            result = dbRow[0] || null;
        }, `SELECT last_updated FROM ${friendsOldTable} WHERE friend_id = @friendId`,
            { '@friendId': friendId }
        );
        return result;
    },

    async upsertMutualGraphMeta(friendId, { lastFetchedAt, optedOut }) {
        if (!dbVars.userPrefix || !friendId) {
            return;
        }
        await adapter.insert(`${dbVars.userPrefix}_mutual_graph_meta`, 'replace', {
            friend_id: friendId,
            last_fetched_at: lastFetchedAt || new Date().toISOString(),
            opted_out: optedOut ? 1 : 0
        });
    },

    async bulkUpsertMutualGraphMeta(entries) {
        if (!dbVars.userPrefix || !entries || entries.size === 0) {
            return;
        }
        const metaTable = `${dbVars.userPrefix}_mutual_graph_meta`;
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
        const metaTable = `${dbVars.userPrefix}_mutual_graph_meta`;
        await adapter.execute((dbRow) => {
            const friendId = dbRow[0];
            if (friendId) {
                metaMap.set(friendId, {
                    lastFetchedAt: dbRow[1] || null,
                    optedOut: dbRow[2] === 1
                });
            }
        }, `SELECT friend_id, last_fetched_at, opted_out FROM ${metaTable}`);
        return metaMap;
    }
};

export { mutualGraph };
