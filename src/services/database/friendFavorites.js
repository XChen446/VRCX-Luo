import { adapter } from './adapter/index.js';

const friendFavorites = {
    addFriendToLocalFavorites(userId, groupName) {
        adapter.insert(
            'favorite_friend',
            {
                user_id: userId,
                group_name: groupName,
                created_at: new Date().toJSON()
            },
            'replace'
        );
    },

    removeFriendFromLocalFavorites(userId, groupName) {
        adapter.delete('favorite_friend', {
            user_id: userId,
            group_name: groupName
        });
    },

    renameFriendFavoriteGroup(newGroupName, groupName) {
        adapter.update(
            'favorite_friend',
            { group_name: newGroupName },
            { group_name: groupName }
        );
    },

    deleteFriendFavoriteGroup(groupName) {
        adapter.delete('favorite_friend', { group_name: groupName });
    },

    async getFriendFavorites() {
        const rows = await adapter.select('favorite_friend', '*');
        return rows.map((dbRow) => ({
            created_at: dbRow[1],
            userId: dbRow[2],
            groupName: dbRow[3]
        }));
    }
};

export { friendFavorites };
