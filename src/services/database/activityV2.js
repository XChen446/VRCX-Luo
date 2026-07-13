import { dbVars } from '../database';

import { adapter } from './adapter/index.js';

const ACTIVITY_VIEW_KIND = {
    ACTIVITY: 'activity',
    OVERLAP: 'overlap'
};

function syncStateTable() {
    return `${adapter.userTable(dbVars.userPrefix, 'activity_sync_state_v2')}`;
}

function sessionsTable() {
    return `${adapter.userTable(dbVars.userPrefix, 'activity_sessions_v2')}`;
}

function bucketCacheTable() {
    return `${adapter.userTable(dbVars.userPrefix, 'activity_bucket_cache_v2')}`;
}

function parseJson(value, fallback) {
    if (!value) {
        return fallback;
    }
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

const activityV2 = {
    ACTIVITY_VIEW_KIND,

    async getActivitySourceSliceV2({ userId, isSelf, fromDays, toDays = 0 }) {
        const fromDateIso = new Date(
            Date.now() - fromDays * 86400000
        ).toISOString();
        const toDateIso =
            toDays > 0
                ? new Date(Date.now() - toDays * 86400000).toISOString()
                : '';
        return isSelf
            ? this.getCurrentUserLocationSliceV2(fromDateIso, toDateIso)
            : this.getFriendPresenceSliceV2(userId, fromDateIso, toDateIso);
    },

    async getActivitySourceAfterV2({
        userId,
        isSelf,
        afterCreatedAt,
        inclusive = false
    }) {
        return isSelf
            ? this.getCurrentUserLocationAfterV2(afterCreatedAt, inclusive)
            : this.getFriendPresenceAfterV2(userId, afterCreatedAt);
    },

    async getFriendPresenceSliceV2(userId, fromDateIso, toDateIso = '') {
        const table = adapter.userTable(
            dbVars.userPrefix,
            'feed_online_offline'
        );
        const cols = ['created_at', 'type'];
        const typeClause = "(type = 'Online' OR type = 'Offline')";

        const before = await adapter.selectWhere(
            table,
            cols,
            `user_id = @userId AND ${typeClause} AND created_at < @from`,
            { '@userId': userId, '@from': fromDateIso },
            { order: 'created_at DESC', limit: 1 }
        );
        const during = await adapter.selectWhere(
            table,
            cols,
            `user_id = @userId AND ${typeClause} AND created_at >= @from${toDateIso ? ' AND created_at < @to' : ''}`,
            { '@userId': userId, '@from': fromDateIso, '@to': toDateIso },
            { order: 'created_at ASC' }
        );
        const after = toDateIso
            ? await adapter.selectWhere(
                  table,
                  cols,
                  `user_id = @userId AND ${typeClause} AND created_at >= @to`,
                  { '@userId': userId, '@to': toDateIso },
                  { order: 'created_at ASC', limit: 1 }
              )
            : [];

        return [...before, ...during, ...after].map((r) => ({
            created_at: r[0],
            type: r[1]
        }));
    },

    async getFriendPresenceAfterV2(userId, afterCreatedAt) {
        const rows = await adapter.selectWhere(
            adapter.userTable(dbVars.userPrefix, 'feed_online_offline'),
            ['created_at', 'type'],
            "user_id = @userId AND (type = 'Online' OR type = 'Offline') AND created_at > @afterCreatedAt",
            { '@userId': userId, '@afterCreatedAt': afterCreatedAt },
            { order: 'created_at' }
        );
        return rows.map((dbRow) => ({ created_at: dbRow[0], type: dbRow[1] }));
    },

    async getCurrentUserLocationSliceV2(fromDateIso, toDateIso = '') {
        const cols = ['created_at', 'time'];

        const before = await adapter.selectWhere(
            'gamelog_location',
            cols,
            'created_at < @from',
            { '@from': fromDateIso },
            { order: 'created_at DESC', limit: 1 }
        );
        const during = await adapter.selectWhere(
            'gamelog_location',
            cols,
            `created_at >= @from${toDateIso ? ' AND created_at < @to' : ''}`,
            { '@from': fromDateIso, '@to': toDateIso },
            { order: 'created_at ASC' }
        );
        const after = toDateIso
            ? await adapter.selectWhere(
                  'gamelog_location',
                  cols,
                  'created_at >= @to',
                  { '@to': toDateIso },
                  { order: 'created_at ASC', limit: 1 }
              )
            : [];

        return [...before, ...during, ...after].map((r) => ({
            created_at: r[0],
            time: r[1] || 0
        }));
    },

    async getCurrentUserLocationAfterV2(afterCreatedAt, inclusive = false) {
        const operator = inclusive ? '>=' : '>';
        const rows = await adapter.selectWhere(
            'gamelog_location',
            ['created_at', 'time'],
            `created_at ${operator} @afterCreatedAt`,
            { '@afterCreatedAt': afterCreatedAt },
            { order: 'created_at' }
        );
        return rows.map((dbRow) => ({
            created_at: dbRow[0],
            time: dbRow[1] || 0
        }));
    },

    async getActivitySyncStateV2(userId) {
        const dbRow = await adapter.selectOne(
            syncStateTable(),
            [
                'user_id',
                'updated_at',
                'is_self',
                'source_last_created_at',
                'pending_session_start_at',
                'cached_range_days'
            ],
            { user_id: userId }
        );
        if (!dbRow) return null;
        return {
            userId: dbRow[0],
            updatedAt: dbRow[1] || '',
            isSelf: Boolean(dbRow[2]),
            sourceLastCreatedAt: dbRow[3] || '',
            pendingSessionStartAt:
                typeof dbRow[4] === 'number' ? dbRow[4] : null,
            cachedRangeDays: dbRow[5] || 0
        };
    },

    async upsertActivitySyncStateV2(entry) {
        await adapter.insert(
            syncStateTable(),
            {
                user_id: entry.userId,
                updated_at: entry.updatedAt || '',
                is_self: entry.isSelf ? 1 : 0,
                source_last_created_at: entry.sourceLastCreatedAt || '',
                pending_session_start_at: entry.pendingSessionStartAt,
                cached_range_days: entry.cachedRangeDays || 0
            },
            'replace'
        );
    },

    async getActivitySessionsV2(userId) {
        const rows = await adapter.selectWhere(
            sessionsTable(),
            ['start_at', 'end_at', 'is_open_tail', 'source_revision'],
            'user_id = @userId',
            { '@userId': userId },
            { order: 'start_at' }
        );
        return rows.map((dbRow) => ({
            start: dbRow[0],
            end: dbRow[1],
            isOpenTail: Boolean(dbRow[2]),
            sourceRevision: dbRow[3] || ''
        }));
    },

    async replaceActivitySessionsV2(userId, sessions = []) {
        await adapter.begin();
        try {
            await adapter.delete(sessionsTable(), { user_id: userId });
            await insertSessions(userId, sessions);
            await adapter.commit();
        } catch (error) {
            await adapter.rollback();
            throw error;
        }
    },

    async appendActivitySessionsV2({
        userId,
        sessions = [],
        replaceFromStartAt = null
    }) {
        await adapter.begin();
        try {
            if (replaceFromStartAt !== null) {
                await adapter.deleteWhere(
                    sessionsTable(),
                    'user_id = @userId AND start_at >= @replaceFromStartAt',
                    {
                        '@userId': userId,
                        '@replaceFromStartAt': replaceFromStartAt
                    }
                );
            }
            await insertSessions(userId, sessions);
            await adapter.commit();
        } catch (error) {
            await adapter.rollback();
            throw error;
        }
    },

    async getActivityBucketCacheV2({
        ownerUserId,
        targetUserId = '',
        rangeDays,
        viewKind,
        excludeKey = ''
    }) {
        const dbRow = await adapter.selectOne(
            bucketCacheTable(),
            [
                'user_id',
                'target_user_id',
                'range_days',
                'view_kind',
                'exclude_key',
                'bucket_version',
                'built_from_cursor',
                'raw_buckets_json',
                'normalized_buckets_json',
                'summary_json',
                'built_at'
            ],
            {
                user_id: ownerUserId,
                target_user_id: targetUserId,
                range_days: rangeDays,
                view_kind: viewKind,
                exclude_key: excludeKey
            }
        );
        if (!dbRow) return null;
        return {
            ownerUserId: dbRow[0],
            targetUserId: dbRow[1],
            rangeDays: dbRow[2],
            viewKind: dbRow[3],
            excludeKey: dbRow[4] || '',
            bucketVersion: dbRow[5] || 1,
            builtFromCursor: dbRow[6] || '',
            rawBuckets: parseJson(dbRow[7], []),
            normalizedBuckets: parseJson(dbRow[8], []),
            summary: parseJson(dbRow[9], {}),
            builtAt: dbRow[10] || ''
        };
    },

    async upsertActivityBucketCacheV2(entry) {
        await adapter.insert(
            bucketCacheTable(),
            {
                user_id: entry.ownerUserId,
                target_user_id: entry.targetUserId || '',
                range_days: entry.rangeDays,
                view_kind: entry.viewKind,
                exclude_key: entry.excludeKey || '',
                bucket_version: entry.bucketVersion || 1,
                built_from_cursor: entry.builtFromCursor || '',
                raw_buckets_json: JSON.stringify(entry.rawBuckets || []),
                normalized_buckets_json: JSON.stringify(
                    entry.normalizedBuckets || []
                ),
                summary_json: JSON.stringify(entry.summary || {}),
                built_at: entry.builtAt || ''
            },
            'replace'
        );
    }
};

async function insertSessions(userId, sessions = []) {
    if (sessions.length === 0) {
        return;
    }

    const chunkSize = 250;
    for (
        let chunkStart = 0;
        chunkStart < sessions.length;
        chunkStart += chunkSize
    ) {
        const chunk = sessions.slice(chunkStart, chunkStart + chunkSize);
        const rows = chunk.map((session) => ({
            user_id: userId,
            start_at: session.start,
            end_at: session.end,
            is_open_tail: session.isOpenTail ? 1 : 0,
            source_revision: session.sourceRevision || ''
        }));
        await adapter.bulkInsert(sessionsTable(), rows, 'replace');
    }
}

export { activityV2 };
