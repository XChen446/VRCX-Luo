import { dbVars } from '../database';
import { adapter } from './adapter/index.js';

const manualRelations = {
    /**
     * Add a manual relation between two users.
     * @param {string} userIdA
     * @param {string} userIdB
     * @param {string} [relationType] e.g. 'friend'
     */
    async addManualRelation(userIdA, userIdB, relationType = 'friend') {
        if (!dbVars.userPrefix || !userIdA || !userIdB) return;
        const [id1, id2] = [userIdA, userIdB].sort();
        await adapter.insert(
            `${adapter.userTable(dbVars.userPrefix, 'manual_relations_MANUEL')}`,
            {
                user_id_a: id1,
                user_id_b: id2,
                relation_type: relationType,
                added_at: new Date().toISOString()
            },
            'ignore'
        );
    },

    /**
     * Remove a manual relation between two users.
     * @param {string} userIdA
     * @param {string} userIdB
     */
    async removeManualRelation(userIdA, userIdB) {
        if (!dbVars.userPrefix || !userIdA || !userIdB) return;
        const [id1, id2] = [userIdA, userIdB].sort();
        await adapter.delete(
            `${adapter.userTable(dbVars.userPrefix, 'manual_relations_MANUEL')}`,
            {
                user_id_a: id1,
                user_id_b: id2
            }
        );
    },

    /**
     * Get all manual relations.
     */
    async getManualRelations() {
        const results = [];
        if (!dbVars.userPrefix) return results;
        const rows = await adapter.selectWhere(
            `${adapter.userTable(dbVars.userPrefix, 'manual_relations_MANUEL')}`,
            ['user_id_a', 'user_id_b', 'relation_type', 'added_at'],
            null,
            null,
            { order: 'added_at DESC' }
        );
        for (const row of rows) {
            results.push({
                userIdA: row[0],
                userIdB: row[1],
                relationType: row[2],
                addedAt: row[3]
            });
        }
        return results;
    },

    /**
     * Check if a manual relation exists between two users.
     * @param {string} userIdA
     * @param {string} userIdB
     */
    async isManualRelation(userIdA, userIdB) {
        if (!dbVars.userPrefix || !userIdA || !userIdB) return false;
        const [id1, id2] = [userIdA, userIdB].sort();
        const rows = await adapter.selectWhere(
            `${adapter.userTable(dbVars.userPrefix, 'manual_relations_MANUEL')}`,
            ['1'],
            'user_id_a = @idA AND user_id_b = @idB',
            { '@idA': id1, '@idB': id2 },
            { limit: 1 }
        );
        return rows.length > 0;
    },

    /**
     * Get all manual relations involving a specific user.
     * @param {string} userId
     */
    async getManualRelationsForUser(userId) {
        if (!dbVars.userPrefix || !userId) return [];
        const rows = await adapter.selectWhere(
            adapter.userTable(dbVars.userPrefix, 'manual_relations_MANUEL'),
            ['user_id_a', 'user_id_b', 'relation_type', 'added_at'],
            'user_id_a = @userId OR user_id_b = @userId',
            { '@userId': userId },
            { order: 'added_at DESC' }
        );
        return rows.map((row) => ({
            userIdA: row[0],
            userIdB: row[1],
            relationType: row[2],
            addedAt: row[3]
        }));
    },

    /**
     * Get bulk data for recommendation algorithm
     */
    async getCandidateCoInstances(myUserId) {
        const eventsByLocation = new Map();
        const mySessions = new Map();

        const mySessionRows = await adapter.selectWhere(
            'gamelog_join_leave',
            ['location', 'created_at', 'time'],
            "type = 'OnPlayerLeft' AND user_id = @myId AND time > 0 AND location NOT IN ('', 'traveling')",
            { '@myId': myUserId }
        );
        for (const row of mySessionRows) {
            const loc = row[0];
            if (!mySessions.has(loc)) mySessions.set(loc, []);
            mySessions
                .get(loc)
                .push({ leaveAt: new Date(row[1]).getTime(), time: row[2] });
        }

        const excludeLoc =
            "location NOT IN ('', 'offline', 'traveling', 'private', 'private:private')";

        const rows1 = await adapter.selectWhere(
            'gamelog_join_leave',
            ['location', 'user_id', 'created_at', 'time'],
            `type = 'OnPlayerLeft' AND user_id != @myId AND user_id != '' AND time > 0 AND ${excludeLoc}`,
            { '@myId': myUserId }
        );
        const rows2 = await adapter.selectWhere(
            adapter.userTable(dbVars.userPrefix, 'feed_gps'),
            ['previous_location AS location', 'user_id', 'created_at', 'time'],
            `previous_location NOT IN ('', 'offline', 'traveling', 'private', 'private:private') AND time > 0`
        );
        const rows3 = await adapter.selectWhere(
            adapter.userTable(dbVars.userPrefix, 'feed_online_offline'),
            ['location', 'user_id', 'created_at', 'time'],
            `type = 'Offline' AND ${excludeLoc} AND time > 0`
        );

        const allSessionRows = [...rows1, ...rows2, ...rows3];
        for (const row of allSessionRows) {
            const loc = row[0];
            if (!eventsByLocation.has(loc)) eventsByLocation.set(loc, []);
            eventsByLocation.get(loc).push({
                userId: row[1],
                leaveAt: new Date(row[2]).getTime(),
                time: row[3]
            });
        }

        const firstSeen = new Map();
        const lastSeen = new Map();
        const aggOpts = (table) => ({
            columns: ['user_id'],
            aggregates: [
                { expr: 'MIN(created_at)', alias: 'first' },
                { expr: 'MAX(created_at)', alias: 'last' }
            ],
            groupBy: ['user_id'],
            where: "user_id != ''"
        });

        for (const [table, isOnlineOffline] of [
            ['gamelog_join_leave', false],
            [adapter.userTable(dbVars.userPrefix, 'feed_gps'), false],
            [adapter.userTable(dbVars.userPrefix, 'feed_online_offline'), true]
        ]) {
            const rows = await adapter.selectGroupBy(table, aggOpts(table));
            for (const r of rows) {
                const uid = r[0];
                const first = new Date(r[1]).getTime();
                const last = new Date(r[2]).getTime();
                if (!firstSeen.has(uid) || first < firstSeen.get(uid)) {
                    firstSeen.set(uid, first);
                }
                if (isOnlineOffline) {
                    lastSeen.set(uid, last);
                }
                if (!lastSeen.has(uid) || last > lastSeen.get(uid)) {
                    lastSeen.set(uid, last);
                }
            }
        }

        const oldMutualSnapshot = new Map();

        const oldMutualRows = await adapter.select(
            adapter.userTable(dbVars.userPrefix, 'mutual_graph_links_old'),
            ['friend_id', 'mutual_id']
        );
        for (const row of oldMutualRows) {
            const friendId = row[0];
            const mutualId = row[1];
            if (!oldMutualSnapshot.has(friendId))
                oldMutualSnapshot.set(friendId, new Set());
            oldMutualSnapshot.get(friendId).add(mutualId);
        }

        return {
            eventsByLocation,
            mySessions,
            firstSeen,
            lastSeen,
            oldMutualSnapshot
        };
    }
};

export { manualRelations };
