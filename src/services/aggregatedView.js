/**
 * aggregatedView – utilities for building the merged cross-account view.
 *
 * Provides:
 *  - mergeFriends(sessions, primaryFriends)  →  Map of merged friend ctx objects
 *  - lookupAggregatedFeed(prefixes, filters, vipList, limit)  →  merged feed rows
 */

import { accountHub } from './accountHub.js';
import { database } from './database/index.js';

// ── Merged friends list ────────────────────────────────────────────────────────

/**
 * Build a merged Map of friend context objects from all active sessions.
 * For each userId, we pick the "best" location (most specific / most recent).
 * The resulting ctx objects include a `$accountIds` array indicating which
 * accounts consider this person a friend.
 *
 * @param {import('../stores/friend').SortedFriend[]} primarySortedFriends
 *   The `sortedFriends` array from the primary account's FriendStore.
 * @returns {Map<string, object>}
 */
export function mergeFriends(primarySortedFriends) {
    const merged = new Map();

    // 1. Start with the primary account's friends
    for (const ctx of primarySortedFriends) {
        if (!ctx || !ctx.id) continue;
        const entry = {
            ...ctx,
            $accountIds: [accountHub.primaryId],
            $accountColor: accountHub.getAccountColor(accountHub.primaryId)
        };
        merged.set(ctx.id, entry);
    }

    // 2. Overlay secondary accounts
    for (const session of accountHub.secondarySessions) {
        for (const [userId, ctx] of session.friendsCache) {
            if (merged.has(userId)) {
                // Already in map – mark as shared friend, pick online state
                const existing = merged.get(userId);
                if (!existing.$accountIds.includes(session.userId)) {
                    existing.$accountIds.push(session.userId);
                }
                // Prefer the 'online' state
                if (ctx.state === 'online' && existing.state !== 'online') {
                    existing.state = 'online';
                    if (ctx.ref?.location && ctx.ref.location !== 'offline') {
                        existing.ref = existing.ref || ctx.ref;
                    }
                }
            } else {
                merged.set(userId, {
                    ...ctx,
                    $accountIds: [session.userId],
                    $accountColor: accountHub.getAccountColor(session.userId)
                });
            }
        }
    }

    return merged;
}

// ── Aggregated feed ────────────────────────────────────────────────────────────

function parseDbRow(dbRow, prefix) {
    const type = dbRow[4];
    const row = {
        _prefix: prefix,
        rowId: dbRow[0],
        created_at: dbRow[1],
        userId: dbRow[2],
        displayName: dbRow[3],
        type
    };

    row.$accountId = null;
    row.$accountColor = null;
    row.$accountLabel = null;
    const session = accountHub.allSessions.find(s => s.dbPrefix === prefix);
    if (session) {
        row.$accountId = session.userId;
        row.$accountColor = accountHub.getAccountColor(session.userId);
        row.$accountLabel = session.label || session.userInfo?.displayName || session.userId;
    } else if (prefix === accountHub.primaryPrefix) {
        row.$accountId = accountHub.primaryId;
        row.$accountColor = accountHub.getAccountColor(accountHub.primaryId);
        row.$accountLabel = 'Primary';
    }

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
    return row;
}

/**
 * Query the merged feed from all active account prefixes.
 * Uses database.lookupFeedDatabase per prefix — no duplicated UNION ALL SQL.
 * @param {string[]} prefixes  DB table prefixes for all accounts
 * @param {string[]} filters   Feed type filters ([], ['GPS'], ['Online','Offline'], ...)
 * @param {number}   [limit=500]
 * @returns {Promise<object[]>}
 */
export async function lookupAggregatedFeed(prefixes, filters = [], limit = 500) {
    if (!prefixes || prefixes.length === 0) return [];

    const allRows = [];
    for (const prefix of prefixes) {
        const rows = await database.lookupFeedDatabase(filters, [], limit, prefix);
        for (const row of rows) {
            allRows.push(parseDbRow(row, prefix));
        }
    }

    allRows.sort((a, b) => {
        const c = b.created_at.localeCompare(a.created_at);
        if (c !== 0) return c;
        return b.rowId - a.rowId;
    });
    return allRows.slice(0, limit);
}
