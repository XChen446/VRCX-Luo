import { dbVars } from '../database';

import { adapter } from './adapter/index.js';

const tableSize = {
    async getMaxFriendLogNumber() {
        var friendNumber = 0;
        await adapter.execute((dbRow) => {
            friendNumber = dbRow[0];
        }, `SELECT MAX(friend_number) FROM ${adapter.userTable(dbVars.userPrefix, 'friend_log_current')}`);
        return friendNumber;
    },

    async getGpsTableSize() {
        return adapter.countWhere(`${adapter.userTable(dbVars.userPrefix, 'feed_gps')}`);
    },

    async getStatusTableSize() {
        return adapter.countWhere(`${adapter.userTable(dbVars.userPrefix, 'feed_status')}`);
    },

    async getBioTableSize() {
        return adapter.countWhere(`${adapter.userTable(dbVars.userPrefix, 'feed_bio')}`);
    },

    async getAvatarTableSize() {
        return adapter.countWhere(`${adapter.userTable(dbVars.userPrefix, 'feed_avatar')}`);
    },

    async getOnlineOfflineTableSize() {
        return adapter.countWhere(`${adapter.userTable(dbVars.userPrefix, 'feed_online_offline')}`);
    },

    async getFriendLogHistoryTableSize() {
        return adapter.countWhere(`${adapter.userTable(dbVars.userPrefix, 'friend_log_history')}`);
    },

    async getNotificationTableSize() {
        return adapter.countWhere(`${adapter.userTable(dbVars.userPrefix, 'notifications')}`);
    },

    async getLocationTableSize() {
        return adapter.countWhere('gamelog_location');
    },

    async getJoinLeaveTableSize() {
        return adapter.countWhere('gamelog_join_leave');
    },

    async getPortalSpawnTableSize() {
        return adapter.countWhere('gamelog_portal_spawn');
    },

    async getVideoPlayTableSize() {
        return adapter.countWhere('gamelog_video_play');
    },

    async getResourceLoadTableSize() {
        return adapter.countWhere('gamelog_resource_load');
    },

    async getEventTableSize() {
        return adapter.countWhere('gamelog_event');
    },

    async getExternalTableSize() {
        return adapter.countWhere('gamelog_external');
    }
};

export { tableSize };
