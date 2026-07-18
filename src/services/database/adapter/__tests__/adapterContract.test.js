/**
 * EngineAdapter contract tests — vitest entry point.
 *
 * Thin wrapper that imports the reusable contract suite from
 * `test/contract/adapter-contract.js` and runs it against the
 * `MemorySQLiteAdapter` reference implementation (backed by Node's
 * built-in `node:sqlite` DatabaseSync).
 *
 * vitest's include glob only scans src test files, not the contract
 * library at test/contract/. This split keeps the contract suite
 * reusable by any future engine adapter implementation — each adapter
 * ships its own wrapper that calls runAdapterContractTests.
 */
import { describe } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { MemorySQLiteAdapter } from '../../migrations/__tests__/memoryAdapter.js';
import { runAdapterContractTests } from '../../../../../test/contract/adapter-contract.js';

describe('EngineAdapter contract — MemorySQLiteAdapter reference impl', () => {
    runAdapterContractTests(() => {
        const db = new DatabaseSync(':memory:');
        const adapter = new MemorySQLiteAdapter(db);
        // Attach the raw db so the contract suite's afterEach can close it.
        adapter._testDb = db;
        return adapter;
    }, 'MemorySQLiteAdapter');
});
