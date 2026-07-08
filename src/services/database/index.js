import { activityV2 } from './activityV2.js';
import { avatarFavorites } from './avatarFavorites.js';
import { avatarTags } from './avatarTags.js';
import { feed } from './feed.js';
import { friendFavorites } from './friendFavorites.js';
import { friendLogCurrent } from './friendLogCurrent.js';
import { friendLogHistory } from './friendLogHistory.js';
import { gameLog } from './gameLog.js';
import { manualRelations } from './manualRelations.js';
import { memos } from './memos.js';
import { moderation } from './moderation.js';
import { mutualGraph } from './mutualGraph.js';
import { notifications } from './notifications.js';
import { tableAlter } from './tableAlter.js';
import { tableFixes } from './tableFixes.js';
import { tableSize } from './tableSize.js';
import { trackedNonFriends } from './trackedNonFriends.js';
import { worldFavorites } from './worldFavorites.js';
import { runMigrations } from './migrations/index.js';

import { adapter } from './adapter/index.js';

const dbVars = {
    userId: '',
    userPrefix: '',
    maxTableSize: 500,
    searchTableSize: 5000
};

const database = {
    ...feed,
    ...activityV2,
    ...gameLog,
    ...notifications,
    ...moderation,
    ...friendLogHistory,
    ...friendLogCurrent,
    ...memos,
    ...avatarFavorites,
    ...avatarTags,
    ...friendFavorites,
    ...worldFavorites,
    ...tableAlter,
    ...tableFixes,
    ...tableSize,
    ...mutualGraph,
    ...trackedNonFriends,
    ...manualRelations,

    setMaxTableSize(limit) {
        dbVars.maxTableSize = limit;
    },

    setSearchTableSize(limit) {
        dbVars.searchTableSize = limit;
    },

    async initUserTables(userId) {
        dbVars.userId = userId;
        dbVars.userPrefix = userId.replaceAll('-', '').replaceAll('_', '');
        // Fix escape, add underscore if prefix starts with a number
        if (dbVars.userPrefix.match(/^\d/)) {
            dbVars.userPrefix = '_' + dbVars.userPrefix;
        }
        await adapter.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${adapter.userTable(dbVars.userPrefix, 'feed_gps')} (id INTEGER PRIMARY KEY, created_at TEXT, user_id TEXT, display_name TEXT, location TEXT, world_name TEXT, previous_location TEXT, time INTEGER, group_name TEXT)`
        );
        await adapter.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${adapter.userTable(dbVars.userPrefix, 'feed_status')} (id INTEGER PRIMARY KEY, created_at TEXT, user_id TEXT, display_name TEXT, status TEXT, status_description TEXT, previous_status TEXT, previous_status_description TEXT)`
        );
        await adapter.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${adapter.userTable(dbVars.userPrefix, 'feed_bio')} (id INTEGER PRIMARY KEY, created_at TEXT, user_id TEXT, display_name TEXT, bio TEXT, previous_bio TEXT)`
        );
        await adapter.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${adapter.userTable(dbVars.userPrefix, 'feed_avatar')} (id INTEGER PRIMARY KEY, created_at TEXT, user_id TEXT, display_name TEXT, owner_id TEXT, avatar_name TEXT, current_avatar_image_url TEXT, current_avatar_thumbnail_image_url TEXT, previous_current_avatar_image_url TEXT, previous_current_avatar_thumbnail_image_url TEXT)`
        );
        await adapter.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${adapter.userTable(dbVars.userPrefix, 'feed_online_offline')} (id INTEGER PRIMARY KEY, created_at TEXT, user_id TEXT, display_name TEXT, type TEXT, location TEXT, world_name TEXT, time INTEGER, group_name TEXT)`
        );
        await adapter.executeNonQuery(
            `CREATE INDEX IF NOT EXISTS ${adapter.userTable(dbVars.userPrefix, 'feed_online_offline')}_user_created_idx ON ${adapter.userTable(dbVars.userPrefix, 'feed_online_offline')} (user_id, created_at)`
        );
        await adapter.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${adapter.userTable(dbVars.userPrefix, 'activity_sync_state_v2')} (
                user_id TEXT PRIMARY KEY,
                updated_at TEXT NOT NULL DEFAULT '',
                is_self INTEGER NOT NULL DEFAULT 0,
                source_last_created_at TEXT NOT NULL DEFAULT '',
                pending_session_start_at INTEGER,
                cached_range_days INTEGER NOT NULL DEFAULT 0
            )`
        );
        await adapter.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${adapter.userTable(dbVars.userPrefix, 'activity_sessions_v2')} (
                session_id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                start_at INTEGER NOT NULL,
                end_at INTEGER NOT NULL,
                is_open_tail INTEGER NOT NULL DEFAULT 0,
                source_revision TEXT NOT NULL DEFAULT ''
            )`
        );
        await adapter.executeNonQuery(
            `CREATE INDEX IF NOT EXISTS ${adapter.userTable(dbVars.userPrefix, 'activity_sessions_v2')}_user_start_idx ON ${adapter.userTable(dbVars.userPrefix, 'activity_sessions_v2')} (user_id, start_at)`
        );
        await adapter.executeNonQuery(
            `CREATE INDEX IF NOT EXISTS ${adapter.userTable(dbVars.userPrefix, 'activity_sessions_v2')}_user_end_idx ON ${adapter.userTable(dbVars.userPrefix, 'activity_sessions_v2')} (user_id, end_at)`
        );
        await adapter.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${adapter.userTable(dbVars.userPrefix, 'activity_bucket_cache_v2')} (
                user_id TEXT NOT NULL,
                target_user_id TEXT NOT NULL DEFAULT '',
                range_days INTEGER NOT NULL,
                view_kind TEXT NOT NULL,
                exclude_key TEXT NOT NULL DEFAULT '',
                bucket_version INTEGER NOT NULL DEFAULT 1,
                raw_buckets_json TEXT NOT NULL DEFAULT '[]',
                normalized_buckets_json TEXT NOT NULL DEFAULT '[]',
                built_from_cursor TEXT NOT NULL DEFAULT '',
                summary_json TEXT NOT NULL DEFAULT '{}',
                built_at TEXT NOT NULL DEFAULT '',
                PRIMARY KEY (user_id, target_user_id, range_days, view_kind, exclude_key)
            )`
        );
        await adapter.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${adapter.userTable(dbVars.userPrefix, 'friend_log_current')} (user_id TEXT PRIMARY KEY, display_name TEXT, trust_level TEXT, friend_number INTEGER)`
        );
        await adapter.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${adapter.userTable(dbVars.userPrefix, 'friend_log_history')} (id INTEGER PRIMARY KEY, created_at TEXT, type TEXT, user_id TEXT, display_name TEXT, previous_display_name TEXT, trust_level TEXT, previous_trust_level TEXT, friend_number INTEGER)`
        );
        await adapter.executeNonQuery(
            `CREATE INDEX IF NOT EXISTS ${adapter.userTable(dbVars.userPrefix, 'friend_log_history')}_user_id_idx ON ${adapter.userTable(dbVars.userPrefix, 'friend_log_history')} (user_id)`
        );
        await adapter.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${adapter.userTable(dbVars.userPrefix, 'notifications')} (id TEXT PRIMARY KEY, created_at TEXT, type TEXT, sender_user_id TEXT, sender_username TEXT, receiver_user_id TEXT, message TEXT, world_id TEXT, world_name TEXT, image_url TEXT, invite_message TEXT, request_message TEXT, response_message TEXT, expired INTEGER)`
        );
        await adapter.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${adapter.userTable(dbVars.userPrefix, 'notifications_v2')} (id TEXT PRIMARY KEY, created_at TEXT, updated_at TEXT, expires_at TEXT, type TEXT, link TEXT, link_text TEXT, message TEXT, title TEXT, image_url TEXT, seen INTEGER, sender_user_id TEXT, sender_username TEXT, data TEXT, responses TEXT, details TEXT)`
        );
        await adapter.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${adapter.userTable(dbVars.userPrefix, 'moderation')} (user_id TEXT PRIMARY KEY, updated_at TEXT, display_name TEXT, block INTEGER, mute INTEGER)`
        );
        await adapter.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${adapter.userTable(dbVars.userPrefix, 'avatar_history')} (avatar_id TEXT PRIMARY KEY, created_at TEXT, time INTEGER)`
        );
        await adapter.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${adapter.userTable(dbVars.userPrefix, 'notes')} (user_id TEXT PRIMARY KEY, display_name TEXT, note TEXT, created_at TEXT)`
        );
        await adapter.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${adapter.userTable(dbVars.userPrefix, 'mutual_graph_friends')} (friend_id TEXT PRIMARY KEY)`
        );
        await adapter.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${adapter.userTable(dbVars.userPrefix, 'mutual_graph_links')} (friend_id TEXT NOT NULL, mutual_id TEXT NOT NULL, PRIMARY KEY(friend_id, mutual_id))`
        );
        await adapter.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${adapter.userTable(dbVars.userPrefix, 'mutual_graph_links_old')} (friend_id TEXT NOT NULL, mutual_id TEXT NOT NULL, date TEXT NOT NULL, PRIMARY KEY(friend_id, mutual_id))`
        );
        await adapter.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${adapter.userTable(dbVars.userPrefix, 'mutual_graph_friends_old')} (friend_id TEXT PRIMARY KEY, last_updated TEXT NOT NULL)`
        );
        await adapter.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${adapter.userTable(dbVars.userPrefix, 'mutual_graph_meta')} (friend_id TEXT PRIMARY KEY, last_fetched_at TEXT, opted_out INTEGER DEFAULT 0)`
        );
        await adapter.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${adapter.userTable(dbVars.userPrefix, 'tracked_nonfriends')} (user_id TEXT PRIMARY KEY, display_name TEXT, added_at TEXT)`
        );
        await adapter.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${adapter.userTable(dbVars.userPrefix, 'manual_relations_MANUEL')} (user_id_a TEXT NOT NULL, user_id_b TEXT NOT NULL, relation_type TEXT NOT NULL DEFAULT 'friend', added_at TEXT, PRIMARY KEY(user_id_a, user_id_b))`
        );
    },

    async initTables() {
        await adapter.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS gamelog_location (id INTEGER PRIMARY KEY, created_at TEXT, location TEXT, world_id TEXT, world_name TEXT, time INTEGER, group_name TEXT, UNIQUE(created_at, location))`
        );
        await adapter.executeNonQuery(
            `CREATE INDEX IF NOT EXISTS gamelog_location_created_at_idx ON gamelog_location (created_at)`
        );
        await adapter.executeNonQuery(
            `CREATE INDEX IF NOT EXISTS idx_gamelog_location_world_created ON gamelog_location (world_id, created_at)`
        );
        await adapter.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS gamelog_join_leave (id INTEGER PRIMARY KEY, created_at TEXT, type TEXT, display_name TEXT, location TEXT, user_id TEXT, time INTEGER, UNIQUE(created_at, type, display_name))`
        );
        await adapter.executeNonQuery(
            `CREATE INDEX IF NOT EXISTS idx_gamelog_jl_location ON gamelog_join_leave (location)`
        );
        await adapter.executeNonQuery(
            `CREATE INDEX IF NOT EXISTS idx_gamelog_jl_user_created ON gamelog_join_leave (user_id, created_at)`
        );
        await adapter.executeNonQuery(
            `CREATE INDEX IF NOT EXISTS idx_gamelog_jl_display_created ON gamelog_join_leave (display_name, created_at)`
        );
        await adapter.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS gamelog_portal_spawn (id INTEGER PRIMARY KEY, created_at TEXT, display_name TEXT, location TEXT, user_id TEXT, instance_id TEXT, world_name TEXT, UNIQUE(created_at, display_name))`
        );
        await adapter.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS gamelog_video_play (id INTEGER PRIMARY KEY, created_at TEXT, video_url TEXT, video_name TEXT, video_id TEXT, location TEXT, display_name TEXT, user_id TEXT, UNIQUE(created_at, video_url))`
        );
        await adapter.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS gamelog_resource_load (id INTEGER PRIMARY KEY, created_at TEXT, resource_url TEXT, resource_type TEXT, location TEXT, UNIQUE(created_at, resource_url))`
        );
        await adapter.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS gamelog_event (id INTEGER PRIMARY KEY, created_at TEXT, data TEXT, UNIQUE(created_at, data))`
        );
        await adapter.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS gamelog_external (id INTEGER PRIMARY KEY, created_at TEXT, message TEXT, display_name TEXT, user_id TEXT, location TEXT, UNIQUE(created_at, message))`
        );
        await adapter.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS cache_avatar (id TEXT PRIMARY KEY, added_at TEXT, author_id TEXT, author_name TEXT, created_at TEXT, description TEXT, image_url TEXT, name TEXT, release_status TEXT, thumbnail_image_url TEXT, updated_at TEXT, version INTEGER)`
        );
        await adapter.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS cache_world (id TEXT PRIMARY KEY, added_at TEXT, author_id TEXT, author_name TEXT, created_at TEXT, description TEXT, image_url TEXT, name TEXT, release_status TEXT, thumbnail_image_url TEXT, updated_at TEXT, version INTEGER)`
        );
        await adapter.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS favorite_world (id INTEGER PRIMARY KEY, created_at TEXT, world_id TEXT, group_name TEXT)`
        );
        await adapter.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS favorite_avatar (id INTEGER PRIMARY KEY, created_at TEXT, avatar_id TEXT, group_name TEXT)`
        );
        await adapter.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS favorite_friend (id INTEGER PRIMARY KEY, created_at TEXT, user_id TEXT, group_name TEXT)`
        );
        await adapter.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS memos (user_id TEXT PRIMARY KEY, edited_at TEXT, memo TEXT)`
        );
        await adapter.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS world_memos (world_id TEXT PRIMARY KEY, edited_at TEXT, memo TEXT)`
        );
        await adapter.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS avatar_memos (avatar_id TEXT PRIMARY KEY, edited_at TEXT, memo TEXT)`
        );
        await adapter.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS avatar_tags (avatar_id TEXT NOT NULL, tag TEXT NOT NULL, color TEXT, PRIMARY KEY (avatar_id, tag))`
        );
    },

    begin() {
        adapter.begin();
    },

    commit() {
        adapter.commit();
    },

    async vacuum() {
        await adapter.vacuum();
    },

    async optimize() {
        await adapter.optimize();
    },

    /**
     * 执行数据库迁移 (基于 .map 文件的新迁移系统)。
     * @param {number} currentVersion - 当前版本
     * @param {number} targetVersion - 目标版本
     * @param {object} [options] - 选项
     * @param {string} [options.oldDbPath] - 旧数据库路径
     * @returns {Promise<boolean>}
     */
    async runMigrations(currentVersion, targetVersion, options = {}) {
        return await runMigrations(currentVersion, targetVersion, options);
    }
};

window.database = database;
export { database, dbVars };
