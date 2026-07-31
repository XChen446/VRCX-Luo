import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../index.js', () => ({
    dbVars: {
        maxTableSize: 500,
        userPrefix: ''
    }
}));

import { gameLog } from '../gameLog.js';
import { adapter } from '../adapter/index.js';

describe('gameLog.getSelfPresenceForLocations', () => {
    let executeMock;

    beforeEach(() => {
        executeMock = vi.spyOn(adapter, 'execute').mockImplementation(async () => {});
    });

    afterEach(() => {
        executeMock.mockRestore();
    });

    test('filters out zero-duration records with AND time > 0', async () => {
        executeMock.mockImplementation(async (callback, sql, params) => {
            callback([
                'wrld_1:123~region(us)',
                '2024-01-15T10:00:00Z',
                3600000
            ]);
            return undefined;
        });

        const result = await gameLog.getSelfPresenceForLocations('usr_abc', [
            'wrld_1:123~region(us)'
        ]);

        expect(result.get('wrld_1:123~region(us)')).toEqual([
            { selfLeave: '2024-01-15T10:00:00Z', selfTime: 3600000 }
        ]);
        expect(executeMock).toHaveBeenCalledTimes(1);
        expect(executeMock.mock.calls[0][1]).toContain('AND time > 0');
    });

    test('returns empty map when locations array is empty', async () => {
        const result = await gameLog.getSelfPresenceForLocations('usr_abc', []);
        expect(result.size).toBe(0);
        expect(executeMock).not.toHaveBeenCalled();
    });
});

describe('gameLog.getCoInstanceHistoryBetweenFriends', () => {
    let executeMock;

    beforeEach(() => {
        executeMock = vi.spyOn(adapter, 'execute').mockImplementation(async () => {});
    });

    afterEach(() => {
        executeMock.mockRestore();
    });

    test('includes inferred co-instance sessions from feed GPS/offline history', async () => {
        executeMock.mockImplementation(async (callback, sql, params) => {
            // selectWhere for gamelog_join_leave (friend A and B)
            if (
                sql.includes('FROM gamelog_join_leave') &&
                !sql.includes('previous_location')
            ) {
                if (params['uid'] === 'usr_a') {
                    callback([
                        'wrld_logged:123~region(us)',
                        '2025-01-01T12:00:00Z',
                        3600000
                    ]);
                } else if (params['uid'] === 'usr_b') {
                    callback([
                        'wrld_logged:123~region(us)',
                        '2025-01-01T12:30:00Z',
                        3600000
                    ]);
                }
                return undefined;
            }
            // selectUnion for feed tables (friend A and B)
            if (params['uid'] === 'usr_a') {
                callback([
                    'wrld_inferred:55~region(us)',
                    '2025-01-01T10:00:00Z',
                    3600000
                ]);
            } else if (params['uid'] === 'usr_b') {
                callback([
                    'wrld_inferred:55~region(us)',
                    '2025-01-01T10:20:00Z',
                    3600000
                ]);
            }
            return undefined;
        });

        const result = await gameLog.getCoInstanceHistoryBetweenFriends(
            'usr_a',
            'usr_b'
        );

        expect(result).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    location: 'wrld_logged:123~region(us)'
                }),
                expect.objectContaining({
                    location: 'wrld_inferred:55~region(us)'
                })
            ])
        );
    });

    test('deduplicates duplicate rows coming from multiple sources', async () => {
        executeMock.mockImplementation(async (callback, sql, params) => {
            // selectWhere for gamelog_join_leave
            if (
                sql.includes('FROM gamelog_join_leave') &&
                !sql.includes('previous_location')
            ) {
                if (params['uid'] === 'usr_a') {
                    callback([
                        'wrld_same:1~region(us)',
                        '2025-01-01T10:00:00Z',
                        3600000
                    ]);
                } else if (params['uid'] === 'usr_b') {
                    callback([
                        'wrld_same:1~region(us)',
                        '2025-01-01T10:20:00Z',
                        3600000
                    ]);
                }
                return undefined;
            }
            // selectUnion for feed tables
            if (params['uid'] === 'usr_a') {
                callback([
                    'wrld_same:1~region(us)',
                    '2025-01-01T10:00:00Z',
                    3600000
                ]);
            } else if (params['uid'] === 'usr_b') {
                callback([
                    'wrld_same:1~region(us)',
                    '2025-01-01T10:20:00Z',
                    3600000
                ]);
            }
            return undefined;
        });

        const result = await gameLog.getCoInstanceHistoryBetweenFriends(
            'usr_a',
            'usr_b'
        );

        const duplicates = result.filter(
            (item) =>
                item.location === 'wrld_same:1~region(us)' &&
                item.friendALeave === '2025-01-01T10:00:00Z' &&
                item.friendBLeave === '2025-01-01T10:20:00Z'
        );
        expect(duplicates).toHaveLength(1);
    });
});

describe('gameLog.getMyTopWorlds', () => {
    let executeMock;

    beforeEach(() => {
        executeMock = vi.spyOn(adapter, 'execute').mockImplementation(async () => {});
    });

    afterEach(() => {
        executeMock.mockRestore();
    });

    test('adds an exclude clause when a home world id is provided', async () => {
        executeMock.mockImplementation(async (callback, sql, params) => {
            callback(['wrld_1', 'World One', 3, 9000]);
            return undefined;
        });

        const result = await gameLog.getMyTopWorlds(30, 5, 'time', 'wrld_home');

        expect(result).toEqual([
            {
                worldId: 'wrld_1',
                worldName: 'World One',
                visitCount: 3,
                totalTime: 9000
            }
        ]);
        expect(executeMock).toHaveBeenCalledTimes(1);
        expect(executeMock.mock.calls[0][1]).toContain(
            'AND world_id != @excludeWorldId'
        );
        expect(executeMock.mock.calls[0][1]).toContain('LIMIT 5');
        expect(executeMock.mock.calls[0][2]).toMatchObject({
            excludeWorldId: 'wrld_home'
        });
        // @cutoff is computed via adapter.daysAgoISO(30), skip exact value assertion
        expect(executeMock.mock.calls[0][2]).toHaveProperty('cutoff');
    });
});

// ── PG strict GROUP BY compliance ────────────────────────────────────
//
// PostgreSQL (unlike SQLite/MySQL) requires every non-aggregated SELECT
// column to appear in GROUP BY. These tests pin the spec emitted by each
// grouped query: bare non-grouped columns must be wrapped in aggregates.

describe('gameLog strict GROUP BY compliance', () => {
    let groupByMock;

    beforeEach(() => {
        groupByMock = vi
            .spyOn(adapter, 'selectGroupBy')
            .mockResolvedValue([]);
    });

    afterEach(() => {
        groupByMock.mockRestore();
    });

    const specOf = () => groupByMock.mock.calls[0][1];

    test('getRecentlyMetUsers: display_name aggregated, not bare', async () => {
        await gameLog.getRecentlyMetUsers('usr_me', 8);
        const spec = specOf();
        expect(spec.groupBy).toEqual(['user_id']);
        expect(spec.aggregates).toContainEqual({
            expr: 'MAX(display_name)',
            alias: 'display_name'
        });
        expect(spec.columns).toEqual(['user_id']);
    });

    test('getRecentlyJoinedLocations: world_name/location aggregated, not bare', async () => {
        await gameLog.getRecentlyJoinedLocations(10);
        const spec = specOf();
        expect(spec.groupBy).toEqual(['world_id']);
        expect(spec.columns).toEqual(['world_id']);
        expect(spec.aggregates).toContainEqual({
            expr: 'MAX(world_name)',
            alias: 'world_name'
        });
        expect(spec.aggregates).toContainEqual({
            expr: 'MAX(location)',
            alias: 'location'
        });
    });

    test('getAllUserStats: created_at aggregated via MAX, not bare', async () => {
        await gameLog.getAllUserStats(['usr_a'], ['Alice']);
        const spec = specOf();
        expect(spec.groupBy).toEqual(['user_id', 'display_name']);
        expect(spec.columns).toEqual(['user_id', 'display_name']);
        expect(spec.aggregates).toContainEqual({
            expr: 'MAX(created_at)',
            alias: 'last_seen'
        });
    });

    test('getMyTopWorlds: world_name aggregated, not bare', async () => {
        await gameLog.getMyTopWorlds(30, 5, 'time', '');
        const spec = specOf();
        expect(spec.groupBy).toEqual(['world_id']);
        expect(spec.columns).toEqual(['world_id']);
        expect(spec.aggregates).toContainEqual({
            expr: 'MAX(world_name)',
            alias: 'world_name'
        });
    });

    test('getRelationshipTimelineData: display_name aggregated, not bare', async () => {
        await gameLog.getRelationshipTimelineData();
        const spec = specOf();
        expect(spec.groupBy).toEqual(['user_id', 'day']);
        expect(spec.columns).toEqual(['user_id', 'SUBSTR(created_at, 1, 10) AS day']);
        expect(spec.aggregates).toContainEqual({
            expr: 'MAX(display_name)',
            alias: 'display_name'
        });
    });
});

// ── UNION ALL column type consistency ───────────────────────────────
//
// PostgreSQL rejects `UNION ALL` branches whose corresponding columns
// differ in type (42804). The `time` position is an integer column
// (BIGINT in PG) in gamelog_location / gamelog_join_leave, so the
// NULL-padded branches must cast to BIGINT — not the bare `NULL AS time`
// which PG infers as text.

describe('gameLog UNION ALL column type consistency', () => {
    let unionMock;

    beforeEach(() => {
        unionMock = vi.spyOn(adapter, 'selectUnion').mockResolvedValue([]);
    });

    afterEach(() => {
        unionMock.mockRestore();
    });

    test('time null-pads use BIGINT cast matching the real integer columns', async () => {
        await gameLog.lookupGameLogDatabase([], [], 25);
        const sources = unionMock.mock.calls[0][0];
        // All game log sources are included with an empty filter list.
        expect(sources.length).toBeGreaterThanOrEqual(5);
        // Position 6 is `time` in the 18-column game log schema.
        const timeExpr = (cols) => cols.split(', ')[6];
        for (const src of sources) {
            if (
                src.table === 'gamelog_location' ||
                src.table === 'gamelog_join_leave'
            ) {
                expect(timeExpr(src.columns)).toBe('time');
            } else {
                expect(timeExpr(src.columns)).toBe(
                    'CAST(NULL AS BIGINT) AS time'
                );
            }
        }
    });
});
