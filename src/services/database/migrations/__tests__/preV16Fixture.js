// @ts-check
/**
 * Build the PRE-v16 schema and seed rows on a node:sqlite DatabaseSync
 * instance. Used by the migration equivalence tests as the "before" state.
 *
 * Two user prefixes (`userA1`, `userB2`) are created so wildcard expansion
 * (`%_friend_log_history`, `%_feed_gps`, ...) is exercised across MULTIPLE
 * per-user tables. This is mandatory to validate the F2 fix (a `user_id`
 * index must be created on BOTH prefixes' `friend_log_history` tables).
 *
 * The schema is the OLD shape: `gamelog_location.groupName` (NOT
 * `group_name`), no `friend_number` on friend_log tables, no `time` on
 * `avatar_history`, no `group_name` on feed tables, and none of the v16
 * indexes. Every schema change and every data fix has at least one positive
 * and one control row (see the design doc for the full rationale).
 *
 * No `configs` table is created — the migration runner writes version
 * checkpoints via the mocked configRepository, not the database.
 */

const PREFIXES = ['userA1', 'userB2'];

/**
 * Build the pre-v16 fixture on the given database.
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {void}
 */
function buildPreV16Fixture(db) {
    // ── Global tables (old shape) ───────────────────────────────────
    db.exec(`
        CREATE TABLE gamelog_location (
            id INTEGER PRIMARY KEY,
            created_at TEXT, location TEXT, world_id TEXT, world_name TEXT,
            time INTEGER, groupName TEXT,
            UNIQUE(created_at, location)
        );
        CREATE TABLE gamelog_join_leave (
            id INTEGER PRIMARY KEY,
            created_at TEXT, type TEXT, display_name TEXT,
            location TEXT, user_id TEXT, time INTEGER,
            UNIQUE(created_at, type, display_name)
        );
    `);

    // gamelog_location — drives SC3 (group_name backfill from groupName)
    // and D8 (per-location SUM(time) baseline).
    // SUM(time) for wrld_xyz:1 = 100 + 200 = 300.
    const gl = db.prepare(
        'INSERT INTO gamelog_location (id, created_at, location, world_id, world_name, time, groupName) VALUES (@id, @created_at, @location, @world_id, @world_name, @time, @groupName)'
    );
    gl.run({
        id: 1,
        created_at: '2024-05-01T10:00:00Z',
        location: 'wrld_xyz:1',
        world_id: 'wrld_xyz',
        world_name: 'WorldXyz',
        time: 100,
        groupName: 'OldGroup'
    });
    gl.run({
        id: 2,
        created_at: '2024-05-01T11:00:00Z',
        location: 'wrld_xyz:1',
        world_id: 'wrld_xyz',
        world_name: 'WorldXyz',
        time: 200,
        groupName: null
    });
    gl.run({
        id: 3,
        created_at: '2024-05-01T12:00:00Z',
        location: 'wrld_solo:1',
        world_id: 'wrld_solo',
        world_name: 'WorldSolo',
        time: 50,
        groupName: 'SoloGroup'
    });

    // gamelog_join_leave — drives D7 (traveling), D8 (broken leave time),
    // D9 (display_name " (" suffix strip).
    const gjl = db.prepare(
        'INSERT INTO gamelog_join_leave (id, created_at, type, display_name, location, user_id, time) VALUES (@id, @created_at, @type, @display_name, @location, @user_id, @time)'
    );
    const joinLeaveRows = [
        {
            id: 10,
            created_at: '2024-06-01T01:00:00Z',
            type: 'OnPlayerJoined',
            display_name: 'Alice',
            location: 'wrld_abc:12345',
            user_id: 'usr_alice',
            time: 0
        },
        {
            id: 11,
            created_at: '2024-06-01T02:00:00Z',
            type: 'OnPlayerLeft',
            display_name: 'Alice',
            location: 'traveling',
            user_id: 'usr_alice',
            time: 0
        },
        {
            id: 12,
            created_at: '2024-06-02T01:00:00Z',
            type: 'OnPlayerLeft',
            display_name: 'Dave',
            location: 'traveling',
            user_id: 'usr_dave',
            time: 0
        },
        {
            id: 13,
            created_at: '2024-06-03T03:00:00Z',
            type: 'OnPlayerLeft',
            display_name: 'Eve',
            location: 'wrld_xyz:1',
            user_id: 'usr_eve',
            time: 500
        },
        {
            id: 14,
            created_at: '2024-06-03T04:00:00Z',
            type: 'OnPlayerLeft',
            display_name: 'Fay',
            location: 'wrld_xyz:1',
            user_id: 'usr_fay',
            time: 150
        },
        {
            id: 15,
            created_at: '2024-06-03T05:00:00Z',
            type: 'OnPlayerLeft',
            display_name: 'Gus',
            location: 'wrld_nogamelog:1',
            user_id: 'usr_gus',
            time: 50
        },
        {
            id: 16,
            created_at: '2024-06-04T01:00:00Z',
            type: 'OnPlayerLeft',
            display_name: 'Bob (old)',
            location: 'wrld_b:1',
            user_id: 'usr_bob',
            time: 0
        },
        {
            id: 17,
            created_at: '2024-06-04T02:00:00Z',
            type: 'OnPlayerLeft',
            display_name: 'Charlie',
            location: 'wrld_c:1',
            user_id: 'usr_charlie',
            time: 0
        },
        {
            id: 18,
            created_at: '2024-06-04T03:00:00Z',
            type: 'OnPlayerLeft',
            display_name: ' (leading)',
            location: 'wrld_l:1',
            user_id: 'usr_lead',
            time: 0
        }
    ];
    for (const r of joinLeaveRows) gjl.run(r);

    // ── Per-prefix tables (old shape, no group_name/friend_number/time) ──
    for (const p of PREFIXES) {
        db.exec(`
            CREATE TABLE ${p}_feed_gps (
                id INTEGER PRIMARY KEY, created_at TEXT, user_id TEXT,
                display_name TEXT, location TEXT, world_name TEXT,
                previous_location TEXT, time INTEGER
            );
            CREATE TABLE ${p}_feed_online_offline (
                id INTEGER PRIMARY KEY, created_at TEXT, user_id TEXT,
                display_name TEXT, type TEXT, location TEXT,
                world_name TEXT, time INTEGER
            );
            CREATE TABLE ${p}_friend_log_current (
                user_id TEXT PRIMARY KEY, display_name TEXT, trust_level TEXT
            );
            CREATE TABLE ${p}_friend_log_history (
                id INTEGER PRIMARY KEY, created_at TEXT, type TEXT,
                user_id TEXT, display_name TEXT, previous_display_name TEXT,
                trust_level TEXT, previous_trust_level TEXT
            );
            CREATE TABLE ${p}_avatar_history (
                avatar_id TEXT PRIMARY KEY, created_at TEXT
            );
            CREATE TABLE ${p}_notifications (
                id TEXT PRIMARY KEY, created_at TEXT, type TEXT,
                sender_user_id TEXT, sender_username TEXT,
                receiver_user_id TEXT, message TEXT, world_id TEXT,
                world_name TEXT, image_url TEXT, invite_message TEXT,
                request_message TEXT, response_message TEXT, expired INTEGER
            );
        `);

        // {p}_feed_gps — drives SC1 (group_name add) + D2 (negative gps time).
        const gps = db.prepare(
            `INSERT INTO ${p}_feed_gps (id, created_at, user_id, display_name, location, world_name, previous_location, time) VALUES (@id, @created_at, @user_id, @display_name, @location, @world_name, @previous_location, @time)`
        );
        for (const r of [
            {
                id: 1,
                created_at: '2024-07-01T00:00:00Z',
                user_id: 'usr_x',
                display_name: 'X',
                location: 'wrld_x:1',
                world_name: 'WX',
                previous_location: 'prev',
                time: -5
            },
            {
                id: 2,
                created_at: '2024-07-01T01:00:00Z',
                user_id: 'usr_y',
                display_name: 'Y',
                location: 'wrld_y:1',
                world_name: 'WY',
                previous_location: 'prev',
                time: 10
            },
            {
                id: 3,
                created_at: '2024-07-01T02:00:00Z',
                user_id: 'usr_z',
                display_name: 'Z',
                location: 'wrld_z:1',
                world_name: 'WZ',
                previous_location: 'prev',
                time: 0
            }
        ])
            gps.run(r);

        // {p}_feed_online_offline — drives SC2 (group_name add).
        db.prepare(
            `INSERT INTO ${p}_feed_online_offline (id, created_at, user_id, display_name, type, location, world_name, time) VALUES (@id, @created_at, @user_id, @display_name, @type, @location, @world_name, @time)`
        ).run({
            id: 1,
            created_at: '2024-07-01T00:00:00Z',
            user_id: 'usr_x',
            display_name: 'X',
            type: 'Online',
            location: 'wrld_x:1',
            world_name: 'WX',
            time: 0
        });

        // {p}_friend_log_current — drives SC4 (friend_number add).
        db.prepare(
            `INSERT INTO ${p}_friend_log_current (user_id, display_name, trust_level) VALUES (@user_id, @display_name, @trust_level)`
        ).run({
            user_id: 'usr_self',
            display_name: 'Self',
            trust_level: 'Trusted User'
        });

        // {p}_friend_log_history — drives SC5 (friend_number add),
        // SC11 (user_id index), D1 (Legend swap delete), D6 (typo fix).
        const flh = db.prepare(
            `INSERT INTO ${p}_friend_log_history (id, created_at, type, user_id, display_name, previous_display_name, trust_level, previous_trust_level) VALUES (@id, @created_at, @type, @user_id, @display_name, @previous_display_name, @trust_level, @previous_trust_level)`
        );
        for (const r of [
            {
                id: 1,
                created_at: '2022-06-01T00:00:00Z',
                type: 'TrustLevel',
                user_id: 'usr_a',
                display_name: 'A',
                previous_display_name: 'A',
                trust_level: 'Veteran User',
                previous_trust_level: 'Trusted User'
            },
            {
                id: 2,
                created_at: '2022-06-01T00:00:00Z',
                type: 'TrustLevel',
                user_id: 'usr_b',
                display_name: 'B',
                previous_display_name: 'B',
                trust_level: 'Trusted User',
                previous_trust_level: 'Veteran User'
            },
            {
                id: 3,
                created_at: '2022-01-01T00:00:00Z',
                type: 'TrustLevel',
                user_id: 'usr_c',
                display_name: 'C',
                previous_display_name: 'C',
                trust_level: 'Veteran User',
                previous_trust_level: 'Trusted User'
            },
            {
                id: 4,
                created_at: '2022-06-01T00:00:00Z',
                type: 'TrustLevel',
                user_id: 'usr_d',
                display_name: 'D',
                previous_display_name: 'D',
                trust_level: 'Veteran User',
                previous_trust_level: 'NUser'
            },
            {
                id: 5,
                created_at: '2024-08-01T00:00:00Z',
                type: 'CancelFriendRequst',
                user_id: 'usr_e',
                display_name: 'E',
                previous_display_name: 'E',
                trust_level: null,
                previous_trust_level: null
            },
            {
                id: 6,
                created_at: '2024-08-02T00:00:00Z',
                type: 'CancelFriendRequest',
                user_id: 'usr_f',
                display_name: 'F',
                previous_display_name: 'F',
                trust_level: null,
                previous_trust_level: null
            },
            {
                id: 7,
                created_at: '2024-08-03T00:00:00Z',
                type: 'FriendRequest',
                user_id: 'usr_g',
                display_name: 'G',
                previous_display_name: 'G',
                trust_level: null,
                previous_trust_level: null
            }
        ])
            flh.run(r);

        // {p}_avatar_history — drives SC6 (time add).
        db.prepare(
            `INSERT INTO ${p}_avatar_history (avatar_id, created_at) VALUES (@avatar_id, @created_at)`
        ).run({
            avatar_id: 'avtr_1',
            created_at: '2024-07-01T00:00:00Z'
        });

        // {p}_notifications — drives D3 (type LIKE '%.%'), D4 (null/empty
        // created_at), D5 (groupChange before cutoff).
        const notif = db.prepare(
            `INSERT INTO ${p}_notifications (id, created_at, type) VALUES (@id, @created_at, @type)`
        );
        for (const r of [
            {
                id: 'n1',
                created_at: '2024-05-01T00:00:00Z',
                type: 'group.invite'
            },
            {
                id: 'n2',
                created_at: '2024-05-01T00:00:00Z',
                type: 'group.invite.request'
            },
            {
                id: 'n3',
                created_at: '2024-05-01T00:00:00Z',
                type: 'groupChange'
            },
            {
                id: 'n4',
                created_at: null,
                type: 'notification'
            },
            {
                id: 'n5',
                created_at: '',
                type: 'notification'
            },
            {
                id: 'n6',
                created_at: '2024-05-01T00:00:00Z',
                type: 'notification'
            },
            {
                id: 'n7',
                created_at: '2024-01-01T00:00:00Z',
                type: 'groupChange'
            },
            {
                id: 'n8',
                created_at: '2024-05-01T00:00:00Z',
                type: 'groupChange'
            }
        ])
            notif.run(r);
    }
}

export { buildPreV16Fixture, PREFIXES };
