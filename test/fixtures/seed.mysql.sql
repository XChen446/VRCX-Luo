-- ============================================================================
-- CI seed data -- MySQL dialect
-- ============================================================================
-- 镜像源:src/services/database/adapter/MySQLAdapter.js
--   initGlobalSchema  L1032-1116(18 张全局表)
--   initUserSchema    L931-1018 (22 张用户表,前缀 abc)
-- 同步义务:本文件 DDL 必须与 adapter 源码逐字一致(列名/类型/NOT NULL/
--   DEFAULT/主键/唯一约束/列顺序)。修改 adapter 建表语句时必须同步更新本文件。
-- 幂等策略:DDL 用 CREATE TABLE IF NOT EXISTS;DML 用 INSERT IGNORE INTO
--   (主键/唯一键冲突时静默跳过),整个文件可重复执行。
-- 方言注意事项:
--   - cookies/configs 的 `key`/`value` 为保留字,必须加反引号。
--   - TEXT 列参与唯一索引必须带前缀长度:
--       gamelog_event    UNIQUE(created_at, data(255))
--       gamelog_external UNIQUE(created_at, message(255))
--     本文件种子值均 < 100 字符,不触发截断/歧义。
--   - MySQL 8.0 没有 CREATE INDEX IF NOT EXISTS,故本文件不含任何 CREATE INDEX
--     (adapter 通过 createIndex + information_schema 预检实现幂等,seed 不需要)。
--   - activity_bucket_cache_v2 的 raw_buckets_json / normalized_buckets_json /
--     summary_json 为 NOT NULL 且无默认值,必须显式赋值('[]' / '[]' / '{}');
--     其 ascii 列(user_id / target_user_id / view_kind / exclude_key)只填 ASCII 值。
-- 章节:1. Global DDL -> 2. User DDL -> 3. Global DML -> 4. User DML
-- 数据规划:22 行 global + 29 行 user(逐表行数见各表注释),满足 CI smoke 计数断言。
-- ============================================================================

-- ── 1. Global DDL(18 tables, mirrored from initGlobalSchema L1032-1116) ──

CREATE TABLE IF NOT EXISTS gamelog_location (id INT AUTO_INCREMENT PRIMARY KEY, created_at VARCHAR(255), location VARCHAR(512), world_id VARCHAR(255), world_name TEXT, time INT, group_name TEXT, UNIQUE(created_at, location));
CREATE TABLE IF NOT EXISTS gamelog_join_leave (id INT AUTO_INCREMENT PRIMARY KEY, created_at VARCHAR(255), type VARCHAR(255), display_name VARCHAR(255), location VARCHAR(512), user_id VARCHAR(255), time INT, UNIQUE(created_at, type, display_name));
CREATE TABLE IF NOT EXISTS gamelog_portal_spawn (id INT AUTO_INCREMENT PRIMARY KEY, created_at VARCHAR(255), display_name VARCHAR(255), location VARCHAR(512), user_id VARCHAR(255), instance_id VARCHAR(255), world_name TEXT, UNIQUE(created_at, display_name));
CREATE TABLE IF NOT EXISTS gamelog_video_play (id INT AUTO_INCREMENT PRIMARY KEY, created_at VARCHAR(255), video_url VARCHAR(512), video_name TEXT, video_id VARCHAR(255), location VARCHAR(512), display_name VARCHAR(255), user_id VARCHAR(255), UNIQUE(created_at, video_url));
CREATE TABLE IF NOT EXISTS gamelog_resource_load (id INT AUTO_INCREMENT PRIMARY KEY, created_at VARCHAR(255), resource_url VARCHAR(512), resource_type VARCHAR(255), location VARCHAR(512), UNIQUE(created_at, resource_url));
CREATE TABLE IF NOT EXISTS gamelog_event (id INT AUTO_INCREMENT PRIMARY KEY, created_at VARCHAR(255), data TEXT, UNIQUE(created_at, data(255)));
CREATE TABLE IF NOT EXISTS gamelog_external (id INT AUTO_INCREMENT PRIMARY KEY, created_at VARCHAR(255), message TEXT, display_name VARCHAR(255), user_id VARCHAR(255), location VARCHAR(512), UNIQUE(created_at, message(255)));
CREATE TABLE IF NOT EXISTS cache_avatar (id VARCHAR(255) PRIMARY KEY, added_at VARCHAR(255), author_id VARCHAR(255), author_name VARCHAR(255), created_at VARCHAR(255), description TEXT, image_url TEXT, name VARCHAR(255), release_status VARCHAR(255), thumbnail_image_url TEXT, updated_at VARCHAR(255), version INT);
CREATE TABLE IF NOT EXISTS cache_world (id VARCHAR(255) PRIMARY KEY, added_at VARCHAR(255), author_id VARCHAR(255), author_name VARCHAR(255), created_at VARCHAR(255), description TEXT, image_url TEXT, name VARCHAR(255), release_status VARCHAR(255), thumbnail_image_url TEXT, updated_at VARCHAR(255), version INT);
CREATE TABLE IF NOT EXISTS favorite_world (id INT AUTO_INCREMENT PRIMARY KEY, created_at VARCHAR(255), world_id VARCHAR(255), group_name VARCHAR(255));
CREATE TABLE IF NOT EXISTS favorite_avatar (id INT AUTO_INCREMENT PRIMARY KEY, created_at VARCHAR(255), avatar_id VARCHAR(255), group_name VARCHAR(255));
CREATE TABLE IF NOT EXISTS favorite_friend (id INT AUTO_INCREMENT PRIMARY KEY, created_at VARCHAR(255), user_id VARCHAR(255), group_name VARCHAR(255));
CREATE TABLE IF NOT EXISTS memos (user_id VARCHAR(255) PRIMARY KEY, edited_at VARCHAR(255), memo TEXT);
CREATE TABLE IF NOT EXISTS world_memos (world_id VARCHAR(255) PRIMARY KEY, edited_at VARCHAR(255), memo TEXT);
CREATE TABLE IF NOT EXISTS avatar_memos (avatar_id VARCHAR(255) PRIMARY KEY, edited_at VARCHAR(255), memo TEXT);
CREATE TABLE IF NOT EXISTS avatar_tags (avatar_id VARCHAR(255) NOT NULL, tag VARCHAR(255) NOT NULL, color VARCHAR(255), PRIMARY KEY (avatar_id, tag));
CREATE TABLE IF NOT EXISTS cookies (`key` VARCHAR(255) PRIMARY KEY, `value` LONGTEXT);
CREATE TABLE IF NOT EXISTS configs (`key` VARCHAR(255) PRIMARY KEY, `value` LONGTEXT);

-- ── 2. User DDL(22 tables, prefix abc, mirrored from initUserSchema L931-1018) ──

CREATE TABLE IF NOT EXISTS abc_feed_gps (id INT AUTO_INCREMENT PRIMARY KEY, created_at VARCHAR(255), user_id VARCHAR(255), display_name VARCHAR(255), location TEXT, world_name TEXT, previous_location TEXT, time INT, group_name TEXT);
CREATE TABLE IF NOT EXISTS abc_feed_status (id INT AUTO_INCREMENT PRIMARY KEY, created_at VARCHAR(255), user_id VARCHAR(255), display_name VARCHAR(255), status TEXT, status_description TEXT, previous_status TEXT, previous_status_description TEXT);
CREATE TABLE IF NOT EXISTS abc_feed_bio (id INT AUTO_INCREMENT PRIMARY KEY, created_at VARCHAR(255), user_id VARCHAR(255), display_name VARCHAR(255), bio TEXT, previous_bio TEXT);
CREATE TABLE IF NOT EXISTS abc_feed_avatar (id INT AUTO_INCREMENT PRIMARY KEY, created_at VARCHAR(255), user_id VARCHAR(255), display_name VARCHAR(255), owner_id VARCHAR(255), avatar_name TEXT, current_avatar_image_url TEXT, current_avatar_thumbnail_image_url TEXT, previous_current_avatar_image_url TEXT, previous_current_avatar_thumbnail_image_url TEXT);
CREATE TABLE IF NOT EXISTS abc_feed_online_offline (id INT AUTO_INCREMENT PRIMARY KEY, created_at VARCHAR(255), user_id VARCHAR(255), display_name VARCHAR(255), type VARCHAR(255), location TEXT, world_name TEXT, time INT, group_name TEXT);
CREATE TABLE IF NOT EXISTS abc_activity_sync_state_v2 (user_id VARCHAR(255) PRIMARY KEY, updated_at VARCHAR(255) NOT NULL DEFAULT '', is_self INT NOT NULL DEFAULT 0, source_last_created_at VARCHAR(255) NOT NULL DEFAULT '', pending_session_start_at INT, cached_range_days INT NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS abc_activity_sessions_v2 (session_id INT AUTO_INCREMENT PRIMARY KEY, user_id VARCHAR(255) NOT NULL, start_at INT NOT NULL, end_at INT NOT NULL, is_open_tail INT NOT NULL DEFAULT 0, source_revision VARCHAR(255) NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS abc_activity_bucket_cache_v2 (user_id VARCHAR(255) CHARACTER SET ascii NOT NULL, target_user_id VARCHAR(255) CHARACTER SET ascii NOT NULL DEFAULT '', range_days INT NOT NULL, view_kind VARCHAR(255) CHARACTER SET ascii NOT NULL, exclude_key VARCHAR(255) CHARACTER SET ascii NOT NULL DEFAULT '', bucket_version INT NOT NULL DEFAULT 1, raw_buckets_json LONGTEXT NOT NULL, normalized_buckets_json LONGTEXT NOT NULL, built_from_cursor VARCHAR(255) NOT NULL DEFAULT '', summary_json LONGTEXT NOT NULL, built_at VARCHAR(255) NOT NULL DEFAULT '', PRIMARY KEY (user_id, target_user_id, range_days, view_kind, exclude_key));
CREATE TABLE IF NOT EXISTS abc_friend_log_current (user_id VARCHAR(255) PRIMARY KEY, display_name VARCHAR(255), trust_level VARCHAR(255), friend_number INT);
CREATE TABLE IF NOT EXISTS abc_friend_log_history (id INT AUTO_INCREMENT PRIMARY KEY, created_at VARCHAR(255), type VARCHAR(255), user_id VARCHAR(255), display_name VARCHAR(255), previous_display_name VARCHAR(255), trust_level VARCHAR(255), previous_trust_level VARCHAR(255), friend_number INT);
CREATE TABLE IF NOT EXISTS abc_notifications (id VARCHAR(255) PRIMARY KEY, created_at VARCHAR(255), type VARCHAR(255), sender_user_id VARCHAR(255), sender_username VARCHAR(255), receiver_user_id VARCHAR(255), message TEXT, world_id VARCHAR(255), world_name TEXT, image_url TEXT, invite_message TEXT, request_message TEXT, response_message TEXT, expired INT);
CREATE TABLE IF NOT EXISTS abc_notifications_v2 (id VARCHAR(255) PRIMARY KEY, created_at VARCHAR(255), updated_at VARCHAR(255), expires_at VARCHAR(255), type VARCHAR(255), link TEXT, link_text TEXT, message TEXT, title TEXT, image_url TEXT, seen INT, sender_user_id VARCHAR(255), sender_username VARCHAR(255), data LONGTEXT, responses LONGTEXT, details LONGTEXT);
CREATE TABLE IF NOT EXISTS abc_moderation (user_id VARCHAR(255) PRIMARY KEY, updated_at VARCHAR(255), display_name VARCHAR(255), block INT, mute INT);
CREATE TABLE IF NOT EXISTS abc_avatar_history (avatar_id VARCHAR(255) PRIMARY KEY, created_at VARCHAR(255), time INT);
CREATE TABLE IF NOT EXISTS abc_notes (user_id VARCHAR(255) PRIMARY KEY, display_name VARCHAR(255), note TEXT, created_at VARCHAR(255));
CREATE TABLE IF NOT EXISTS abc_mutual_graph_friends (friend_id VARCHAR(255) PRIMARY KEY);
CREATE TABLE IF NOT EXISTS abc_mutual_graph_links (friend_id VARCHAR(255) NOT NULL, mutual_id VARCHAR(255) NOT NULL, PRIMARY KEY(friend_id, mutual_id));
CREATE TABLE IF NOT EXISTS abc_mutual_graph_links_old (friend_id VARCHAR(255) NOT NULL, mutual_id VARCHAR(255) NOT NULL, date VARCHAR(255) NOT NULL, PRIMARY KEY(friend_id, mutual_id));
CREATE TABLE IF NOT EXISTS abc_mutual_graph_friends_old (friend_id VARCHAR(255) PRIMARY KEY, last_updated VARCHAR(255) NOT NULL);
CREATE TABLE IF NOT EXISTS abc_mutual_graph_meta (friend_id VARCHAR(255) PRIMARY KEY, last_fetched_at VARCHAR(255), opted_out INT DEFAULT 0);
CREATE TABLE IF NOT EXISTS abc_tracked_nonfriends (user_id VARCHAR(255) PRIMARY KEY, display_name VARCHAR(255), added_at VARCHAR(255));
CREATE TABLE IF NOT EXISTS abc_manual_relations_MANUEL (user_id_a VARCHAR(255) NOT NULL, user_id_b VARCHAR(255) NOT NULL, relation_type VARCHAR(255) NOT NULL DEFAULT 'friend', added_at VARCHAR(255), PRIMARY KEY(user_id_a, user_id_b));

-- ── 3. Global DML(22 rows) ──
-- Columns listed in DDL order; explicit PK values for idempotent re-runs.

-- gamelog_location(2)
INSERT IGNORE INTO gamelog_location (id, created_at, location, world_id, world_name, time, group_name) VALUES (1, '2024-05-01T10:00:00Z', 'wrld_xyz:1~private(seed_a)~region', 'wrld_xyz:1', 'Test World', 1700000000, NULL);
INSERT IGNORE INTO gamelog_location (id, created_at, location, world_id, world_name, time, group_name) VALUES (2, '2024-05-01T11:00:00Z', 'wrld_xyz:1~private(seed_b)~region', 'wrld_xyz:1', 'Test World', 1700003600, 'Test Group');

-- gamelog_join_leave(2)
INSERT IGNORE INTO gamelog_join_leave (id, created_at, type, display_name, location, user_id, time) VALUES (1, '2024-05-01T10:00:00Z', 'OnPlayerJoined', 'Alice', 'wrld_xyz:1', 'usr_alice', 1700000000);
INSERT IGNORE INTO gamelog_join_leave (id, created_at, type, display_name, location, user_id, time) VALUES (2, '2024-05-01T10:05:00Z', 'OnPlayerLeft', 'Bob', 'wrld_xyz:1', 'usr_bob', 1700000300);

-- gamelog_portal_spawn(1)
INSERT IGNORE INTO gamelog_portal_spawn (id, created_at, display_name, location, user_id, instance_id, world_name) VALUES (1, '2024-05-01T10:00:00Z', 'Alice', 'wrld_xyz:1', 'usr_alice', 'inst_seed_1', 'Test World');

-- gamelog_video_play(1)
INSERT IGNORE INTO gamelog_video_play (id, created_at, video_url, video_name, video_id, location, display_name, user_id) VALUES (1, '2024-05-01T10:00:00Z', 'https://example.com/videos/seed.mp4', 'Seed Video', 'vid_seed_1', 'wrld_xyz:1', 'Alice', 'usr_alice');

-- gamelog_resource_load(1)
INSERT IGNORE INTO gamelog_resource_load (id, created_at, resource_url, resource_type, location) VALUES (1, '2024-05-01T10:00:00Z', 'https://example.com/resources/seed.bundle', 'avatar', 'wrld_xyz:1');

-- gamelog_event(1)
INSERT IGNORE INTO gamelog_event (id, created_at, data) VALUES (1, '2024-05-01T10:00:00Z', '{"seed":true}');

-- gamelog_external(1)
INSERT IGNORE INTO gamelog_external (id, created_at, message, display_name, user_id, location) VALUES (1, '2024-05-01T10:00:00Z', 'seed external event', 'Alice', 'usr_alice', 'wrld_xyz:1');

-- cache_avatar(2)
INSERT IGNORE INTO cache_avatar (id, added_at, author_id, author_name, created_at, description, image_url, name, release_status, thumbnail_image_url, updated_at, version) VALUES ('avtr_1', '2024-05-01T10:00:00Z', 'usr_creator', 'Creator', '2024-05-01T10:00:00Z', 'Avatar One', 'https://example.com/avatars/avtr_1.png', 'Avatar One', 'public', 'https://example.com/avatars/avtr_1_thumb.png', '2024-05-01T10:00:00Z', 1);
INSERT IGNORE INTO cache_avatar (id, added_at, author_id, author_name, created_at, description, image_url, name, release_status, thumbnail_image_url, updated_at, version) VALUES ('avtr_2', '2024-05-01T10:00:00Z', 'usr_creator', 'Creator', '2024-05-01T10:00:00Z', 'Avatar Two', 'https://example.com/avatars/avtr_2.png', 'Avatar Two', 'public', 'https://example.com/avatars/avtr_2_thumb.png', '2024-05-01T10:00:00Z', 2);

-- cache_world(1)
INSERT IGNORE INTO cache_world (id, added_at, author_id, author_name, created_at, description, image_url, name, release_status, thumbnail_image_url, updated_at, version) VALUES ('wrld_xyz:1', '2024-05-01T10:00:00Z', 'usr_creator', 'Creator', '2024-05-01T10:00:00Z', 'Seed World', 'https://example.com/worlds/wrld_xyz.png', 'Seed World', 'public', 'https://example.com/worlds/wrld_xyz_thumb.png', '2024-05-01T10:00:00Z', 1);

-- favorite_world(1)
INSERT IGNORE INTO favorite_world (id, created_at, world_id, group_name) VALUES (1, '2024-05-01T10:00:00Z', 'wrld_xyz:1', 'group_seed');

-- favorite_avatar(1)
INSERT IGNORE INTO favorite_avatar (id, created_at, avatar_id, group_name) VALUES (1, '2024-05-01T10:00:00Z', 'avtr_1', 'group_seed');

-- favorite_friend(1)
INSERT IGNORE INTO favorite_friend (id, created_at, user_id, group_name) VALUES (1, '2024-05-01T10:00:00Z', 'usr_alice', 'group_seed');

-- memos(1)
INSERT IGNORE INTO memos (user_id, edited_at, memo) VALUES ('usr_alice', '2024-05-01T10:00:00Z', 'Seed memo for Alice');

-- world_memos(1)
INSERT IGNORE INTO world_memos (world_id, edited_at, memo) VALUES ('wrld_xyz:1', '2024-05-01T10:00:00Z', 'Seed memo for world');

-- avatar_memos(1)
INSERT IGNORE INTO avatar_memos (avatar_id, edited_at, memo) VALUES ('avtr_1', '2024-05-01T10:00:00Z', 'Seed memo for avatar');

-- avatar_tags(2)
INSERT IGNORE INTO avatar_tags (avatar_id, tag, color) VALUES ('avtr_1', 'favorite', '#ff0000');
INSERT IGNORE INTO avatar_tags (avatar_id, tag, color) VALUES ('avtr_1', 'hidden', '#000000');

-- cookies(1)
INSERT IGNORE INTO cookies (`key`, `value`) VALUES ('seed_cookie_key', '{"auth":"seed"}');

-- configs(1)
INSERT IGNORE INTO configs (`key`, `value`) VALUES ('seed_config_key', '{"seed":true}');

-- ── 4. User DML(29 rows) ──
-- Columns listed in DDL order; explicit PK values for idempotent re-runs.

-- abc_feed_gps(2)
INSERT IGNORE INTO abc_feed_gps (id, created_at, user_id, display_name, location, world_name, previous_location, time, group_name) VALUES (1, '2024-05-01T10:00:00Z', 'usr_alice', 'Alice', 'wrld_xyz:1', 'Test World', 'offline', 1700000000, NULL);
INSERT IGNORE INTO abc_feed_gps (id, created_at, user_id, display_name, location, world_name, previous_location, time, group_name) VALUES (2, '2024-05-01T11:00:00Z', 'usr_bob', 'Bob', 'wrld_xyz:1', 'Test World', 'wrld_xyz:1', 1700003600, 'Test Group');

-- abc_feed_status(2)
INSERT IGNORE INTO abc_feed_status (id, created_at, user_id, display_name, status, status_description, previous_status, previous_status_description) VALUES (1, '2024-05-01T10:00:00Z', 'usr_alice', 'Alice', 'online', 'Seed status', 'offline', NULL);
INSERT IGNORE INTO abc_feed_status (id, created_at, user_id, display_name, status, status_description, previous_status, previous_status_description) VALUES (2, '2024-05-01T11:00:00Z', 'usr_bob', 'Bob', 'join me', 'Seed status two', 'online', NULL);

-- abc_feed_bio(1)
INSERT IGNORE INTO abc_feed_bio (id, created_at, user_id, display_name, bio, previous_bio) VALUES (1, '2024-05-01T10:00:00Z', 'usr_alice', 'Alice', 'Seed bio for Alice', NULL);

-- abc_feed_avatar(1)
INSERT IGNORE INTO abc_feed_avatar (id, created_at, user_id, display_name, owner_id, avatar_name, current_avatar_image_url, current_avatar_thumbnail_image_url, previous_current_avatar_image_url, previous_current_avatar_thumbnail_image_url) VALUES (1, '2024-05-01T10:00:00Z', 'usr_alice', 'Alice', 'usr_creator', 'Avatar One', 'https://example.com/avatars/avtr_1.png', 'https://example.com/avatars/avtr_1_thumb.png', NULL, NULL);

-- abc_feed_online_offline(1)
INSERT IGNORE INTO abc_feed_online_offline (id, created_at, user_id, display_name, type, location, world_name, time, group_name) VALUES (1, '2024-05-01T10:00:00Z', 'usr_alice', 'Alice', 'OnPlayerJoined', 'wrld_xyz:1', 'Test World', 1700000000, NULL);

-- abc_activity_sync_state_v2(1)
INSERT IGNORE INTO abc_activity_sync_state_v2 (user_id, updated_at, is_self, source_last_created_at, pending_session_start_at, cached_range_days) VALUES ('usr_alice', '2024-05-01T10:00:00Z', 1, '2024-05-01T10:00:00Z', 1700000000, 7);

-- abc_activity_sessions_v2(1)
INSERT IGNORE INTO abc_activity_sessions_v2 (session_id, user_id, start_at, end_at, is_open_tail, source_revision) VALUES (1, 'usr_alice', 1700000000, 1700003600, 0, 'rev_seed_1');

-- abc_activity_bucket_cache_v2(1, composite PK explicit)
INSERT IGNORE INTO abc_activity_bucket_cache_v2 (user_id, target_user_id, range_days, view_kind, exclude_key, bucket_version, raw_buckets_json, normalized_buckets_json, built_from_cursor, summary_json, built_at) VALUES ('usr_alice', '', 7, 'activity', '', 1, '[]', '[]', '', '{}', '2024-05-01T10:00:00Z');

-- abc_friend_log_current(1)
INSERT IGNORE INTO abc_friend_log_current (user_id, display_name, trust_level, friend_number) VALUES ('usr_alice', 'Alice', 'Trusted User', 5);

-- abc_friend_log_history(2)
INSERT IGNORE INTO abc_friend_log_history (id, created_at, type, user_id, display_name, previous_display_name, trust_level, previous_trust_level, friend_number) VALUES (1, '2024-05-01T10:00:00Z', 'friend.add', 'usr_alice', 'Alice', NULL, 'Trusted User', NULL, 5);
INSERT IGNORE INTO abc_friend_log_history (id, created_at, type, user_id, display_name, previous_display_name, trust_level, previous_trust_level, friend_number) VALUES (2, '2024-05-02T10:00:00Z', 'friend.remove', 'usr_bob', 'Bob', NULL, 'Known User', 'Trusted User', 4);

-- abc_notifications(1)
INSERT IGNORE INTO abc_notifications (id, created_at, type, sender_user_id, sender_username, receiver_user_id, message, world_id, world_name, image_url, invite_message, request_message, response_message, expired) VALUES ('notif_seed_1', '2024-05-01T10:00:00Z', 'group.invite', 'usr_bob', 'Bob', 'usr_alice', 'Invite to seed group', NULL, NULL, NULL, NULL, NULL, NULL, 0);

-- abc_notifications_v2(1)
INSERT IGNORE INTO abc_notifications_v2 (id, created_at, updated_at, expires_at, type, link, link_text, message, title, image_url, seen, sender_user_id, sender_username, data, responses, details) VALUES ('notif_v2_seed_1', '2024-05-01T10:00:00Z', '2024-05-01T10:00:00Z', NULL, 'group.invite', NULL, NULL, 'Seed notification v2', NULL, NULL, 0, 'usr_bob', 'Bob', '{}', NULL, NULL);

-- abc_moderation(1)
INSERT IGNORE INTO abc_moderation (user_id, updated_at, display_name, block, mute) VALUES ('usr_bob', '2024-05-01T10:00:00Z', 'Bob', 1, 0);

-- abc_avatar_history(1)
INSERT IGNORE INTO abc_avatar_history (avatar_id, created_at, time) VALUES ('avtr_1', '2024-05-01T10:00:00Z', 1700000000);

-- abc_notes(2)
INSERT IGNORE INTO abc_notes (user_id, display_name, note, created_at) VALUES ('usr_alice', 'Alice', 'Seed note for Alice', '2024-05-01T10:00:00Z');
INSERT IGNORE INTO abc_notes (user_id, display_name, note, created_at) VALUES ('usr_bob', 'Bob', 'Seed note for Bob', '2024-05-01T11:00:00Z');

-- abc_mutual_graph_friends(2)
INSERT IGNORE INTO abc_mutual_graph_friends (friend_id) VALUES ('usr_alice');
INSERT IGNORE INTO abc_mutual_graph_friends (friend_id) VALUES ('usr_bob');

-- abc_mutual_graph_links(2, bidirectional)
INSERT IGNORE INTO abc_mutual_graph_links (friend_id, mutual_id) VALUES ('usr_alice', 'usr_bob');
INSERT IGNORE INTO abc_mutual_graph_links (friend_id, mutual_id) VALUES ('usr_bob', 'usr_alice');

-- abc_mutual_graph_links_old(1)
INSERT IGNORE INTO abc_mutual_graph_links_old (friend_id, mutual_id, date) VALUES ('usr_alice', 'usr_bob', '2024-05-01');

-- abc_mutual_graph_friends_old(1)
INSERT IGNORE INTO abc_mutual_graph_friends_old (friend_id, last_updated) VALUES ('usr_alice', '2024-05-01T10:00:00Z');

-- abc_mutual_graph_meta(2, one row with values, one row with NULLs)
INSERT IGNORE INTO abc_mutual_graph_meta (friend_id, last_fetched_at, opted_out) VALUES ('usr_alice', '2024-05-01T10:00:00Z', 0);
INSERT IGNORE INTO abc_mutual_graph_meta (friend_id, last_fetched_at, opted_out) VALUES ('usr_bob', NULL, NULL);

-- abc_tracked_nonfriends(1)
INSERT IGNORE INTO abc_tracked_nonfriends (user_id, display_name, added_at) VALUES ('usr_carol', 'Carol', '2024-05-01T10:00:00Z');

-- abc_manual_relations_MANUEL(1)
INSERT IGNORE INTO abc_manual_relations_MANUEL (user_id_a, user_id_b, relation_type, added_at) VALUES ('usr_alice', 'usr_carol', 'friend', '2024-05-01T10:00:00Z');
