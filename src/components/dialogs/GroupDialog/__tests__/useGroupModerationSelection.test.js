import { describe, expect, test } from 'vitest';

import { useGroupModerationSelection } from '../useGroupModerationSelection';

function createState() {
    return {
        selectedUsers: {},
        selectedUsersArray: [],
        tables: {
            members: { data: [] },
            bans: { data: [] },
            invites: { data: [] },
            joinRequests: { data: [] },
            blocked: { data: [] }
        }
    };
}

describe('useGroupModerationSelection', () => {
    describe('setSelectedUsers', () => {
        test('adds a user to selection', () => {
            const state = createState();
            const { setSelectedUsers } = useGroupModerationSelection(state);

            setSelectedUsers('usr_1', { userId: 'usr_1', name: 'Alice' });

            expect(state.selectedUsers['usr_1']).toEqual({
                userId: 'usr_1',
                name: 'Alice'
            });
            expect(state.selectedUsersArray).toHaveLength(1);
        });

        test('ignores null user', () => {
            const state = createState();
            const { setSelectedUsers } = useGroupModerationSelection(state);

            setSelectedUsers('usr_1', null);

            expect(state.selectedUsersArray).toHaveLength(0);
        });

        test('adds multiple users', () => {
            const state = createState();
            const { setSelectedUsers } = useGroupModerationSelection(state);

            setSelectedUsers('usr_1', { userId: 'usr_1', name: 'Alice' });
            setSelectedUsers('usr_2', { userId: 'usr_2', name: 'Bob' });

            expect(state.selectedUsersArray).toHaveLength(2);
        });
    });

    describe('deselectedUsers', () => {
        test('removes a specific user', () => {
            const state = createState();
            const { setSelectedUsers, deselectedUsers } =
                useGroupModerationSelection(state);

            setSelectedUsers('usr_1', { userId: 'usr_1', name: 'Alice' });
            setSelectedUsers('usr_2', { userId: 'usr_2', name: 'Bob' });
            deselectedUsers('usr_1');

            expect(state.selectedUsers['usr_1']).toBeUndefined();
            expect(state.selectedUsersArray).toHaveLength(1);
            expect(state.selectedUsersArray[0].name).toBe('Bob');
        });

        test('removes all users when isAll=true', () => {
            const state = createState();
            const { setSelectedUsers, deselectedUsers } =
                useGroupModerationSelection(state);

            setSelectedUsers('usr_1', { userId: 'usr_1', name: 'Alice' });
            setSelectedUsers('usr_2', { userId: 'usr_2', name: 'Bob' });
            deselectedUsers(null, true);

            expect(state.selectedUsersArray).toHaveLength(0);
        });
    });

    describe('onSelectionChange', () => {
        test('selects user when row.$selected is true', () => {
            const state = createState();
            const { onSelectionChange } = useGroupModerationSelection(state);

            onSelectionChange({
                userId: 'usr_1',
                name: 'Alice',
                $selected: true
            });

            expect(state.selectedUsersArray).toHaveLength(1);
        });

        test('deselects user when row.$selected is false', () => {
            const state = createState();
            const { setSelectedUsers, onSelectionChange } =
                useGroupModerationSelection(state);

            setSelectedUsers('usr_1', { userId: 'usr_1', name: 'Alice' });
            onSelectionChange({ userId: 'usr_1', $selected: false });

            expect(state.selectedUsersArray).toHaveLength(0);
        });
    });

    describe('deselectInTables', () => {
        test('deselects specific user in table data', () => {
            const state = createState();
            state.tables.members.data = [
                { userId: 'usr_1', $selected: true },
                { userId: 'usr_2', $selected: true }
            ];
            const { deselectInTables } = useGroupModerationSelection(state);

            deselectInTables('usr_1');

            expect(state.tables.members.data[0].$selected).toBe(false);
            expect(state.tables.members.data[1].$selected).toBe(true);
        });

        test('deselects all users when no userId', () => {
            const state = createState();
            state.tables.members.data = [
                { userId: 'usr_1', $selected: true },
                { userId: 'usr_2', $selected: true }
            ];
            state.tables.bans.data = [{ userId: 'usr_3', $selected: true }];
            const { deselectInTables } = useGroupModerationSelection(state);

            deselectInTables();

            expect(state.tables.members.data[0].$selected).toBe(false);
            expect(state.tables.members.data[1].$selected).toBe(false);
            expect(state.tables.bans.data[0].$selected).toBe(false);
        });

        test('handles null table gracefully', () => {
            const state = createState();
            state.tables.members = null;
            const { deselectInTables } = useGroupModerationSelection(state);

            expect(() => deselectInTables('usr_1')).not.toThrow();
        });
    });

    describe('deleteSelectedUser', () => {
        test('removes user from selection and tables', () => {
            const state = createState();
            state.tables.members.data = [{ userId: 'usr_1', $selected: true }];
            const { setSelectedUsers, deleteSelectedUser } =
                useGroupModerationSelection(state);

            setSelectedUsers('usr_1', { userId: 'usr_1', name: 'Alice' });
            deleteSelectedUser({ userId: 'usr_1' });

            expect(state.selectedUsersArray).toHaveLength(0);
            expect(state.tables.members.data[0].$selected).toBe(false);
        });
    });

    describe('clearAllSelected', () => {
        test('clears all selections and table states', () => {
            const state = createState();
            state.tables.members.data = [
                { userId: 'usr_1', $selected: true },
                { userId: 'usr_2', $selected: true }
            ];
            state.tables.bans.data = [{ userId: 'usr_3', $selected: true }];
            const { setSelectedUsers, clearAllSelected } =
                useGroupModerationSelection(state);

            setSelectedUsers('usr_1', { userId: 'usr_1' });
            setSelectedUsers('usr_2', { userId: 'usr_2' });
            setSelectedUsers('usr_3', { userId: 'usr_3' });

            clearAllSelected();

            expect(state.selectedUsersArray).toHaveLength(0);
            expect(state.tables.members.data.every((r) => !r.$selected)).toBe(
                true
            );
            expect(state.tables.bans.data.every((r) => !r.$selected)).toBe(
                true
            );
        });
    });

    describe('selectAll', () => {
        test('selects all rows in a table', () => {
            const state = createState();
            const tableData = [
                { userId: 'usr_1', $selected: false },
                { userId: 'usr_2', $selected: false }
            ];
            const { selectAll } = useGroupModerationSelection(state);

            selectAll(tableData);

            expect(tableData.every((r) => r.$selected)).toBe(true);
            expect(state.selectedUsersArray).toHaveLength(2);
        });
    });
});
