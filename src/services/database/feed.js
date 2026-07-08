import { dbVars } from '../database';

import { adapter } from './adapter/index.js';

const feed = {
    addGPSToDatabase(entry) {
        adapter.insert(`${adapter.userTable(dbVars.userPrefix, 'feed_gps')}`, {
            created_at: entry.created_at,
            user_id: entry.userId,
            display_name: entry.displayName,
            location: entry.location,
            world_name: entry.worldName,
            previous_location: entry.previousLocation,
            time: entry.time,
            group_name: entry.groupName
        }, 'ignore');
    },

    addStatusToDatabase(entry) {
        adapter.insert(`${adapter.userTable(dbVars.userPrefix, 'feed_status')}`, {
            created_at: entry.created_at,
            user_id: entry.userId,
            display_name: entry.displayName,
            status: entry.status,
            status_description: entry.statusDescription,
            previous_status: entry.previousStatus,
            previous_status_description: entry.previousStatusDescription
        }, 'ignore');
    },

    addBioToDatabase(entry) {
        adapter.insert(`${adapter.userTable(dbVars.userPrefix, 'feed_bio')}`, {
            created_at: entry.created_at,
            user_id: entry.userId,
            display_name: entry.displayName,
            bio: entry.bio,
            previous_bio: entry.previousBio
        }, 'ignore');
    },

    async getLastBioChangeForUser(userId) {
        let result = null;
        await adapter.execute(
            (row) => {
                result = {
                    bio: row[0],
                    previousBio: row[1],
                    createdAt: row[2]
                };
            },
            `SELECT bio, previous_bio, created_at FROM ${adapter.userTable(dbVars.userPrefix, 'feed_bio')} WHERE user_id = @userId ORDER BY id DESC LIMIT 1`,
            {
                '@userId': userId
            }
        );
        return result;
    },

    async searchBiosByContent(query, limit = 10) {
        const results = [];
        const searchLike = `%${query}%`;
        await adapter.execute(
            (row) => {
                results.push({
                    userId: row[0],
                    displayName: row[1],
                    bio: row[2]
                });
            },
            `SELECT fb.user_id, fb.display_name, fb.bio FROM ${adapter.userTable(dbVars.userPrefix, 'feed_bio')} fb
             WHERE fb.id IN (SELECT MAX(id) FROM ${adapter.userTable(dbVars.userPrefix, 'feed_bio')} GROUP BY user_id)
             AND fb.bio LIKE @searchLike
             LIMIT @limit`,
            {
                '@searchLike': searchLike,
                '@limit': limit
            }
        );
        return results;
    },

    async getLastStatusChangeForUser(userId) {
        let result = null;
        await adapter.execute(
            (row) => {
                result = {
                    status: row[0],
                    statusDescription: row[1],
                    previousStatus: row[2],
                    previousStatusDescription: row[3],
                    createdAt: row[4]
                };
            },
            `SELECT status, status_description, previous_status, previous_status_description, created_at FROM ${adapter.userTable(dbVars.userPrefix, 'feed_status')} WHERE user_id = @userId ORDER BY id DESC LIMIT 1`,
            {
                '@userId': userId
            }
        );
        return result;
    },

    async getRecentBioChangesForUser(userId, limit = 50) {
        const results = [];
        await adapter.execute(
            (row) => {
                results.push({
                    bio: row[0],
                    previousBio: row[1],
                    createdAt: row[2]
                });
            },
            `SELECT bio, previous_bio, created_at FROM ${adapter.userTable(dbVars.userPrefix, 'feed_bio')} WHERE user_id = @userId ORDER BY id DESC LIMIT @limit`,
            {
                '@userId': userId,
                '@limit': limit
            }
        );
        return results;
    },

    addAvatarToDatabase(entry) {
        adapter.insert(`${adapter.userTable(dbVars.userPrefix, 'feed_avatar')}`, {
            created_at: entry.created_at,
            user_id: entry.userId,
            display_name: entry.displayName,
            owner_id: entry.ownerId,
            avatar_name: entry.avatarName,
            current_avatar_image_url: entry.currentAvatarImageUrl,
            current_avatar_thumbnail_image_url: entry.currentAvatarThumbnailImageUrl,
            previous_current_avatar_image_url: entry.previousCurrentAvatarImageUrl,
            previous_current_avatar_thumbnail_image_url: entry.previousCurrentAvatarThumbnailImageUrl
        }, 'ignore');
    },

    /**
     * Purges avatar feed data from the database.
     * !!!!
     * @param {string|null} cutoffDate - ISO date string. Deletes records older than this date. If null, deletes all records.
     */
    async purgeAvatarFeedData(cutoffDate) {
        if (cutoffDate) {
            await adapter.executeNonQuery(
                `DELETE FROM ${adapter.userTable(dbVars.userPrefix, 'feed_avatar')} WHERE created_at < @cutoff`,
                {
                    '@cutoff': cutoffDate
                }
            );
        } else {
            await adapter.executeNonQuery(
                `DELETE FROM ${adapter.userTable(dbVars.userPrefix, 'feed_avatar')}`
            );
        }
    },

    addOnlineOfflineToDatabase(entry) {
        adapter.insert(`${adapter.userTable(dbVars.userPrefix, 'feed_online_offline')}`, {
            created_at: entry.created_at,
            user_id: entry.userId,
            display_name: entry.displayName,
            type: entry.type,
            location: entry.location,
            world_name: entry.worldName,
            time: entry.time,
            group_name: entry.groupName
        }, 'ignore');
    },

    /**
     * Returns all status change records for a specific user, ordered by time.
     * Used to build the status distribution chart in the user dialog.
     *
     * @param {string} userId
     * @returns {Promise<Array<{createdAt: string, status: string}>>}
     */
    async getStatusHistoryForUser(userId) {
        const results = [];
        await adapter.execute(
            (row) => {
                results.push({
                    createdAt: row[0],
                    status: row[1]
                });
            },
            `SELECT created_at, status FROM ${adapter.userTable(dbVars.userPrefix, 'feed_status')} WHERE user_id = @userId ORDER BY created_at ASC`,
            { '@userId': userId }
        );
        return results;
    },

    /**
     * Returns all online/offline records for a specific user, ordered by time.
     * Used to calculate actual duration spent in each status.
     *
     * @param {string} userId
     * @returns {Promise<Array<{createdAt: string, type: 'Online'|'Offline'}>>}
     */
    async getOnlineOfflineHistoryForUser(userId) {
        const results = [];
        await adapter.execute(
            (row) => {
                results.push({
                    createdAt: row[0],
                    type: row[1]
                });
            },
            `SELECT created_at, type FROM ${adapter.userTable(dbVars.userPrefix, 'feed_online_offline')} WHERE user_id = @userId ORDER BY created_at ASC`,
            { '@userId': userId }
        );
        return results;
    },

    /**
     * Returns the most recent timestamp at which a friend arrived at the given
     * location, as recorded in the GPS feed table.  Works for both real
     * instances and "private" / "private:private" locations.
     *
     * @param {string} userId
     * @param {string} location
     * @returns {Promise<number|null>} Unix timestamp (ms) or null
     */
    async getLastGPSArrivalTimeForUser(userId, location) {
        let arrivalTime = null;
        await adapter.execute(
            (row) => {
                const ts = Date.parse(row[0]);
                if (!isNaN(ts)) {
                    arrivalTime = ts;
                }
            },
            `SELECT created_at FROM ${adapter.userTable(dbVars.userPrefix, 'feed_gps')} WHERE user_id = @userId AND location = @location ORDER BY id DESC LIMIT 1`,
            {
                '@userId': userId,
                '@location': location
            }
        );
        return arrivalTime;
    },

    async searchFeedDatabase(
        search,
        filters,
        vipList,
        maxEntries = dbVars.searchTableSize,
        dateFrom = '',
        dateTo = ''
    ) {
        if (search.startsWith('wrld_') || search.startsWith('grp_')) {
            return this.getFeedByInstanceId(search, filters, vipList);
        }
        let vipQuery = '';
        const vipArgs = {};
        if (vipList.length > 0) {
            const vipPlaceholders = [];
            vipList.forEach((vip, i) => {
                const key = `@vip_${i}`;
                vipArgs[key] = vip;
                vipPlaceholders.push(key);
            });
            vipQuery = `AND user_id IN (${vipPlaceholders.join(', ')})`;
        }
        let dateQuery = '';
        if (dateFrom) {
            dateQuery += 'AND created_at >= @dateFrom ';
        }
        if (dateTo) {
            dateQuery += 'AND created_at <= @dateTo ';
        }
        let gps = true;
        let status = true;
        let bio = true;
        let avatar = true;
        let online = true;
        let offline = true;
        const aviPublic = search.includes('public');
        const aviPrivate = search.includes('private');
        if (filters.length > 0) {
            gps = false;
            status = false;
            bio = false;
            avatar = false;
            online = false;
            offline = false;
            filters.forEach((filter) => {
                switch (filter) {
                    case 'GPS':
                        gps = true;
                        break;
                    case 'Status':
                        status = true;
                        break;
                    case 'Bio':
                        bio = true;
                        break;
                    case 'Avatar':
                        avatar = true;
                        break;
                    case 'Online':
                        online = true;
                        break;
                    case 'Offline':
                        offline = true;
                        break;
                }
            });
        }
        const searchLike = `%${search}%`;
        const selects = [];
        const baseColumns = [
            'id',
            'created_at',
            'user_id',
            'display_name',
            'type',
            'location',
            'world_name',
            'previous_location',
            'time',
            'group_name',
            'status',
            'status_description',
            'previous_status',
            'previous_status_description',
            'bio',
            'previous_bio',
            'owner_id',
            'avatar_name',
            'current_avatar_image_url',
            'current_avatar_thumbnail_image_url',
            'previous_current_avatar_image_url',
            'previous_current_avatar_thumbnail_image_url'
        ].join(', ');
        if (gps) {
            selects.push(
                `SELECT * FROM (SELECT id, created_at, user_id, display_name, 'GPS' AS type, location, world_name, previous_location, time, group_name, NULL AS status, NULL AS status_description, NULL AS previous_status, NULL AS previous_status_description, NULL AS bio, NULL AS previous_bio, NULL AS owner_id, NULL AS avatar_name, NULL AS current_avatar_image_url, NULL AS current_avatar_thumbnail_image_url, NULL AS previous_current_avatar_image_url, NULL AS previous_current_avatar_thumbnail_image_url FROM ${adapter.userTable(dbVars.userPrefix, 'feed_gps')} WHERE (display_name LIKE @searchLike OR world_name LIKE @searchLike OR group_name LIKE @searchLike) ${dateQuery} ${vipQuery} ORDER BY created_at DESC, id DESC LIMIT @perTable)`
            );
        }
        if (status) {
            selects.push(
                `SELECT * FROM (SELECT id, created_at, user_id, display_name, 'Status' AS type, NULL AS location, NULL AS world_name, NULL AS previous_location, NULL AS time, NULL AS group_name, status, status_description, previous_status, previous_status_description, NULL AS bio, NULL AS previous_bio, NULL AS owner_id, NULL AS avatar_name, NULL AS current_avatar_image_url, NULL AS current_avatar_thumbnail_image_url, NULL AS previous_current_avatar_image_url, NULL AS previous_current_avatar_thumbnail_image_url FROM ${adapter.userTable(dbVars.userPrefix, 'feed_status')} WHERE (display_name LIKE @searchLike OR status LIKE @searchLike OR status_description LIKE @searchLike) ${dateQuery} ${vipQuery} ORDER BY created_at DESC, id DESC LIMIT @perTable)`
            );
        }
        if (bio) {
            selects.push(
                `SELECT * FROM (SELECT id, created_at, user_id, display_name, 'Bio' AS type, NULL AS location, NULL AS world_name, NULL AS previous_location, NULL AS time, NULL AS group_name, NULL AS status, NULL AS status_description, NULL AS previous_status, NULL AS previous_status_description, bio, previous_bio, NULL AS owner_id, NULL AS avatar_name, NULL AS current_avatar_image_url, NULL AS current_avatar_thumbnail_image_url, NULL AS previous_current_avatar_image_url, NULL AS previous_current_avatar_thumbnail_image_url FROM ${adapter.userTable(dbVars.userPrefix, 'feed_bio')} WHERE (display_name LIKE @searchLike OR bio LIKE @searchLike) ${dateQuery} ${vipQuery} ORDER BY created_at DESC, id DESC LIMIT @perTable)`
            );
        }
        if (avatar) {
            let avatarQuery = '';
            if (aviPrivate) {
                avatarQuery = 'OR user_id = owner_id';
            } else if (aviPublic) {
                avatarQuery = 'OR user_id != owner_id';
            }
            selects.push(
                `SELECT * FROM (SELECT id, created_at, user_id, display_name, 'Avatar' AS type, NULL AS location, NULL AS world_name, NULL AS previous_location, NULL AS time, NULL AS group_name, NULL AS status, NULL AS status_description, NULL AS previous_status, NULL AS previous_status_description, NULL AS bio, NULL AS previous_bio, owner_id, avatar_name, current_avatar_image_url, current_avatar_thumbnail_image_url, previous_current_avatar_image_url, previous_current_avatar_thumbnail_image_url FROM ${adapter.userTable(dbVars.userPrefix, 'feed_avatar')} WHERE (display_name LIKE @searchLike OR avatar_name LIKE @searchLike) ${avatarQuery} ${dateQuery} ${vipQuery} ORDER BY created_at DESC, id DESC LIMIT @perTable)`
            );
        }
        if (online || offline) {
            let query = '';
            if (!online || !offline) {
                if (online) {
                    query = "AND type = 'Online'";
                } else if (offline) {
                    query = "AND type = 'Offline'";
                }
            }
            selects.push(
                `SELECT * FROM (SELECT id, created_at, user_id, display_name, type, location, world_name, NULL AS previous_location, time, group_name, NULL AS status, NULL AS status_description, NULL AS previous_status, NULL AS previous_status_description, NULL AS bio, NULL AS previous_bio, NULL AS owner_id, NULL AS avatar_name, NULL AS current_avatar_image_url, NULL AS current_avatar_thumbnail_image_url, NULL AS previous_current_avatar_image_url, NULL AS previous_current_avatar_thumbnail_image_url FROM ${adapter.userTable(dbVars.userPrefix, 'feed_online_offline')} WHERE (display_name LIKE @searchLike OR world_name LIKE @searchLike OR group_name LIKE @searchLike) ${query} ${dateQuery} ${vipQuery} ORDER BY created_at DESC, id DESC LIMIT @perTable)`
            );
        }
        if (selects.length === 0) {
            return [];
        }
        const feedDatabase = [];
        const args = {
            '@searchLike': searchLike,
            '@limit': maxEntries,
            '@perTable': maxEntries,
            ...vipArgs
        };
        if (dateFrom) {
            args['@dateFrom'] = dateFrom;
        }
        if (dateTo) {
            args['@dateTo'] = dateTo;
        }
        await adapter.execute(
            (dbRow) => {
                const type = dbRow[4];
                const row = {
                    rowId: dbRow[0],
                    created_at: dbRow[1],
                    userId: dbRow[2],
                    displayName: dbRow[3],
                    type
                };
                switch (type) {
                    case 'GPS':
                        row.location = dbRow[5];
                        row.worldName = dbRow[6];
                        row.previousLocation = dbRow[7];
                        row.time = dbRow[8];
                        row.groupName = dbRow[9];
                        break;
                    case 'Status':
                        row.status = dbRow[10];
                        row.statusDescription = dbRow[11];
                        row.previousStatus = dbRow[12];
                        row.previousStatusDescription = dbRow[13];
                        break;
                    case 'Bio':
                        row.bio = dbRow[14];
                        row.previousBio = dbRow[15];
                        break;
                    case 'Avatar':
                        row.ownerId = dbRow[16];
                        row.avatarName = dbRow[17];
                        row.currentAvatarImageUrl = dbRow[18];
                        row.currentAvatarThumbnailImageUrl = dbRow[19];
                        row.previousCurrentAvatarImageUrl = dbRow[20];
                        row.previousCurrentAvatarThumbnailImageUrl = dbRow[21];
                        break;
                    case 'Online':
                    case 'Offline':
                        row.location = dbRow[5];
                        row.worldName = dbRow[6];
                        row.time = dbRow[8];
                        row.groupName = dbRow[9];
                        break;
                }
                feedDatabase.push(row);
            },
            `SELECT ${baseColumns} FROM (${selects.join(' UNION ALL ')}) ORDER BY created_at DESC, id DESC LIMIT @limit`,
            args
        );
        return feedDatabase;
    },

    async lookupFeedDatabase(
        filters,
        vipList,
        maxEntries = dbVars.maxTableSize,
        prefixOverride
    ) {
        const prevPrefix = prefixOverride ? dbVars.userPrefix : null;
        if (prefixOverride) dbVars.userPrefix = prefixOverride;
        try {
        let vipQuery = '';
        const vipArgs = {};
        if (vipList.length > 0) {
            const vipPlaceholders = [];
            vipList.forEach((vip, i) => {
                const key = `@vip_${i}`;
                vipArgs[key] = vip;
                vipPlaceholders.push(key);
            });
            vipQuery = `AND user_id IN (${vipPlaceholders.join(', ')})`;
        }
        let gps = true;
        let status = true;
        let bio = true;
        let avatar = true;
        let online = true;
        let offline = true;
        if (filters.length > 0) {
            gps = false;
            status = false;
            bio = false;
            avatar = false;
            online = false;
            offline = false;
            filters.forEach((filter) => {
                switch (filter) {
                    case 'GPS':
                        gps = true;
                        break;
                    case 'Status':
                        status = true;
                        break;
                    case 'Bio':
                        bio = true;
                        break;
                    case 'Avatar':
                        avatar = true;
                        break;
                    case 'Online':
                        online = true;
                        break;
                    case 'Offline':
                        offline = true;
                        break;
                }
            });
        }
        const selects = [];
        const baseColumns = [
            'id',
            'created_at',
            'user_id',
            'display_name',
            'type',
            'location',
            'world_name',
            'previous_location',
            'time',
            'group_name',
            'status',
            'status_description',
            'previous_status',
            'previous_status_description',
            'bio',
            'previous_bio',
            'owner_id',
            'avatar_name',
            'current_avatar_image_url',
            'current_avatar_thumbnail_image_url',
            'previous_current_avatar_image_url',
            'previous_current_avatar_thumbnail_image_url'
        ].join(', ');
        if (gps) {
            selects.push(
                `SELECT * FROM (SELECT id, created_at, user_id, display_name, 'GPS' AS type, location, world_name, previous_location, time, group_name, NULL AS status, NULL AS status_description, NULL AS previous_status, NULL AS previous_status_description, NULL AS bio, NULL AS previous_bio, NULL AS owner_id, NULL AS avatar_name, NULL AS current_avatar_image_url, NULL AS current_avatar_thumbnail_image_url, NULL AS previous_current_avatar_image_url, NULL AS previous_current_avatar_thumbnail_image_url FROM ${adapter.userTable(dbVars.userPrefix, 'feed_gps')} WHERE 1=1 ${vipQuery} ORDER BY id DESC LIMIT @perTable)`
            );
        }
        if (status) {
            selects.push(
                `SELECT * FROM (SELECT id, created_at, user_id, display_name, 'Status' AS type, NULL AS location, NULL AS world_name, NULL AS previous_location, NULL AS time, NULL AS group_name, status, status_description, previous_status, previous_status_description, NULL AS bio, NULL AS previous_bio, NULL AS owner_id, NULL AS avatar_name, NULL AS current_avatar_image_url, NULL AS current_avatar_thumbnail_image_url, NULL AS previous_current_avatar_image_url, NULL AS previous_current_avatar_thumbnail_image_url FROM ${adapter.userTable(dbVars.userPrefix, 'feed_status')} WHERE 1=1 ${vipQuery} ORDER BY id DESC LIMIT @perTable)`
            );
        }
        if (bio) {
            selects.push(
                `SELECT * FROM (SELECT id, created_at, user_id, display_name, 'Bio' AS type, NULL AS location, NULL AS world_name, NULL AS previous_location, NULL AS time, NULL AS group_name, NULL AS status, NULL AS status_description, NULL AS previous_status, NULL AS previous_status_description, bio, previous_bio, NULL AS owner_id, NULL AS avatar_name, NULL AS current_avatar_image_url, NULL AS current_avatar_thumbnail_image_url, NULL AS previous_current_avatar_image_url, NULL AS previous_current_avatar_thumbnail_image_url FROM ${adapter.userTable(dbVars.userPrefix, 'feed_bio')} WHERE 1=1 ${vipQuery} ORDER BY id DESC LIMIT @perTable)`
            );
        }
        if (avatar) {
            selects.push(
                `SELECT * FROM (SELECT id, created_at, user_id, display_name, 'Avatar' AS type, NULL AS location, NULL AS world_name, NULL AS previous_location, NULL AS time, NULL AS group_name, NULL AS status, NULL AS status_description, NULL AS previous_status, NULL AS previous_status_description, NULL AS bio, NULL AS previous_bio, owner_id, avatar_name, current_avatar_image_url, current_avatar_thumbnail_image_url, previous_current_avatar_image_url, previous_current_avatar_thumbnail_image_url FROM ${adapter.userTable(dbVars.userPrefix, 'feed_avatar')} WHERE 1=1 ${vipQuery} ORDER BY id DESC LIMIT @perTable)`
            );
        }
        if (online || offline) {
            let query = '';
            if (!online || !offline) {
                if (online) {
                    query = "AND type = 'Online'";
                } else if (offline) {
                    query = "AND type = 'Offline'";
                }
            }
            selects.push(
                `SELECT * FROM (SELECT id, created_at, user_id, display_name, type, location, world_name, NULL AS previous_location, time, group_name, NULL AS status, NULL AS status_description, NULL AS previous_status, NULL AS previous_status_description, NULL AS bio, NULL AS previous_bio, NULL AS owner_id, NULL AS avatar_name, NULL AS current_avatar_image_url, NULL AS current_avatar_thumbnail_image_url, NULL AS previous_current_avatar_image_url, NULL AS previous_current_avatar_thumbnail_image_url FROM ${adapter.userTable(dbVars.userPrefix, 'feed_online_offline')} WHERE 1=1 ${query} ${vipQuery} ORDER BY id DESC LIMIT @perTable)`
            );
        }
        if (selects.length === 0) {
            return [];
        }
        const feedDatabase = [];
        const args = {
            '@limit': maxEntries,
            '@perTable': maxEntries,
            ...vipArgs
        };
        await adapter.execute(
            (dbRow) => {
                const type = dbRow[4];
                const row = {
                    rowId: dbRow[0],
                    created_at: dbRow[1],
                    userId: dbRow[2],
                    displayName: dbRow[3],
                    type
                };
                switch (type) {
                    case 'GPS':
                        row.location = dbRow[5];
                        row.worldName = dbRow[6];
                        row.previousLocation = dbRow[7];
                        row.time = dbRow[8];
                        row.groupName = dbRow[9];
                        break;
                    case 'Status':
                        row.status = dbRow[10];
                        row.statusDescription = dbRow[11];
                        row.previousStatus = dbRow[12];
                        row.previousStatusDescription = dbRow[13];
                        break;
                    case 'Bio':
                        row.bio = dbRow[14];
                        row.previousBio = dbRow[15];
                        break;
                    case 'Avatar':
                        row.ownerId = dbRow[16];
                        row.avatarName = dbRow[17];
                        row.currentAvatarImageUrl = dbRow[18];
                        row.currentAvatarThumbnailImageUrl = dbRow[19];
                        row.previousCurrentAvatarImageUrl = dbRow[20];
                        row.previousCurrentAvatarThumbnailImageUrl = dbRow[21];
                        break;
                    case 'Online':
                    case 'Offline':
                        row.location = dbRow[5];
                        row.worldName = dbRow[6];
                        row.time = dbRow[8];
                        row.groupName = dbRow[9];
                        break;
                }
                feedDatabase.push(row);
            },
            `SELECT ${baseColumns} FROM (${selects.join(' UNION ALL ')}) ORDER BY created_at DESC, id DESC LIMIT @limit`,
            args
        );
        return feedDatabase;
        } finally {
            if (prevPrefix !== null) dbVars.userPrefix = prevPrefix;
        }
    },

    async getFeedByInstanceId(instanceId, filters, vipList) {
        let vipQuery = '';
        const vipArgs = {};
        if (vipList.length > 0) {
            const vipPlaceholders = [];
            vipList.forEach((vip, i) => {
                const key = `@vip_${i}`;
                vipArgs[key] = vip;
                vipPlaceholders.push(key);
            });
            vipQuery = `AND user_id IN (${vipPlaceholders.join(', ')})`;
        }
        let gps = true;
        let online = true;
        let offline = true;
        if (filters.length > 0) {
            gps = false;
            online = false;
            offline = false;
            filters.forEach((filter) => {
                switch (filter) {
                    case 'GPS':
                        gps = true;
                        break;
                    case 'Online':
                        online = true;
                        break;
                    case 'Offline':
                        offline = true;
                        break;
                }
            });
        }
        const selects = [];
        const baseColumns = [
            'id',
            'created_at',
            'user_id',
            'display_name',
            'type',
            'location',
            'world_name',
            'previous_location',
            'time',
            'group_name',
            'status',
            'status_description',
            'previous_status',
            'previous_status_description',
            'bio',
            'previous_bio',
            'owner_id',
            'avatar_name',
            'current_avatar_image_url',
            'current_avatar_thumbnail_image_url',
            'previous_current_avatar_image_url',
            'previous_current_avatar_thumbnail_image_url'
        ].join(', ');
        if (gps) {
            selects.push(
                `SELECT * FROM (SELECT id, created_at, user_id, display_name, 'GPS' AS type, location, world_name, previous_location, time, group_name, NULL AS status, NULL AS status_description, NULL AS previous_status, NULL AS previous_status_description, NULL AS bio, NULL AS previous_bio, NULL AS owner_id, NULL AS avatar_name, NULL AS current_avatar_image_url, NULL AS current_avatar_thumbnail_image_url, NULL AS previous_current_avatar_image_url, NULL AS previous_current_avatar_thumbnail_image_url FROM ${adapter.userTable(dbVars.userPrefix, 'feed_gps')} WHERE location LIKE @instanceLike ${vipQuery} ORDER BY created_at DESC, id DESC LIMIT @perTable)`
            );
        }
        if (online || offline) {
            let query = '';
            if (!online || !offline) {
                if (online) {
                    query = "AND type = 'Online'";
                } else if (offline) {
                    query = "AND type = 'Offline'";
                }
            }
            selects.push(
                `SELECT * FROM (SELECT id, created_at, user_id, display_name, type, location, world_name, NULL AS previous_location, time, group_name, NULL AS status, NULL AS status_description, NULL AS previous_status, NULL AS previous_status_description, NULL AS bio, NULL AS previous_bio, NULL AS owner_id, NULL AS avatar_name, NULL AS current_avatar_image_url, NULL AS current_avatar_thumbnail_image_url, NULL AS previous_current_avatar_image_url, NULL AS previous_current_avatar_thumbnail_image_url FROM ${adapter.userTable(dbVars.userPrefix, 'feed_online_offline')} WHERE location LIKE @instanceLike ${query} ${vipQuery} ORDER BY created_at DESC, id DESC LIMIT @perTable)`
            );
        }
        if (selects.length === 0) {
            return [];
        }
        const feedDatabase = [];
        const args = {
            '@instanceLike': `%${instanceId}%`,
            '@limit': dbVars.searchTableSize,
            '@perTable': dbVars.searchTableSize,
            ...vipArgs
        };
        await adapter.execute(
            (dbRow) => {
                const type = dbRow[4];
                const row = {
                    rowId: dbRow[0],
                    created_at: dbRow[1],
                    userId: dbRow[2],
                    displayName: dbRow[3],
                    type
                };
                switch (type) {
                    case 'GPS':
                        row.location = dbRow[5];
                        row.worldName = dbRow[6];
                        row.previousLocation = dbRow[7];
                        row.time = dbRow[8];
                        row.groupName = dbRow[9];
                        break;
                    case 'Online':
                    case 'Offline':
                        row.location = dbRow[5];
                        row.worldName = dbRow[6];
                        row.time = dbRow[8];
                        row.groupName = dbRow[9];
                        break;
                }
                feedDatabase.push(row);
            },
            `SELECT ${baseColumns} FROM (${selects.join(' UNION ALL ')}) ORDER BY created_at DESC, id DESC LIMIT @limit`,
            args
        );
        return feedDatabase;
    },

    /**
     * @param {number} days - Number of days to look back
     * @param {number} limit - Max number of worlds to return
     * @returns {Promise<Array>} Ranked list of hot worlds
     */
    async getHotWorlds(days = 30, limit = 30) {
        const halfDays = Math.floor(days / 2);
        const results = [];
        const daysAgo = adapter.daysAgoISO(days);
        const halfAgo = adapter.daysAgoISO(halfDays);
        await adapter.execute(
            (dbRow) => {
                results.push({
                    worldId: dbRow[0],
                    worldName: dbRow[1],
                    visitCount: dbRow[2],
                    uniqueFriends: dbRow[3],
                    lastVisited: dbRow[4]
                });
            },
            `SELECT
                ${adapter.sqlExtractWorldId('location')} AS world_id,
                world_name,
                COUNT(*) AS visit_count,
                COUNT(DISTINCT user_id) AS unique_friends,
                MAX(created_at) AS last_visited
            FROM ${adapter.userTable(dbVars.userPrefix, 'feed_gps')}
            WHERE created_at >= @daysAgo
                AND location LIKE 'wrld_%'
                AND ${adapter.sqlHasInstanceId('location')}
                AND world_name IS NOT NULL AND world_name != ''
            GROUP BY world_id
            ORDER BY unique_friends DESC, visit_count DESC
            LIMIT @limit`,
            {
                '@daysAgo': daysAgo,
                '@limit': limit
            }
        );

        const trendMap = new Map();
        await adapter.execute(
            (dbRow) => {
                trendMap.set(dbRow[0], dbRow[1]);
            },
            `SELECT
                ${adapter.sqlExtractWorldId('location')} AS world_id,
                COUNT(DISTINCT user_id) AS unique_friends
            FROM ${adapter.userTable(dbVars.userPrefix, 'feed_gps')}
            WHERE created_at >= @daysAgo
                AND created_at < @halfAgo
                AND location LIKE 'wrld_%'
                AND ${adapter.sqlHasInstanceId('location')}
                AND world_name IS NOT NULL AND world_name != ''
            GROUP BY world_id`,
            {
                '@daysAgo': daysAgo,
                '@halfAgo': halfAgo
            }
        );

        const recentMap = new Map();
        await adapter.execute(
            (dbRow) => {
                recentMap.set(dbRow[0], dbRow[1]);
            },
            `SELECT
                ${adapter.sqlExtractWorldId('location')} AS world_id,
                COUNT(DISTINCT user_id) AS unique_friends
            FROM ${adapter.userTable(dbVars.userPrefix, 'feed_gps')}
            WHERE created_at >= @halfAgo
                AND location LIKE 'wrld_%'
                AND ${adapter.sqlHasInstanceId('location')}
                AND world_name IS NOT NULL AND world_name != ''
            GROUP BY world_id`,
            {
                '@halfAgo': halfAgo
            }
        );

        for (const world of results) {
            const oldFriends = trendMap.get(world.worldId) || 0;
            const newFriends = recentMap.get(world.worldId) || 0;
            if (newFriends > oldFriends) {
                world.trend = 'rising';
            } else if (newFriends < oldFriends) {
                world.trend = 'cooling';
            } else {
                world.trend = 'stable';
            }
        }

        return results;
    },

    /**
     * @param {string} worldId - The world ID (e.g. wrld_xxx)
     * @param {number} days - Number of days to look back
     * @returns {Promise<Array>} List of friends who visited
     */
    async getHotWorldFriendDetail(worldId, days = 30) {
        const results = [];
        const daysAgo = adapter.daysAgoISO(days);
        await adapter.execute(
            (dbRow) => {
                results.push({
                    userId: dbRow[0],
                    displayName: dbRow[1],
                    visitCount: dbRow[2],
                    lastVisit: dbRow[3]
                });
            },
            `SELECT
                user_id,
                display_name,
                COUNT(*) AS visit_count,
                MAX(created_at) AS last_visit
            FROM ${adapter.userTable(dbVars.userPrefix, 'feed_gps')}
            WHERE ${adapter.sqlExtractWorldId('location')} = @worldId
                AND created_at >= @daysAgo
            GROUP BY user_id
            ORDER BY visit_count DESC`,
            {
                '@worldId': worldId,
                '@daysAgo': daysAgo
            }
        );
        return results;
    }
};

export { feed };
