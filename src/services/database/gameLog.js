import { dbVars } from '../database';

import { adapter } from './adapter/index.js';

const C16 = {
    LOCATION: [
        "id", "created_at", "'Location' AS type", "NULL AS display_name",
        "location", "NULL AS user_id", "time", "world_id", "world_name",
        "group_name", "NULL AS instance_id", "NULL AS video_url",
        "NULL AS video_name", "NULL AS video_id", "NULL AS resource_url",
        "NULL AS resource_type"
    ].join(', '),
    JOIN_LEAVE: [
        "id", "created_at", "type", "display_name", "location", "user_id",
        "time", "NULL AS world_id", "NULL AS world_name", "NULL AS group_name",
        "NULL AS instance_id", "NULL AS video_url", "NULL AS video_name",
        "NULL AS video_id", "NULL AS resource_url", "NULL AS resource_type"
    ].join(', '),
    PORTAL_SPAWN: [
        "id", "created_at", "'PortalSpawn' AS type", "display_name", "location",
        "user_id", "NULL AS time", "NULL AS world_id", "world_name",
        "NULL AS group_name", "instance_id", "NULL AS video_url",
        "NULL AS video_name", "NULL AS video_id", "NULL AS resource_url",
        "NULL AS resource_type"
    ].join(', '),
    VIDEO_PLAY: [
        "id", "created_at", "'VideoPlay' AS type", "display_name", "location",
        "user_id", "NULL AS time", "NULL AS world_id", "NULL AS world_name",
        "NULL AS group_name", "NULL AS instance_id", "video_url", "video_name",
        "video_id", "NULL AS resource_url", "NULL AS resource_type"
    ].join(', '),
    RESOURCE_LOAD: [
        "id", "created_at", "resource_type AS type", "NULL AS display_name",
        "location", "NULL AS user_id", "NULL AS time", "NULL AS world_id",
        "NULL AS world_name", "NULL AS group_name", "NULL AS instance_id",
        "NULL AS video_url", "NULL AS video_name", "NULL AS video_id",
        "resource_url", "resource_type"
    ].join(', ')
};

const C18_TAIL = ', NULL AS data, NULL AS message';
const C18_EVENT = [
    "id", "created_at", "'Event' AS type", "NULL AS display_name",
    "NULL AS location", "NULL AS user_id", "NULL AS time",
    "NULL AS world_id", "NULL AS world_name", "NULL AS group_name",
    "NULL AS instance_id", "NULL AS video_url", "NULL AS video_name",
    "NULL AS video_id", "NULL AS resource_url", "NULL AS resource_type",
    "data", "NULL AS message"
].join(', ');
const C18_EXTERNAL = [
    "id", "created_at", "'External' AS type", "display_name", "location",
    "user_id", "NULL AS time", "NULL AS world_id", "NULL AS world_name",
    "NULL AS group_name", "NULL AS instance_id", "NULL AS video_url",
    "NULL AS video_name", "NULL AS video_id", "NULL AS resource_url",
    "NULL AS resource_type", "NULL AS data", "message"
].join(', ');

const gameLog = {
    async getGamelogDatabase() {
        var date = new Date();
        date.setDate(date.getDate() - 1);
        var cutoff = date.toISOString().split('T')[0];
        var limit = dbVars.maxTableSize;
        const opts = { order: 'id DESC', limit: limit };
        const params = { cutoff };

        const locationRows = await adapter.selectWhere(
            'gamelog_location',
            '*',
            'created_at >= @cutoff',
            params,
            opts
        );
        const joinLeaveRows = await adapter.selectWhere(
            'gamelog_join_leave',
            '*',
            'created_at >= @cutoff',
            params,
            opts
        );
        const portalRows = await adapter.selectWhere(
            'gamelog_portal_spawn',
            '*',
            'created_at >= @cutoff',
            params,
            opts
        );
        const videoRows = await adapter.selectWhere(
            'gamelog_video_play',
            '*',
            'created_at >= @cutoff',
            params,
            opts
        );
        const resourceRows = await adapter.selectWhere(
            'gamelog_resource_load',
            '*',
            'created_at >= @cutoff',
            params,
            opts
        );
        const eventRows = await adapter.selectWhere(
            'gamelog_event',
            '*',
            'created_at >= @cutoff',
            params,
            opts
        );
        const externalRows = await adapter.selectWhere(
            'gamelog_external',
            '*',
            'created_at >= @cutoff',
            params,
            opts
        );

        const gamelogDatabase = [];
        for (const dbRow of locationRows) {
            gamelogDatabase.push({
                rowId: dbRow[0],
                created_at: dbRow[1],
                type: 'Location',
                location: dbRow[2],
                worldId: dbRow[3],
                worldName: dbRow[4],
                time: dbRow[5],
                groupName: dbRow[6]
            });
        }
        for (const dbRow of joinLeaveRows) {
            gamelogDatabase.push({
                rowId: dbRow[0],
                created_at: dbRow[1],
                type: dbRow[2],
                displayName: dbRow[3],
                location: dbRow[4],
                userId: dbRow[5],
                time: dbRow[6]
            });
        }
        for (const dbRow of portalRows) {
            gamelogDatabase.push({
                rowId: dbRow[0],
                created_at: dbRow[1],
                type: 'PortalSpawn',
                displayName: dbRow[2],
                location: dbRow[3],
                userId: dbRow[4],
                instanceId: dbRow[5],
                worldName: dbRow[6]
            });
        }
        for (const dbRow of videoRows) {
            gamelogDatabase.push({
                rowId: dbRow[0],
                created_at: dbRow[1],
                type: 'VideoPlay',
                videoUrl: dbRow[2],
                videoName: dbRow[3],
                videoId: dbRow[4],
                location: dbRow[5],
                displayName: dbRow[6],
                userId: dbRow[7]
            });
        }
        for (const dbRow of resourceRows) {
            gamelogDatabase.push({
                rowId: dbRow[0],
                created_at: dbRow[1],
                type: dbRow[3],
                resourceUrl: dbRow[2],
                location: dbRow[4]
            });
        }
        for (const dbRow of eventRows) {
            gamelogDatabase.push({
                rowId: dbRow[0],
                created_at: dbRow[1],
                type: 'Event',
                data: dbRow[2]
            });
        }
        for (const dbRow of externalRows) {
            gamelogDatabase.push({
                rowId: dbRow[0],
                created_at: dbRow[1],
                type: 'External',
                message: dbRow[2],
                displayName: dbRow[3],
                userId: dbRow[4],
                location: dbRow[5]
            });
        }
        var compareByCreatedAt = function (a, b) {
            var A = a.created_at;
            var B = b.created_at;
            if (A < B) {
                return -1;
            }
            if (A > B) {
                return 1;
            }
            return 0;
        };
        gamelogDatabase.sort(compareByCreatedAt);
        if (gamelogDatabase.length > dbVars.maxTableSize) {
            gamelogDatabase.splice(
                0,
                gamelogDatabase.length - dbVars.maxTableSize
            );
        }
        return gamelogDatabase;
    },

    addGamelogLocationToDatabase(entry) {
        adapter.insert(
            'gamelog_location',
            {
                created_at: entry.created_at,
                location: entry.location,
                world_id: entry.worldId,
                world_name: entry.worldName,
                time: entry.time,
                group_name: entry.groupName
            },
            'ignore'
        );
    },

    updateGamelogLocationTimeToDatabase(entry) {
        adapter.update(
            'gamelog_location',
            { time: entry.time },
            { created_at: entry.created_at }
        );
    },

    addGamelogJoinLeaveToDatabase(entry) {
        adapter.insert(
            'gamelog_join_leave',
            {
                created_at: entry.created_at,
                type: entry.type,
                display_name: entry.displayName,
                location: entry.location,
                user_id: entry.userId,
                time: entry.time
            },
            'ignore'
        );
    },

    addGamelogJoinLeaveBulk(inputData) {
        if (inputData.length === 0) {
            return;
        }
        const rows = inputData.map((line) => ({
            created_at:
                typeof line.created_at === 'string' ? line.created_at : '',
            type: typeof line.type === 'string' ? line.type : '',
            display_name:
                typeof line.displayName === 'string' ? line.displayName : '',
            location: typeof line.location === 'string' ? line.location : '',
            user_id: typeof line.userId === 'string' ? line.userId : '',
            time: typeof line.time === 'number' ? line.time : 0
        }));
        adapter
            .bulkInsert('gamelog_join_leave', rows, 'ignore')
            .catch((err) =>
                console.error('gamelog_join_leave bulk insert failed:', err)
            );
    },

    addGamelogPortalSpawnToDatabase(entry) {
        adapter.insert(
            'gamelog_portal_spawn',
            {
                created_at: entry.created_at,
                display_name: entry.displayName,
                location: entry.location,
                user_id: entry.userId,
                instance_id: entry.instanceId,
                world_name: entry.worldName
            },
            'ignore'
        );
    },

    addGamelogVideoPlayToDatabase(entry) {
        adapter.insert(
            'gamelog_video_play',
            {
                created_at: entry.created_at,
                video_url: entry.videoUrl,
                video_name: entry.videoName,
                video_id: entry.videoId,
                location: entry.location,
                display_name: entry.displayName,
                user_id: entry.userId
            },
            'ignore'
        );
    },

    addGamelogResourceLoadToDatabase(entry) {
        adapter.insert(
            'gamelog_resource_load',
            {
                created_at: entry.created_at,
                resource_url: entry.resourceUrl,
                resource_type: entry.type,
                location: entry.location
            },
            'ignore'
        );
    },

    addGamelogEventToDatabase(entry) {
        adapter.insert(
            'gamelog_event',
            {
                created_at: entry.created_at,
                data: entry.data
            },
            'ignore'
        );
    },

    addGamelogExternalToDatabase(entry) {
        adapter.insert(
            'gamelog_external',
            {
                created_at: entry.created_at,
                message: entry.message,
                display_name: entry.displayName,
                user_id: entry.userId,
                location: entry.location
            },
            'ignore'
        );
    },

    async getLastVisit(worldId, currentWorldMatch) {
        const count = currentWorldMatch ? 2 : 1;
        const rows = await adapter.selectWhere(
            'gamelog_location',
            ['created_at', 'world_id'],
            'world_id = @worldId',
            { worldId },
            { order: 'id DESC', limit: count }
        );
        if (rows.length === 0) return { created_at: '', worldId: '' };
        return { created_at: rows[0][0], worldId: rows[0][1] };
    },

    async getVisitCount(worldId) {
        const rows = await adapter.selectWhere(
            'gamelog_location',
            ['COUNT(DISTINCT location)'],
            'world_id = @worldId',
            { worldId }
        );
        return { visitCount: rows.length > 0 ? rows[0][0] : 0, worldId };
    },

    async getTimeSpentInWorld(worldId) {
        const rows = await adapter.selectWhere(
            'gamelog_location',
            ['time'],
            'world_id = @worldId',
            { worldId }
        );
        let timeSpent = 0;
        for (const row of rows) {
            if (typeof row[0] === 'number') timeSpent += row[0];
        }
        return { timeSpent, worldId };
    },

    async getLastGroupVisit(groupId) {
        const rows = await adapter.selectWhere(
            'gamelog_location',
            ['created_at'],
            'location LIKE @groupId',
            { groupId: `%${groupId}%` },
            { order: 'id DESC', limit: 1 }
        );
        return { created_at: rows.length > 0 ? rows[0][0] : '' };
    },

    async getPreviousInstancesByGroupId(groupId) {
        const rows = await adapter.selectWhere(
            'gamelog_location',
            ['created_at', 'location', 'time', 'world_name', 'group_name'],
            'location LIKE @groupId',
            { groupId: `%${groupId}%` },
            { order: 'id DESC' }
        );
        const data = new Map();
        for (const dbRow of rows) {
            let time = 0;
            if (dbRow[2]) time = dbRow[2];
            const existing = data.get(dbRow[1]);
            if (typeof existing !== 'undefined') time += existing.time;
            data.set(dbRow[1], {
                created_at: dbRow[0],
                location: dbRow[1],
                time,
                worldName: dbRow[3],
                groupName: dbRow[4]
            });
        }
        return data;
    },

    async getLastSeen(input, inCurrentWorld) {
        const count = inCurrentWorld ? 2 : 1;
        const rows = await adapter.selectWhere(
            'gamelog_join_leave',
            ['created_at', 'user_id'],
            'user_id = @userId OR display_name = @displayName',
            { userId: input.id, displayName: input.displayName },
            { order: 'id DESC', limit: count }
        );
        if (rows.length === 0) return { created_at: '', userId: '' };
        return {
            created_at: rows[0][0],
            userId: rows[0][1] || input.id
        };
    },

    async getLastJoinTimeForUserAtLocation(input, location) {
        const rows = await adapter.selectWhere(
            'gamelog_join_leave',
            ['created_at'],
            "type = 'OnPlayerJoined' AND (user_id = @userId OR display_name = @displayName) AND location = @location",
            { userId: input.id, displayName: input.displayName, location },
            { order: 'id DESC', limit: 1 }
        );
        if (rows.length === 0) return null;
        const ts = Date.parse(rows[0][0]);
        return isNaN(ts) ? null : ts;
    },

    async getRecentlyMetUsers(currentUserId, limit = 8) {
        const rows = await adapter.selectGroupBy('gamelog_join_leave', {
            columns: ['display_name', 'user_id'],
            aggregates: [{ expr: 'MAX(created_at)', alias: 'last_seen' }],
            groupBy: ['user_id'],
            where: "(type = 'OnPlayerJoined' OR type = 'OnPlayerLeft') AND user_id != @currentUserId AND user_id IS NOT NULL AND user_id != ''",
            params: { currentUserId },
            order: 'MAX(id) DESC',
            limit
        });
        return rows.map((row) => ({
            displayName: row[0],
            userId: row[1],
            lastSeen: row[2]
        }));
    },

    async getRecentlyJoinedLocations(limit = 10) {
        const rows = await adapter.selectGroupBy('gamelog_location', {
            columns: ['world_id', 'world_name', 'location'],
            aggregates: [{ expr: 'MAX(created_at)', alias: 'last_visited' }],
            groupBy: ['world_id'],
            where: "world_id IS NOT NULL AND world_id != ''",
            order: 'MAX(id) DESC',
            limit
        });
        return rows.map((row) => ({
            worldId: row[0],
            worldName: row[1],
            location: row[2],
            lastVisited: row[3]
        }));
    },

    async getJoinCount(input) {
        const rows = await adapter.selectWhere(
            'gamelog_join_leave',
            ['COUNT(DISTINCT location)'],
            "type = 'OnPlayerJoined' AND (user_id = @userId OR display_name = @displayName)",
            { userId: input.id, displayName: input.displayName }
        );
        return {
            joinCount: rows.length > 0 ? rows[0][0] : '',
            userId: input.id
        };
    },

    async getTimeSpent(input) {
        const rows = await adapter.selectWhere(
            'gamelog_join_leave',
            ['time'],
            "type = 'OnPlayerLeft' AND (user_id = @userId OR display_name = @displayName)",
            { userId: input.id, displayName: input.displayName }
        );
        let timeSpent = 0;
        for (const row of rows) {
            if (typeof row[0] === 'number') timeSpent += row[0];
        }
        return { timeSpent, userId: input.id };
    },

    async getUserStats(input, inCurrentWorld) {
        var i = 0;
        var instances = new Set();
        var ref = {
            timeSpent: 0,
            lastSeen: '',
            joinCount: 0,
            userId: input.id,
            previousDisplayNames: new Map()
        };
        const rows = await adapter.selectWhere(
            'gamelog_join_leave',
            ['created_at', 'user_id', 'time', 'location', 'display_name'],
            'user_id = @userId OR display_name = @displayName',
            { userId: input.id, displayName: input.displayName },
            { order: 'id DESC' }
        );
        for (const row of rows) {
            if (typeof row[2] === 'number') ref.timeSpent += row[2];
            i++;
            if (i === 1 || (inCurrentWorld && i === 2)) ref.lastSeen = row[0];
            instances.add(row[3]);
            if (input.displayName !== row[4])
                ref.previousDisplayNames.set(row[4], row[0]);
        }
        instances.delete('');
        ref.joinCount = instances.size;
        return ref;
    },

    async getAllUserStats(userIds, displayNames) {
        if (!userIds.length && !displayNames.length) return [];
        const args = {};
        const uidPlaceholders = [];
        userIds.forEach((userId, i) => {
            uidPlaceholders.push(`@uid_${i}`);
            args[`@uid_${i}`] = userId;
        });
        const dnPlaceholders = [];
        displayNames.forEach((dn, i) => {
            dnPlaceholders.push(`@dn_${i}`);
            args[`@dn_${i}`] = dn;
        });
        const whereClauses = [];
        if (uidPlaceholders.length) {
            whereClauses.push(`user_id IN (${uidPlaceholders.join(', ')})`);
        }
        if (dnPlaceholders.length) {
            whereClauses.push(`display_name IN (${dnPlaceholders.join(', ')})`);
        }

        // Standard SQL GROUP BY with dynamic IN lists
        const rows = await adapter.selectGroupBy('gamelog_join_leave', {
            columns: ['created_at', 'user_id', 'display_name'],
            aggregates: [
                { expr: 'SUM(time)', alias: 'timeSpent' },
                { expr: 'COUNT(DISTINCT location)', alias: 'joinCount' },
                { expr: 'MAX(id)', alias: 'max_id' }
            ],
            where: whereClauses.join(' OR '),
            groupBy: ['user_id', 'display_name'],
            order: 'user_id DESC',
            params: args
        });

        return rows.map((dbRow) => ({
            // Position: [created_at, user_id, display_name, timeSpent, joinCount, max_id]
            lastSeen: dbRow[0],
            userId: dbRow[1],
            timeSpent: dbRow[3],
            joinCount: dbRow[4],
            displayName: dbRow[2]
        }));
    },

    async getGameLogByLocation(instanceId, filters, vipList = []) {
        let vipQuery = '';
        const vipArgs = {};
        if (vipList.length > 0) {
            const vipPlaceholders = [];
            vipList.forEach((vip, i) => {
                const key = `vip_${i}`;
                vipArgs[key] = vip;
                vipPlaceholders.push(`@${key}`);
            });
            vipQuery = `AND user_id IN (${vipPlaceholders.join(', ')})`;
        }
        let location = true;
        let onplayerjoined = true;
        let onplayerleft = true;
        let portalspawn = true;
        let videoplay = true;
        let resourceload_string = true;
        let resourceload_image = true;
        if (filters.length > 0) {
            location = false;
            onplayerjoined = false;
            onplayerleft = false;
            portalspawn = false;
            videoplay = false;
            resourceload_string = false;
            resourceload_image = false;
            filters.forEach((filter) => {
                switch (filter) {
                    case 'Location':
                        location = true;
                        break;
                    case 'OnPlayerJoined':
                        onplayerjoined = true;
                        break;
                    case 'OnPlayerLeft':
                        onplayerleft = true;
                        break;
                    case 'PortalSpawn':
                        portalspawn = true;
                        break;
                    case 'VideoPlay':
                        videoplay = true;
                        break;
                    case 'StringLoad':
                        resourceload_string = true;
                        break;
                    case 'ImageLoad':
                        resourceload_image = true;
                        break;
                }
            });
        }

        const sharedParams = { locationLike: `%${instanceId}%`, ...vipArgs };
        const perTable = dbVars.searchTableSize;
        const sources = [];
        if (location) {
            sources.push({
                table: 'gamelog_location',
                columns: C16.LOCATION,
                where: 'location LIKE @locationLike',
                params: sharedParams,
                order: 'id DESC',
                limit: perTable
            });
        }
        if (onplayerjoined || onplayerleft) {
            let query = '';
            if (!onplayerjoined || !onplayerleft) {
                if (onplayerjoined) {
                    query = "AND type = 'OnPlayerJoined'";
                } else if (onplayerleft) {
                    query = "AND type = 'OnPlayerLeft'";
                }
            }
            sources.push({
                table: 'gamelog_join_leave',
                columns: C16.JOIN_LEAVE,
                where: `(location LIKE @locationLike AND user_id != '${dbVars.userId}') ${vipQuery} ${query}`,
                params: sharedParams,
                order: 'id DESC',
                limit: perTable
            });
        }
        if (portalspawn) {
            sources.push({
                table: 'gamelog_portal_spawn',
                columns: C16.PORTAL_SPAWN,
                where: `location LIKE @locationLike ${vipQuery}`,
                params: sharedParams,
                order: 'id DESC',
                limit: perTable
            });
        }
        if (videoplay) {
            sources.push({
                table: 'gamelog_video_play',
                columns: C16.VIDEO_PLAY,
                where: `location LIKE @locationLike ${vipQuery}`,
                params: sharedParams,
                order: 'id DESC',
                limit: perTable
            });
        }
        if (resourceload_string || resourceload_image) {
            let checkString = '';
            let checkImage = '';
            if (!resourceload_string) checkString = "AND resource_type != 'StringLoad'";
            if (!resourceload_image) checkImage = "AND resource_type != 'ImageLoad'";
            sources.push({
                table: 'gamelog_resource_load',
                columns: C16.RESOURCE_LOAD,
                where: `location LIKE @locationLike ${checkString} ${checkImage}`,
                params: sharedParams,
                order: 'id DESC',
                limit: perTable
            });
        }
        if (sources.length === 0) return [];

        const rows = await adapter.selectUnion(sources, {
            order: 'created_at DESC, id DESC',
            limit: dbVars.searchTableSize
        });
        return rows.map((dbRow) => {
            const type = dbRow[2];
            const row = { rowId: dbRow[0], created_at: dbRow[1], type };
            switch (type) {
                case 'Location':
                    row.location = dbRow[4];
                    row.worldId = dbRow[7];
                    row.worldName = dbRow[8];
                    row.time = dbRow[6];
                    row.groupName = dbRow[9];
                    break;
                case 'OnPlayerJoined':
                case 'OnPlayerLeft':
                    row.displayName = dbRow[3];
                    row.location = dbRow[4];
                    row.userId = dbRow[5];
                    row.time = dbRow[6];
                    break;
                case 'PortalSpawn':
                    row.displayName = dbRow[3];
                    row.location = dbRow[4];
                    row.userId = dbRow[5];
                    row.instanceId = dbRow[10];
                    row.worldName = dbRow[8];
                    break;
                case 'VideoPlay':
                    row.videoUrl = dbRow[11];
                    row.videoName = dbRow[12];
                    row.videoId = dbRow[13];
                    row.location = dbRow[4];
                    row.displayName = dbRow[3];
                    row.userId = dbRow[5];
                    break;
                case 'StringLoad':
                case 'ImageLoad':
                    row.resourceUrl = dbRow[14];
                    row.location = dbRow[4];
                    break;
            }
            return row;
        });
    },

    async lookupGameLogDatabase(
        filters,
        vipList,
        maxEntries = dbVars.maxTableSize
    ) {
        let vipQuery = '';
        const vipArgs = {};
        if (vipList.length > 0) {
            const vipPlaceholders = [];
            vipList.forEach((vip, i) => {
                const key = `vip_${i}`;
                vipArgs[key] = vip;
                vipPlaceholders.push(`@${key}`);
            });
            vipQuery = `AND user_id IN (${vipPlaceholders.join(', ')})`;
        }
        let location = true;
        let onplayerjoined = true;
        let onplayerleft = true;
        let portalspawn = true;
        let msgevent = true;
        let external = true;
        let videoplay = true;
        let resourceload_string = true;
        let resourceload_image = true;
        if (filters.length > 0) {
            location = false;
            onplayerjoined = false;
            onplayerleft = false;
            portalspawn = false;
            msgevent = false;
            external = false;
            videoplay = false;
            resourceload_string = false;
            resourceload_image = false;
            filters.forEach((filter) => {
                switch (filter) {
                    case 'Location':
                        location = true;
                        break;
                    case 'OnPlayerJoined':
                        onplayerjoined = true;
                        break;
                    case 'OnPlayerLeft':
                        onplayerleft = true;
                        break;
                    case 'PortalSpawn':
                        portalspawn = true;
                        break;
                    case 'Event':
                        msgevent = true;
                        break;
                    case 'External':
                        external = true;
                        break;
                    case 'VideoPlay':
                        videoplay = true;
                        break;
                    case 'StringLoad':
                        resourceload_string = true;
                        break;
                    case 'ImageLoad':
                        resourceload_image = true;
                        break;
                }
            });
        }
        const sharedParams = { ...vipArgs };
        const perTable = maxEntries;
        const sources = [];
        if (location) {
            sources.push({
                table: 'gamelog_location',
                columns: C16.LOCATION + C18_TAIL,
                where: null,
                params: sharedParams,
                order: 'id DESC',
                limit: perTable
            });
        }
        if (onplayerjoined || onplayerleft) {
            let query = '';
            if (!onplayerjoined || !onplayerleft) {
                if (onplayerjoined) query = "AND type = 'OnPlayerJoined'";
                else if (onplayerleft) query = "AND type = 'OnPlayerLeft'";
            }
            sources.push({
                table: 'gamelog_join_leave',
                columns: C16.JOIN_LEAVE + C18_TAIL,
                where: `1=1 ${vipQuery} ${query}`,
                params: sharedParams,
                order: 'id DESC',
                limit: perTable
            });
        }
        if (portalspawn) {
            sources.push({
                table: 'gamelog_portal_spawn',
                columns: C16.PORTAL_SPAWN + C18_TAIL,
                where: `1=1 ${vipQuery}`,
                params: sharedParams,
                order: 'id DESC',
                limit: perTable
            });
        }
        if (msgevent) {
            sources.push({
                table: 'gamelog_event',
                columns: C18_EVENT,
                where: null,
                params: sharedParams,
                order: 'id DESC',
                limit: perTable
            });
        }
        if (external) {
            sources.push({
                table: 'gamelog_external',
                columns: C18_EXTERNAL,
                where: `1=1 ${vipQuery}`,
                params: sharedParams,
                order: 'id DESC',
                limit: perTable
            });
        }
        if (videoplay) {
            sources.push({
                table: 'gamelog_video_play',
                columns: C16.VIDEO_PLAY + C18_TAIL,
                where: `1=1 ${vipQuery}`,
                params: sharedParams,
                order: 'id DESC',
                limit: perTable
            });
        }
        if (resourceload_string || resourceload_image) {
            let checkString = '';
            let checkImage = '';
            if (!resourceload_string) checkString = "AND resource_type != 'StringLoad'";
            if (!resourceload_image) checkImage = "AND resource_type != 'ImageLoad'";
            sources.push({
                table: 'gamelog_resource_load',
                columns: C16.RESOURCE_LOAD + C18_TAIL,
                where: `1=1 ${checkString} ${checkImage}`,
                params: sharedParams,
                order: 'id DESC',
                limit: perTable
            });
        }
        if (sources.length === 0) return [];

        const rows = await adapter.selectUnion(sources, {
            order: 'created_at DESC, id DESC',
            limit: maxEntries
        });
        return rows.map((dbRow) => {
            const row = {
                rowId: dbRow[0],
                created_at: dbRow[1],
                type: dbRow[2]
            };
            switch (dbRow[2]) {
                case 'Location':
                    row.location = dbRow[4];
                    row.worldId = dbRow[7];
                    row.worldName = dbRow[8];
                    row.time = dbRow[6];
                    row.groupName = dbRow[9];
                    break;
                case 'OnPlayerJoined':
                case 'OnPlayerLeft':
                    row.displayName = dbRow[3];
                    row.location = dbRow[4];
                    row.userId = dbRow[5];
                    row.time = dbRow[6];
                    break;
                case 'PortalSpawn':
                    row.displayName = dbRow[3];
                    row.location = dbRow[4];
                    row.userId = dbRow[5];
                    row.instanceId = dbRow[10];
                    row.worldName = dbRow[8];
                    break;
                case 'VideoPlay':
                    row.videoUrl = dbRow[11];
                    row.videoName = dbRow[12];
                    row.videoId = dbRow[13];
                    row.location = dbRow[4];
                    row.displayName = dbRow[3];
                    row.userId = dbRow[5];
                    break;
                case 'Event':
                    row.data = dbRow[16];
                    break;
                case 'External':
                    row.message = dbRow[17];
                    row.displayName = dbRow[3];
                    row.userId = dbRow[5];
                    row.location = dbRow[4];
                    break;
                case 'StringLoad':
                case 'ImageLoad':
                    row.resourceUrl = dbRow[14];
                    row.location = dbRow[4];
                    break;
            }
            return row;
        });
    },

    /**
     * Lookup the game log database for a specific search term
     * @param {string} search The search term
     * @param {Array} filters The filters to apply
     * @param {Array} [vipList] The list of VIP users
     * @returns {Promise<any[]>} The game log data
     */

    async searchGameLogDatabase(
        search,
        filters,
        vipList,
        maxEntries = dbVars.searchTableSize
    ) {
        if (search.startsWith('wrld_') || search.startsWith('grp_')) {
            return this.getGameLogByLocation(search, filters, vipList);
        }
        let vipQuery = '';
        const vipArgs = {};
        if (vipList.length > 0) {
            const vipPlaceholders = [];
            vipList.forEach((vip, i) => {
                const key = `vip_${i}`;
                vipArgs[key] = vip;
                vipPlaceholders.push(`@${key}`);
            });
            vipQuery = `AND user_id IN (${vipPlaceholders.join(', ')})`;
        }
        let location = true;
        let onplayerjoined = true;
        let onplayerleft = true;
        let portalspawn = true;
        let msgevent = true;
        let external = true;
        let videoplay = true;
        let resourceload_string = true;
        let resourceload_image = true;
        if (filters.length > 0) {
            location = false;
            onplayerjoined = false;
            onplayerleft = false;
            portalspawn = false;
            msgevent = false;
            external = false;
            videoplay = false;
            resourceload_string = false;
            resourceload_image = false;
            filters.forEach((filter) => {
                switch (filter) {
                    case 'Location':
                        location = true;
                        break;
                    case 'OnPlayerJoined':
                        onplayerjoined = true;
                        break;
                    case 'OnPlayerLeft':
                        onplayerleft = true;
                        break;
                    case 'PortalSpawn':
                        portalspawn = true;
                        break;
                    case 'Event':
                        msgevent = true;
                        break;
                    case 'External':
                        external = true;
                        break;
                    case 'VideoPlay':
                        videoplay = true;
                        break;
                    case 'StringLoad':
                        resourceload_string = true;
                        break;
                    case 'ImageLoad':
                        resourceload_image = true;
                        break;
                }
            });
        }
        const searchLike = `%${search}%`;
        const sharedParams = { searchLike, ...vipArgs };
        const perTable = maxEntries;
        const sources = [];
        if (location) {
            sources.push({
                table: 'gamelog_location',
                columns: C16.LOCATION + C18_TAIL,
                where: '(world_name LIKE @searchLike OR group_name LIKE @searchLike)',
                params: sharedParams,
                order: 'id DESC',
                limit: perTable
            });
        }
        if (onplayerjoined || onplayerleft) {
            let query = '';
            if (!onplayerjoined || !onplayerleft) {
                if (onplayerjoined) query = "AND type = 'OnPlayerJoined'";
                else if (onplayerleft) query = "AND type = 'OnPlayerLeft'";
            }
            sources.push({
                table: 'gamelog_join_leave',
                columns: C16.JOIN_LEAVE + C18_TAIL,
                where: `(display_name LIKE @searchLike AND user_id != '${dbVars.userId}') ${vipQuery} ${query}`,
                params: sharedParams,
                order: 'id DESC',
                limit: perTable
            });
        }
        if (portalspawn) {
            sources.push({
                table: 'gamelog_portal_spawn',
                columns: C16.PORTAL_SPAWN + C18_TAIL,
                where: `(display_name LIKE @searchLike OR world_name LIKE @searchLike) ${vipQuery}`,
                params: sharedParams,
                order: 'id DESC',
                limit: perTable
            });
        }
        if (msgevent) {
            sources.push({
                table: 'gamelog_event',
                columns: C18_EVENT,
                where: 'data LIKE @searchLike',
                params: sharedParams,
                order: 'id DESC',
                limit: perTable
            });
        }
        if (external) {
            sources.push({
                table: 'gamelog_external',
                columns: C18_EXTERNAL,
                where: `(display_name LIKE @searchLike OR message LIKE @searchLike) ${vipQuery}`,
                params: sharedParams,
                order: 'id DESC',
                limit: perTable
            });
        }
        if (videoplay) {
            sources.push({
                table: 'gamelog_video_play',
                columns: C16.VIDEO_PLAY + C18_TAIL,
                where: `(video_url LIKE @searchLike OR video_name LIKE @searchLike OR display_name LIKE @searchLike) ${vipQuery}`,
                params: sharedParams,
                order: 'id DESC',
                limit: perTable
            });
        }
        if (resourceload_string || resourceload_image) {
            let checkString = '';
            let checkImage = '';
            if (!resourceload_string) checkString = "AND resource_type != 'StringLoad'";
            if (!resourceload_image) checkImage = "AND resource_type != 'ImageLoad'";
            sources.push({
                table: 'gamelog_resource_load',
                columns: C16.RESOURCE_LOAD + C18_TAIL,
                where: `resource_url LIKE @searchLike ${checkString} ${checkImage}`,
                params: sharedParams,
                order: 'id DESC',
                limit: perTable
            });
        }
        if (sources.length === 0) return [];

        const rows = await adapter.selectUnion(sources, {
            order: 'created_at DESC, id DESC',
            limit: maxEntries
        });
        return rows.map((dbRow) => {
            const type = dbRow[2];
            const row = { rowId: dbRow[0], created_at: dbRow[1], type };
            switch (type) {
                case 'Location':
                    row.location = dbRow[4];
                    row.worldId = dbRow[7];
                    row.worldName = dbRow[8];
                    row.time = dbRow[6];
                    row.groupName = dbRow[9];
                    break;
                case 'OnPlayerJoined':
                case 'OnPlayerLeft':
                    row.displayName = dbRow[3];
                    row.location = dbRow[4];
                    row.userId = dbRow[5];
                    row.time = dbRow[6];
                    break;
                case 'PortalSpawn':
                    row.displayName = dbRow[3];
                    row.location = dbRow[4];
                    row.userId = dbRow[5];
                    row.instanceId = dbRow[10];
                    row.worldName = dbRow[8];
                    break;
                case 'VideoPlay':
                    row.videoUrl = dbRow[11];
                    row.videoName = dbRow[12];
                    row.videoId = dbRow[13];
                    row.location = dbRow[4];
                    row.displayName = dbRow[3];
                    row.userId = dbRow[5];
                    break;
                case 'Event':
                    row.data = dbRow[16];
                    break;
                case 'External':
                    row.message = dbRow[17];
                    row.displayName = dbRow[3];
                    row.userId = dbRow[5];
                    row.location = dbRow[4];
                    break;
                case 'StringLoad':
                case 'ImageLoad':
                    row.resourceUrl = dbRow[14];
                    row.location = dbRow[4];
                    break;
            }
            return row;
        });
    },

    async getLastDateGameLogDatabase() {
        const tables = [
            'gamelog_location',
            'gamelog_join_leave',
            'gamelog_portal_spawn',
            'gamelog_event',
            'gamelog_video_play',
            'gamelog_resource_load'
        ];
        const results = await Promise.all(
            tables.map((t) =>
                adapter.selectWhere(t, ['created_at'], null, null, {
                    order: 'id DESC',
                    limit: 1
                })
            )
        );
        const dates = results
            .flatMap((rows) => rows.map((r) => r[0]))
            .filter(Boolean);
        if (dates.length > 0) {
            dates.sort();
            var date = new Date().toJSON();
            var dateOffset = new Date(Date.now() - 86400000).toJSON();
            var newDate = dates[dates.length - 1];
            if (newDate > dateOffset && newDate < date) {
                return newDate;
            }
        }
        return new Date().toJSON();
    },

    async getGameLogWorldNameByWorldId(worldId) {
        const rows = await adapter.selectWhere(
            'gamelog_location',
            ['world_name'],
            'world_id = @worldId',
            { worldId },
            { order: 'id DESC', limit: 1 }
        );
        return rows.length > 0 ? rows[0][0] : '';
    },

    async getPreviousInstancesByUserId(input) {
        var groupingTimeTolerance = 1 * 60 * 60 * 1000; // 1 hour
        var data = new Set();
        var currentGroup;
        var prevEvent;

        // created_at_ts computed in JS (new Date) instead of adapter.sqlToUnixMs.
        const rows = await adapter.selectJoin({
            from: 'gamelog_join_leave',
            alias: 'jl',
            joins: [{
                type: 'INNER',
                table: '(SELECT DISTINCT location, world_name, group_name FROM gamelog_location)',
                alias: 'gl',
                on: 'jl.location = gl.location'
            }],
            columns: [
                'jl.created_at', 'jl.location', 'jl.time',
                'gl.world_name', 'gl.group_name', 'jl.id', 'jl.type'
            ],
            where: 'jl.user_id = @userId OR jl.display_name = @displayName',
            params: { userId: input.id, displayName: input.displayName },
            order: 'jl.id ASC'
        });
        for (const dbRow of rows) {
            var [
                created_at_iso,
                location,
                time,
                worldName,
                groupName,
                eventId,
                eventType
            ] = dbRow;
            var created_at_ts = new Date(created_at_iso).getTime();

            if (
                !currentGroup ||
                currentGroup.location !== location ||
                (created_at_ts - currentGroup.last_ts >
                    groupingTimeTolerance &&
                    !(
                        prevEvent === 'OnPlayerJoined' &&
                        eventType === 'OnPlayerLeft'
                    ))
            ) {
                currentGroup = {
                    created_at: created_at_iso,
                    location,
                    time,
                    worldName,
                    groupName,
                    events: [eventId],
                    last_ts: created_at_ts
                };

                data.add(currentGroup);
            } else {
                currentGroup.time += time;
                currentGroup.last_ts = created_at_ts;
                currentGroup.events.push(eventId);
            }

            prevEvent = eventType;
        }

        return data;
    },

    async getPreviousInstancesByWorldId(input) {
        var data = new Map();
        const rows = await adapter.selectWhere(
            'gamelog_location',
            ['created_at', 'location', 'time', 'world_name', 'group_name'],
            'world_id = @worldId',
            { worldId: input.id },
            { order: 'id DESC' }
        );
        for (const dbRow of rows) {
            var time = 0;
            if (dbRow[2]) time = dbRow[2];
            var ref = data.get(dbRow[1]);
            if (typeof ref !== 'undefined') time += ref.time;
            var row = {
                created_at: dbRow[0],
                location: dbRow[1],
                time,
                worldName: dbRow[3],
                groupName: dbRow[4]
            };
            data.set(row.location, row);
        }
        return data;
    },

    async getPlayersFromInstance(location) {
        var players = new Map();
        const rows = await adapter.selectWhere(
            'gamelog_join_leave',
            ['created_at', 'display_name', 'user_id', 'time', 'type'],
            'location = @location',
            { location }
        );
        for (const dbRow of rows) {
            var time = 0;
            var count = 0;
            var created_at = dbRow[0];
            if (dbRow[3]) time = dbRow[3];
            var ref = players.get(dbRow[1]);
            if (typeof ref !== 'undefined') {
                time += ref.time;
                count = ref.count;
                created_at = ref.created_at;
            }
            if (dbRow[4] === 'OnPlayerJoined') count++;
            var row = {
                created_at,
                displayName: dbRow[1],
                userId: dbRow[2],
                time,
                count
            };
            players.set(row.displayName, row);
        }
        return players;
    },

    /**
     * @param {string} location
     * @returns {Promise<Array<{created_at: string, display_name: string, user_id: string, time: number}>>}
     */
    async getPlayerDetailFromInstance(location) {
        const entries = [];
        const rows = await adapter.selectWhere(
            'gamelog_join_leave',
            ['created_at', 'display_name', 'user_id', 'time'],
            "location = @location AND type = 'OnPlayerLeft'",
            { location },
            { order: 'created_at ASC' }
        );
        for (const dbRow of rows) {
            entries.push({
                created_at: dbRow[0],
                display_name: dbRow[1],
                user_id: dbRow[2],
                time: dbRow[3] || 0
            });
        }
        return entries;
    },

    async getPreviousDisplayNamesByUserId(ref) {
        var data = new Map();
        const rows = await adapter.selectWhere(
            'gamelog_join_leave',
            ['created_at', 'display_name'],
            'user_id = @userId',
            { userId: ref.id },
            { order: 'id DESC' }
        );
        for (const dbRow of rows) {
            if (ref.displayName !== dbRow[1]) {
                data.set(dbRow[1], dbRow[0]);
            }
        }
        return data;
    },

    async getGameLogInstancesTime() {
        var instances = new Map();
        const rows = await adapter.selectWhere(
            'gamelog_location',
            ['location', 'time'],
            null
        );
        for (const dbRow of rows) {
            var time = 0;
            var location = dbRow[0];
            if (dbRow[1]) time = dbRow[1];
            var ref = instances.get(location);
            if (typeof ref !== 'undefined') time += ref;
            instances.set(location, time);
        }
        return instances;
    },

    /**
     * Get current user's online sessions from gamelog_location
     * Each row has created_at (leave time) and time (duration in ms)
     * Session start = created_at - time, Session end = created_at
     * @param {number} [fromDays=0] - How many days back to start (0 = all time)
     * @param {number} [toDays=0] - How many days back to stop (0 = now)
     * @returns {Promise<Array<{created_at: string, time: number}>>}
     */
    async getCurrentUserOnlineSessions(fromDays = 0, toDays = 0) {
        const data = [];
        const now = new Date();
        const params = {};
        const where = [];

        if (fromDays > 0) {
            const fromDate = new Date(
                now.getTime() - fromDays * 86400000
            ).toISOString();
            params.fromDate = fromDate;
            where.push('created_at >= @fromDate');

            // Standard SQL: last row before fromDate
            const rows = await adapter.selectWhere(
                'gamelog_location',
                ['created_at', 'time'],
                'created_at < @fromDate',
                { fromDate },
                { order: 'created_at DESC', limit: 1 }
            );
            for (const dbRow of rows) {
                data.push({ created_at: dbRow[0], time: dbRow[1] || 0 });
            }
        }
        if (toDays > 0) {
            const toDate = new Date(
                now.getTime() - toDays * 86400000
            ).toISOString();
            params.toDate = toDate;
            where.push('created_at < @toDate');
        }

        const mainWhere = where.join(' AND ');
        const rows = await adapter.selectWhere(
            'gamelog_location',
            ['created_at', 'time'],
            mainWhere || null,
            params,
            { order: 'created_at' }
        );
        for (const dbRow of rows) {
            data.push({ created_at: dbRow[0], time: dbRow[1] || 0 });
        }
        return data;
    },

    /**
     * Get current user's online sessions after a given timestamp (incremental).
     * @param {string} afterCreatedAt - Only return rows created after this timestamp
     * @param {boolean} [inclusive=false] - If true, use >= instead of > to re-read the last record
     * @returns {Promise<Array<{created_at: string, time: number}>>}
     */
    async getCurrentUserOnlineSessionsAfter(afterCreatedAt, inclusive = false) {
        const data = [];
        const op = inclusive ? '>=' : '>';
        const rows = await adapter.selectWhere(
            'gamelog_location',
            ['created_at', 'time'],
            'created_at ' + op + ' @after',
            { after: afterCreatedAt },
            { order: 'created_at' }
        );
        for (const dbRow of rows) {
            data.push({ created_at: dbRow[0], time: dbRow[1] || 0 });
        }
        return data;
    },

    /**
     * Get current user's top visited worlds from gamelog_location.
     * Groups by world_id and aggregates visit count and total time.
     * @param {number} [days] - Number of days to look back. Omit or 0 for all time.
     * @param {number} [limit=5] - Maximum number of worlds to return.
     * @param {'time'|'count'} [sortBy='time'] - Sort by total time or visit count.
     * @param {string} [excludeWorldId=''] - Optional world ID to exclude from results.
     * @returns {Promise<Array<{worldId: string, worldName: string, visitCount: number, totalTime: number}>>}
     */
    async getMyTopWorlds(
        days = 0,
        limit = 5,
        sortBy = 'time',
        excludeWorldId = ''
    ) {
        const whereClause = days > 0 ? 'AND created_at >= @cutoff' : '';
        const excludeClause = excludeWorldId
            ? 'AND world_id != @excludeWorldId'
            : '';
        const orderBy =
            sortBy === 'count' ? 'visit_count DESC' : 'total_time DESC';
        const params = {};
        if (days > 0) {
            params.cutoff = adapter.daysAgoISO(days);
        }
        if (excludeWorldId) {
            params.excludeWorldId = excludeWorldId;
        }
        // Standard SQL GROUP BY with portable ISO string filter
        const rows = await adapter.selectGroupBy('gamelog_location', {
            columns: ['world_id', 'world_name'],
            aggregates: [
                { expr: 'COUNT(*)', alias: 'visit_count' },
                { expr: 'SUM(time)', alias: 'total_time' }
            ],
            where: `world_id IS NOT NULL AND world_id != '' AND world_id LIKE 'wrld_%' ${whereClause} ${excludeClause}`,
            groupBy: ['world_id'],
            order: orderBy,
            limit: limit,
            params
        });
        return rows.map((dbRow) => ({
            worldId: dbRow[0],
            worldName: dbRow[1] || dbRow[0],
            visitCount: dbRow[2],
            totalTime: dbRow[3] || 0
        }));
    },

    async getUserIdFromDisplayName(displayName) {
        const rows = await adapter.selectWhere(
            'gamelog_join_leave',
            ['user_id'],
            "display_name = @displayName AND user_id != ''",
            { displayName },
            { order: 'id DESC', limit: 1 }
        );
        return rows.length > 0 ? rows[0][0] : '';
    },

    /**
     *
     * @param {string} startDate: utc string of startOfDay
     * @param {string} endDate: utc string endOfDay
     * @param startDate
     * @param endDate
     * @returns
     */
    async getInstanceActivity(startDate, endDate) {
        const currentUserData = [];
        const detailData = new Map();

        // enter_time = created_at - time (ISO timestamp for BETWEEN comparison)
        await adapter.execute(
            (row) => {
                const rowData = {
                    id: row[0],
                    created_at: row[1],
                    type: row[2],
                    display_name: row[3],
                    location: row[4],
                    user_id: row[5],
                    time: row[6]
                };

                // skip dirty data
                if (!rowData.location || rowData.location === 'traveling')
                    return;

                if (rowData.user_id === dbVars.userId) {
                    currentUserData.push(rowData);
                }
                const instanceData = detailData.get(rowData.location);

                detailData.set(rowData.location, [
                    ...(instanceData || []),
                    rowData
                ]);
            },
            `SELECT id, created_at, type, display_name, location, user_id, time
             FROM gamelog_join_leave
             WHERE type = 'OnPlayerLeft'
             AND (
                 ${adapter.sqlEnterTime('created_at', 'time')}
                 BETWEEN @utc_start_date AND @utc_end_date
                 OR created_at BETWEEN @utc_start_date AND @utc_end_date
             )`,
            {
                utc_start_date: startDate,
                utc_end_date: endDate
            }
        );

        return { currentUserData, detailData };
    },

    /**
     * Get the All Date of Instance Activity for the current user
     * @returns {Promise<string[]>}
     */
    async getDateOfInstanceActivity() {
        const rows = await adapter.selectWhere(
            'gamelog_join_leave',
            ['created_at'],
            'user_id = @userId',
            { userId: dbVars.userId }
        );
        return rows.map((row) => row[0]);
    },

    /**
     * Get shared instance history between two friends
     * @param {string} friendAUserId - The first friend's user ID
     * @param {string} friendBUserId - The second friend's user ID
     * @returns {Promise<Array<{location: string, friendALeave: string, friendATime: number, friendBLeave: string, friendBTime: number}>>}
     */
    async getCoInstanceHistoryBetweenFriends(friendAUserId, friendBUserId) {
        const results = [];
        const dedupeKeys = new Set();
        const appendResult = (row) => {
            const key = `${row.location}|${row.friendALeave}|${row.friendATime}|${row.friendBLeave}|${row.friendBTime}`;
            if (dedupeKeys.has(key)) return;
            dedupeKeys.add(key);
            results.push(row);
        };

        // Standard SQL: load OnPlayerLeft records for both friends separately.
        // Overlap detection moved to JS (enter_time is unreliable per VRChat API).
        const locationFilter =
            "location NOT IN ('', 'traveling', 'private', 'private:private')";
        const [rowsA, rowsB] = await Promise.all([
            adapter.selectWhere(
                'gamelog_join_leave',
                ['location', 'created_at', 'time'],
                "type='OnPlayerLeft' AND user_id=@uid AND " +
                    locationFilter +
                    ' AND time>0',
                { uid: friendAUserId },
                { order: 'created_at DESC' }
            ),
            adapter.selectWhere(
                'gamelog_join_leave',
                ['location', 'created_at', 'time'],
                "type='OnPlayerLeft' AND user_id=@uid AND " +
                    locationFilter +
                    ' AND time>0',
                { uid: friendBUserId },
                { order: 'created_at DESC' }
            )
        ]);

        // Group by location for efficient JS overlap matching
        const byLocationA = new Map();
        for (const row of rowsA) {
            const loc = row[0];
            if (!byLocationA.has(loc)) byLocationA.set(loc, []);
            byLocationA
                .get(loc)
                .push({ location: loc, created_at: row[1], time: row[2] || 0 });
        }
        const byLocationB = new Map();
        for (const row of rowsB) {
            const loc = row[0];
            if (!byLocationB.has(loc)) byLocationB.set(loc, []);
            byLocationB
                .get(loc)
                .push({ location: loc, created_at: row[1], time: row[2] || 0 });
        }

        // JS overlap detection: enter_time = created_at - time (both in ms via Date.parse)
        for (const [location, sessionsA] of byLocationA) {
            const sessionsB = byLocationB.get(location);
            if (!sessionsB) continue;
            for (const a of sessionsA) {
                const aLeave = new Date(a.created_at).getTime();
                const aEnter = aLeave - a.time;
                for (const b of sessionsB) {
                    const bLeave = new Date(b.created_at).getTime();
                    const bEnter = bLeave - b.time;
                    if (aEnter < bLeave && bEnter < aLeave) {
                        appendResult({
                            location,
                            friendALeave: a.created_at,
                            friendATime: a.time,
                            friendBLeave: b.created_at,
                            friendBTime: b.time
                        });
                    }
                }
            }
        }

        // Standard SQL UNION ALL via adapter with dynamic table names
        const getInferredLocationSessions = async (userId) => {
            const rows = await adapter.selectUnion(
                [
                    {
                        table: adapter.userTable(dbVars.userPrefix, 'feed_gps'),
                        columns: [
                            'previous_location AS location',
                            'created_at',
                            'time'
                        ],
                        where: "user_id=@uid AND previous_location NOT IN ('','offline','traveling','private','private:private') AND time>0",
                        params: { uid: userId }
                    },
                    {
                        table: adapter.userTable(
                            dbVars.userPrefix,
                            'feed_online_offline'
                        ),
                        columns: ['location', 'created_at', 'time'],
                        where: "user_id=@uid AND type='Offline' AND location NOT IN ('','offline','traveling','private','private:private') AND time>0",
                        params: { uid: userId }
                    }
                ],
                { order: 'created_at DESC' }
            );
            return rows.map((row) => ({
                location: row[0],
                leaveAt: row[1],
                time: row[2]
            }));
        };

        const [friendASessions, friendBSessions] = await Promise.all([
            getInferredLocationSessions(friendAUserId),
            getInferredLocationSessions(friendBUserId)
        ]);

        const sessionsBByLocation = new Map();
        for (const session of friendBSessions) {
            if (!sessionsBByLocation.has(session.location)) {
                sessionsBByLocation.set(session.location, []);
            }
            sessionsBByLocation.get(session.location).push(session);
        }

        for (const sessionA of friendASessions) {
            const sessionBList = sessionsBByLocation.get(sessionA.location);
            if (!sessionBList || sessionBList.length === 0) continue;
            const sessionALeaveMs = new Date(sessionA.leaveAt).getTime();
            const sessionAJoinMs = sessionALeaveMs - sessionA.time;
            for (const sessionB of sessionBList) {
                const sessionBLeaveMs = new Date(sessionB.leaveAt).getTime();
                const sessionBJoinMs = sessionBLeaveMs - sessionB.time;
                if (
                    sessionAJoinMs < sessionBLeaveMs &&
                    sessionBJoinMs < sessionALeaveMs
                ) {
                    appendResult({
                        location: sessionA.location,
                        friendALeave: sessionA.leaveAt,
                        friendATime: sessionA.time,
                        friendBLeave: sessionB.leaveAt,
                        friendBTime: sessionB.time
                    });
                }
            }
        }

        results.sort((a, b) => {
            if (a.friendALeave < b.friendALeave) return 1;
            if (a.friendALeave > b.friendALeave) return -1;
            return 0;
        });
        return results;
    },

    /**
     * Get self (current user) presence records for a list of locations.
     * Returns a map from location → array of { selfLeave: string, selfTime: number }.
     * @param {string} userId - The current user's ID
     * @param {string[]} locations - Array of location strings
     * @returns {Promise<Map<string, Array<{selfLeave: string, selfTime: number}>>>}
     */
    async getSelfPresenceForLocations(userId, locations) {
        if (!locations || locations.length === 0) return new Map();
        const result = new Map();
        const rows = await adapter.selectWhereIn(
            'gamelog_join_leave',
            ['location', 'created_at', 'time'],
            'location',
            locations,
            "user_id = @userId AND type = 'OnPlayerLeft' AND time > 0",
            { userId }
        );
        for (const row of rows) {
            const loc = row[0];
            if (!result.has(loc)) result.set(loc, []);
            result.get(loc).push({ selfLeave: row[1], selfTime: row[2] || 0 });
        }
        return result;
    },

    /**
     * Get maximum concurrent player count for a list of locations using
     * a sweep-line algorithm over all OnPlayerLeft records.
     * @param {string[]} locations - Array of location strings
     * @returns {Promise<Map<string, number>>}
     */
    async getMaxPlayerCountForLocations(locations) {
        if (!locations || locations.length === 0) return new Map();
        const entries = [];
        const rows = await adapter.selectWhereIn(
            'gamelog_join_leave',
            ['location', 'created_at', 'time'],
            'location',
            locations,
            "type = 'OnPlayerLeft' AND time > 0",
            {},
            { order: 'location' }
        );
        for (const row of rows) {
            entries.push({
                location: row[0],
                createdAt: row[1],
                time: row[2] || 0
            });
        }

        // Group by location
        const byLocation = new Map();
        for (const entry of entries) {
            if (!byLocation.has(entry.location))
                byLocation.set(entry.location, []);
            byLocation.get(entry.location).push(entry);
        }

        // Sweep-line: find peak concurrent count per location
        const result = new Map();
        for (const [location, playerEntries] of byLocation.entries()) {
            const events = [];
            for (const entry of playerEntries) {
                const leaveMs = new Date(entry.createdAt).getTime();
                const joinMs = leaveMs - entry.time;
                events.push([joinMs, 1]); // player joins
                events.push([leaveMs, -1]); // player leaves
            }
            // Sort by time ascending; ties: joins (+1) before leaves (-1) so that
            // a player arriving at the exact moment another departs still counts.
            events.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
            let current = 0;
            let max = 0;
            for (const [, delta] of events) {
                current += delta;
                if (current > max) max = current;
            }
            result.set(location, max);
        }
        return result;
    },

    async getInstanceJoinHistory() {
        var oneWeekAgo = new Date(Date.now() - 604800000).toJSON();
        var instances = new Map();
        const rows = await adapter.selectWhere(
            'gamelog_join_leave',
            ['created_at', 'location'],
            'user_id = @userId AND created_at > @created_at',
            { userId: dbVars.userId, created_at: oneWeekAgo },
            { order: 'created_at DESC' }
        );
        for (const row of rows) {
            if (!instances.has(row[1])) {
                instances.set(row[1], new Date(row[0]).getTime());
            }
        }
        return instances;
    },

    deleteGameLogInstanceByInstanceId(input) {
        adapter.delete('gamelog_location', { location: input.location });
    },

    deleteGameLogInstance(input) {
        adapter.deleteWhere(
            'gamelog_join_leave',
            '(user_id = @user_id OR display_name = @displayName) AND location = @location AND id IN (' +
                input.events.join(',') +
                ')',
            { user_id: input.id, displayName: input.displayName, location: input.location }
        );
    },

    deleteGameLogEntry(input) {
        switch (input.type) {
            case 'VideoPlay':
                this.deleteGameLogVideoPlay(input);
                break;
            case 'Event':
                this.deleteGameLogEvent(input);
                break;
            case 'External':
                this.deleteGameLogExternal(input);
                break;
            case 'StringLoad':
            case 'ImageLoad':
                this.deleteGameLogResourceLoad(input);
                break;
        }
    },

    deleteGameLogVideoPlay(input) {
        adapter.delete('gamelog_video_play', {
            created_at: input.created_at,
            video_url: input.videoUrl,
            location: input.location
        });
    },

    deleteGameLogEvent(input) {
        adapter.delete('gamelog_event', {
            created_at: input.created_at,
            data: input.data
        });
    },

    deleteGameLogExternal(input) {
        adapter.delete('gamelog_external', {
            created_at: input.created_at,
            message: input.message
        });
    },

    deleteGameLogResourceLoad(input) {
        adapter.delete('gamelog_resource_load', {
            created_at: input.created_at,
            resource_url: input.resourceUrl,
            location: input.location
        });
    },

    /**
     * Get per-friend per-day relationship data for the relationship timeline chart.
     * Returns rows of (userId, displayName, day, totalTimeMs, joinCount) for all friends
     * the current user has co-existed with in any logged instance.
     * @returns {Promise<Array<{userId: string, displayName: string, day: string, totalTime: number, joinCount: number}>>}
     */
    async getRelationshipTimelineData() {
        // Standard SQL: SUBSTR for date truncation (portable ISO string slicing)
        const rows = await adapter.selectGroupBy('gamelog_join_leave', {
            columns: [
                'user_id',
                'display_name',
                'SUBSTR(created_at, 1, 10) AS day'
            ],
            aggregates: [
                { expr: 'SUM(time)', alias: 'total_time' },
                { expr: 'COUNT(DISTINCT location)', alias: 'joinCount' }
            ],
            where: "type='OnPlayerLeft' AND user_id!='' AND user_id!=@currentUserId AND time>0 AND location NOT IN ('','traveling')",
            groupBy: ['user_id', 'day'],
            order: 'day ASC',
            params: { currentUserId: dbVars.userId }
        });
        return rows.map((row) => ({
            userId: row[0],
            displayName: row[1],
            day: row[2],
            totalTime: row[3],
            joinCount: row[4]
        }));
    },

    // ── Sessions view queries (read-only, no existing behavior changed) ──

    /**
     * Get Location segments paginated by cursor (id DESC).
     * @param {number|null} beforeId - cursor: only return rows with id < beforeId. null = latest.
     * @param {number} limit - how many segments to fetch.
     * @returns {Promise<Array<{id: number, created_at: string, location: string, worldId: string, worldName: string, time: number, groupName: string}>>}
     */
    async getSessionsLocationSegments(beforeId, limit) {
        const cursorClause = beforeId != null ? 'id < @beforeId' : null;
        const args = beforeId != null ? { beforeId } : {};
        const rows = await adapter.selectWhere(
            'gamelog_location',
            [
                'id',
                'created_at',
                'location',
                'world_id',
                'world_name',
                'time',
                'group_name'
            ],
            cursorClause,
            args,
            { order: 'id DESC', limit }
        );
        return rows.map((dbRow) => ({
            id: dbRow[0],
            created_at: dbRow[1],
            location: dbRow[2],
            worldId: dbRow[3],
            worldName: dbRow[4],
            time: dbRow[5],
            groupName: dbRow[6]
        }));
    },

    /**
     * Get join/leave and video_play events for a set of location tags within a date range.
     * Excludes the current user's own join/leave.
     * @param {string[]} locationTags - location values to match
     * @param {string} afterDate - ISO date (inclusive lower bound)
     * @param {string} beforeDate - ISO date (inclusive upper bound, with padding)
     * @returns {Promise<Array<object>>}
     */
    async getSessionsEventsForSegments(locationTags, afterDate, beforeDate) {
        if (!locationTags || locationTags.length === 0) return [];

        const dateFilter =
            'created_at >= @afterDate AND created_at <= @beforeDate';
        const dateParams = { afterDate, beforeDate };

        // join/leave events
        const jlRows = await adapter.selectWhereIn(
            'gamelog_join_leave',
            ['type', 'created_at', 'display_name', 'user_id', 'location'],
            'location',
            locationTags,
            'user_id != @selfId AND ' + dateFilter,
            { selfId: dbVars.userId, ...dateParams },
            { order: 'created_at ASC' }
        );

        // video_play events
        const vpRows = await adapter.selectWhereIn(
            'gamelog_video_play',
            [
                'created_at',
                'video_url',
                'video_name',
                'video_id',
                'display_name',
                'user_id',
                'location'
            ],
            'location',
            locationTags,
            dateFilter,
            dateParams,
            { order: 'created_at ASC' }
        );

        const data = [];

        for (const dbRow of jlRows) {
            data.push({
                type: dbRow[0],
                created_at: dbRow[1],
                displayName: dbRow[2],
                userId: dbRow[3],
                location: dbRow[4]
            });
        }
        for (const dbRow of vpRows) {
            data.push({
                type: 'VideoPlay',
                created_at: dbRow[0],
                videoUrl: dbRow[1],
                videoName: dbRow[2],
                videoId: dbRow[3],
                displayName: dbRow[4],
                userId: dbRow[5],
                location: dbRow[6]
            });
        }

        return data;
    },

    /**
     * Get Location segments from a given date onwards (for anchor jumps).
     * Returns segments with created_at >= sinceDate, capped by limit, ordered id DESC.
     * @param {string} sinceDate - ISO date string
     * @param {number} limit - max segments to return
     * @returns {Promise<Array<object>>}
     */
    async getSessionsLocationSegmentsByAnchor(sinceDate, limit) {
        const rows = await adapter.selectWhere(
            'gamelog_location',
            [
                'id',
                'created_at',
                'location',
                'world_id',
                'world_name',
                'time',
                'group_name'
            ],
            'created_at >= @sinceDate',
            { sinceDate, limit },
            { order: 'id DESC', limit }
        );
        return rows.map((dbRow) => ({
            id: dbRow[0],
            created_at: dbRow[1],
            location: dbRow[2],
            worldId: dbRow[3],
            worldName: dbRow[4],
            time: dbRow[5],
            groupName: dbRow[6]
        }));
    }
};

export { gameLog };
