import { dbVars } from '../database';

import { adapter } from './adapter/index.js';

const memos = {
    // user memos

    async getUserMemo(userId) {
        const dbRow = await adapter.selectOne('memos', '*', {
            user_id: userId
        });
        if (!dbRow) return {};
        return {
            userId: dbRow[0],
            editedAt: dbRow[1],
            memo: dbRow[2]
        };
    },

    async getAllUserMemos() {
        const rows = await adapter.select('memos', ['user_id', 'memo']);
        return rows.map((dbRow) => ({
            userId: dbRow[0],
            memo: dbRow[1]
        }));
    },

    async setUserMemo(entry) {
        await adapter.insert(
            'memos',
            {
                user_id: entry.userId,
                edited_at: entry.editedAt,
                memo: entry.memo
            },
            'replace'
        );
    },

    async deleteUserMemo(userId) {
        await adapter.delete('memos', { user_id: userId });
    },

    // world memos

    async getWorldMemo(worldId) {
        const dbRow = await adapter.selectOne('world_memos', '*', {
            world_id: worldId
        });
        if (!dbRow) return {};
        return {
            worldId: dbRow[0],
            editedAt: dbRow[1],
            memo: dbRow[2]
        };
    },

    setWorldMemo(entry) {
        adapter.insert(
            'world_memos',
            {
                world_id: entry.worldId,
                edited_at: entry.editedAt,
                memo: entry.memo
            },
            'replace'
        );
    },

    deleteWorldMemo(worldId) {
        adapter.delete('world_memos', { world_id: worldId });
    },

    // Avatar memos

    async getAvatarMemoDB(avatarId) {
        const dbRow = await adapter.selectOne('avatar_memos', '*', {
            avatar_id: avatarId
        });
        if (!dbRow) return {};
        return {
            avatarId: dbRow[0],
            editedAt: dbRow[1],
            memo: dbRow[2]
        };
    },

    setAvatarMemo(entry) {
        adapter.insert(
            'avatar_memos',
            {
                avatar_id: entry.avatarId,
                edited_at: entry.editedAt,
                memo: entry.memo
            },
            'replace'
        );
    },

    deleteAvatarMemo(avatarId) {
        adapter.delete('avatar_memos', { avatar_id: avatarId });
    },

    // user notes

    async addUserNote(note) {
        adapter.insert(
            `${adapter.userTable(dbVars.userPrefix, 'notes')}`,
            {
                user_id: note.userId,
                display_name: note.displayName,
                note: note.note,
                created_at: note.createdAt
            },
            'replace'
        );
    },

    async getAllUserNotes() {
        const rows = await adapter.select(
            adapter.userTable(dbVars.userPrefix, 'notes'),
            ['user_id', 'display_name', 'note', 'created_at']
        );
        return rows.map((dbRow) => ({
            userId: dbRow[0],
            displayName: dbRow[1],
            note: dbRow[2],
            createdAt: dbRow[3]
        }));
    },

    async deleteUserNote(userId) {
        adapter.delete(`${adapter.userTable(dbVars.userPrefix, 'notes')}`, {
            user_id: userId
        });
    }
};

export { memos };
