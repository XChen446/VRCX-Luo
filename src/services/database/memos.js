import { dbVars } from '../database';

import { adapter } from './adapter/index.js';

const memos = {
    // user memos

    async getUserMemo(userId) {
        var row = {};
        await adapter.execute(
            (dbRow) => {
                row = {
                    userId: dbRow[0],
                    editedAt: dbRow[1],
                    memo: dbRow[2]
                };
            },
            `SELECT * FROM memos WHERE user_id = @user_id`,
            {
                '@user_id': userId
            }
        );
        return row;
    },

    async getAllUserMemos() {
        var memos = [];
        await adapter.execute((dbRow) => {
            var row = {
                userId: dbRow[0],
                memo: dbRow[1]
            };
            memos.push(row);
        }, 'SELECT user_id, memo FROM memos');
        return memos;
    },

    async setUserMemo(entry) {
        await adapter.insert('memos', 'replace', {
            user_id: entry.userId,
            edited_at: entry.editedAt,
            memo: entry.memo
        });
    },

    async deleteUserMemo(userId) {
        await adapter.delete('memos', { user_id: userId });
    },

    // world memos

    async getWorldMemo(worldId) {
        var row = {};
        await adapter.execute(
            (dbRow) => {
                row = {
                    worldId: dbRow[0],
                    editedAt: dbRow[1],
                    memo: dbRow[2]
                };
            },
            `SELECT * FROM world_memos WHERE world_id = @world_id`,
            {
                '@world_id': worldId
            }
        );
        return row;
    },

    setWorldMemo(entry) {
        adapter.insert('world_memos', 'replace', {
            world_id: entry.worldId,
            edited_at: entry.editedAt,
            memo: entry.memo
        });
    },

    deleteWorldMemo(worldId) {
        adapter.delete('world_memos', { world_id: worldId });
    },

    // Avatar memos

    async getAvatarMemoDB(avatarId) {
        var row = {};
        await adapter.execute(
            (dbRow) => {
                row = {
                    avatarId: dbRow[0],
                    editedAt: dbRow[1],
                    memo: dbRow[2]
                };
            },
            `SELECT * FROM avatar_memos WHERE avatar_id = @avatar_id`,
            {
                '@avatar_id': avatarId
            }
        );
        return row;
    },

    setAvatarMemo(entry) {
        adapter.insert('avatar_memos', 'replace', {
            avatar_id: entry.avatarId,
            edited_at: entry.editedAt,
            memo: entry.memo
        });
    },

    deleteAvatarMemo(avatarId) {
        adapter.delete('avatar_memos', { avatar_id: avatarId });
    },

    // user notes

    async addUserNote(note) {
        adapter.insert(`${dbVars.userPrefix}_notes`, 'replace', {
            user_id: note.userId,
            display_name: note.displayName,
            note: note.note,
            created_at: note.createdAt
        });
    },

    async getAllUserNotes() {
        var data = [];
        await adapter.execute((dbRow) => {
            var row = {
                userId: dbRow[0],
                displayName: dbRow[1],
                note: dbRow[2],
                createdAt: dbRow[3]
            };
            data.push(row);
        }, `SELECT user_id, display_name, note, created_at FROM ${dbVars.userPrefix}_notes`);
        return data;
    },

    async deleteUserNote(userId) {
        adapter.delete(`${dbVars.userPrefix}_notes`, { user_id: userId });
    }
};

export { memos };
