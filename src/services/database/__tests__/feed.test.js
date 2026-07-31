import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../index.js', () => ({
    dbVars: {
        maxTableSize: 500,
        userPrefix: 'usr_test'
    }
}));

import { feed } from '../feed.js';
import { adapter } from '../adapter/index.js';

// ── PG strict GROUP BY compliance ────────────────────────────────────
//
// PostgreSQL (unlike SQLite/MySQL) requires every non-aggregated SELECT
// column to appear in GROUP BY. These tests pin the spec emitted by each
// grouped query: bare non-grouped columns must be wrapped in aggregates.

describe('feed strict GROUP BY compliance', () => {
    let groupByMock;

    beforeEach(() => {
        groupByMock = vi
            .spyOn(adapter, 'selectGroupBy')
            .mockResolvedValue([]);
    });

    afterEach(() => {
        groupByMock.mockRestore();
    });

    test('getHotWorlds: world_name aggregated, not bare', async () => {
        await feed.getHotWorlds(30, 30);
        const spec = groupByMock.mock.calls[0][1];
        expect(spec.groupBy).toEqual(['world_id']);
        expect(spec.columns).toEqual([
            `${adapter.sqlExtractWorldId('location')} AS world_id`
        ]);
        expect(spec.aggregates).toContainEqual({
            expr: 'MAX(world_name)',
            alias: 'world_name'
        });
    });

    test('getHotWorldFriendDetail: display_name aggregated, not bare', async () => {
        await feed.getHotWorldFriendDetail('wrld_x', 30);
        const spec = groupByMock.mock.calls[0][1];
        expect(spec.groupBy).toEqual(['user_id']);
        expect(spec.columns).toEqual(['user_id']);
        expect(spec.aggregates).toContainEqual({
            expr: 'MAX(display_name)',
            alias: 'display_name'
        });
    });
});
