import { dbVars } from '../database';

import { adapter } from './adapter/index.js';

const notifications = {
    async getNotifications() {
        const rows = await adapter.selectWhere(
            adapter.userTable(dbVars.userPrefix, 'notifications'),
            '*',
            null,
            null,
            { order: 'created_at DESC', limit: dbVars.maxTableSize }
        );
        return rows
            .map((dbRow) => ({
                id: dbRow[0],
                created_at: dbRow[1],
                type: dbRow[2],
                senderUserId: dbRow[3],
                senderUsername: dbRow[4],
                receiverUserId: dbRow[5],
                message: dbRow[6],
                details: {
                    worldId: dbRow[7],
                    worldName: dbRow[8],
                    imageUrl: dbRow[9],
                    inviteMessage: dbRow[10],
                    requestMessage: dbRow[11],
                    responseMessage: dbRow[12]
                },
                $isExpired: dbRow[13] === 1
            }))
            .reverse();
    },

    async lookupNotificationDatabase(
        search,
        filters,
        vipList,
        maxEntries = dbVars.maxTableSize
    ) {
        const searchLike = `%${search}%`;

        let vipQuery = '';
        const vipArgs = {};
        if (vipList.length > 0) {
            const placeholders = vipList.map((id, i) => {
                vipArgs[`vip_${i}`] = id;
                return `@vip_${i}`;
            });
            vipQuery = `AND sender_user_id IN (${placeholders.join(', ')})`;
        }

        let filterQuery = '';
        const filterArgs = {};
        if (filters.length > 0) {
            const placeholders = filters.map((type, i) => {
                filterArgs[`filter_${i}`] = type;
                return `@filter_${i}`;
            });
            filterQuery = `AND type IN (${placeholders.join(', ')})`;
        }

        const rows = await adapter.selectWhere(
            adapter.userTable(dbVars.userPrefix, 'notifications'),
            '*',
            `(sender_username LIKE @searchLike OR message LIKE @searchLike OR world_name LIKE @searchLike) ${vipQuery} ${filterQuery}`,
            { searchLike, ...vipArgs, ...filterArgs },
            { order: 'created_at DESC', limit: maxEntries }
        );
        return rows
            .map((dbRow) => ({
                id: dbRow[0],
                created_at: dbRow[1],
                type: dbRow[2],
                senderUserId: dbRow[3],
                senderUsername: dbRow[4],
                receiverUserId: dbRow[5],
                message: dbRow[6],
                details: {
                    worldId: dbRow[7],
                    worldName: dbRow[8],
                    imageUrl: dbRow[9],
                    inviteMessage: dbRow[10],
                    requestMessage: dbRow[11],
                    responseMessage: dbRow[12]
                },
                $isExpired: dbRow[13] === 1
            }))
            .reverse();
    },

    addNotificationToDatabase(row) {
        var entry = {
            id: '',
            created_at: '',
            type: '',
            senderUserId: '',
            senderUsername: '',
            receiverUserId: '',
            message: '',
            ...row,
            details: {
                worldId: '',
                worldName: '',
                imageUrl: '',
                inviteMessage: '',
                requestMessage: '',
                responseMessage: '',
                ...row.details
            }
        };
        if (entry.imageUrl && !entry.details.imageUrl) {
            entry.details.imageUrl = entry.imageUrl;
        }
        var expired = 0;
        if (row.$isExpired) {
            expired = 1;
        }
        if (!entry.created_at || !entry.type || !entry.id) {
            console.error('Notification is missing required field', entry);
            throw new Error('Notification is missing required field');
        }
        adapter.insert(
            `${adapter.userTable(dbVars.userPrefix, 'notifications')}`,
            {
                id: entry.id,
                created_at: entry.created_at,
                type: entry.type,
                sender_user_id: entry.senderUserId,
                sender_username: entry.senderUsername,
                receiver_user_id: entry.receiverUserId,
                message: entry.message,
                world_id: entry.details.worldId,
                world_name: entry.details.worldName,
                image_url: entry.details.imageUrl,
                invite_message: entry.details.inviteMessage,
                request_message: entry.details.requestMessage,
                response_message: entry.details.responseMessage,
                expired: expired
            },
            'ignore'
        );
    },

    deleteNotification(rowId) {
        adapter.delete(
            `${adapter.userTable(dbVars.userPrefix, 'notifications')}`,
            { id: rowId }
        );
    },

    updateNotificationExpired(entry) {
        var expired = 0;
        if (entry.$isExpired) {
            expired = 1;
        }
        adapter.update(
            `${adapter.userTable(dbVars.userPrefix, 'notifications')}`,
            { expired: expired },
            { id: entry.id }
        );
    },

    // notifications v2

    async getNotificationsV2() {
        const rows = await adapter.selectWhere(
            adapter.userTable(dbVars.userPrefix, 'notifications_v2'),
            '*',
            null,
            null,
            { order: 'created_at DESC', limit: dbVars.maxTableSize }
        );
        return rows
            .map((dbRow) => {
                const row = {
                    id: dbRow[0],
                    createdAt: dbRow[1],
                    updatedAt: dbRow[2],
                    expiresAt: dbRow[3],
                    type: dbRow[4],
                    link: dbRow[5],
                    linkText: dbRow[6],
                    message: dbRow[7],
                    title: dbRow[8],
                    imageUrl: dbRow[9],
                    seen: dbRow[10] === 1,
                    senderUserId: dbRow[11],
                    senderUsername: dbRow[12],
                    data: JSON.parse(dbRow[13] || '{}'),
                    responses: JSON.parse(dbRow[14] || '[]'),
                    details: JSON.parse(dbRow[15] || '{}')
                };
                row.created_at = row.createdAt;
                row.version = 2;
                return row;
            })
            .reverse();
    },

    addNotificationV2ToDatabase(entry) {
        adapter.insert(
            `${adapter.userTable(dbVars.userPrefix, 'notifications_v2')}`,
            {
                id: entry.id,
                created_at: entry.createdAt,
                updated_at: entry.updatedAt,
                expires_at: entry.expiresAt,
                type: entry.type,
                link: entry.link,
                link_text: entry.linkText,
                message: entry.message,
                title: entry.title,
                image_url: entry.imageUrl,
                seen: entry.seen ? 1 : 0,
                sender_user_id: entry.senderUserId,
                sender_username: entry.senderUsername,
                data: JSON.stringify(entry.data || {}),
                responses: JSON.stringify(entry.responses || []),
                details: JSON.stringify(entry.details || {})
            },
            'replace'
        );
    },

    expireNotificationV2(id) {
        adapter.update(
            `${adapter.userTable(dbVars.userPrefix, 'notifications_v2')}`,
            {
                expires_at: new Date().toJSON(),
                seen: 1
            },
            { id: id }
        );
    },

    seenNotificationV2(id) {
        adapter.update(
            `${adapter.userTable(dbVars.userPrefix, 'notifications_v2')}`,
            { seen: 1 },
            { id: id }
        );
    },

    deleteNotificationV2(id) {
        adapter.delete(
            `${adapter.userTable(dbVars.userPrefix, 'notifications_v2')}`,
            { id: id }
        );
    }
};

export { notifications };
