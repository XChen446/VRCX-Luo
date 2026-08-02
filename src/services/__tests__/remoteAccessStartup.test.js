import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    init: vi.fn(() => Promise.resolve())
}));

vi.mock('../../stores/remoteAccess', () => ({
    useRemoteAccessStore: () => ({
        init: mocks.init
    })
}));

describe('initRemoteAccessOnStartup', () => {
    beforeEach(() => {
        mocks.init.mockClear();
    });

    it('initializes the remote access store during app startup', async () => {
        const { initRemoteAccessOnStartup } = await import(
            '../remoteAccessStartup'
        );

        await initRemoteAccessOnStartup();

        expect(mocks.init).toHaveBeenCalledTimes(1);
    });

    it('does not throw when store initialization fails', async () => {
        mocks.init.mockRejectedValueOnce(new Error('native API unavailable'));
        const { initRemoteAccessOnStartup } = await import(
            '../remoteAccessStartup'
        );

        await expect(initRemoteAccessOnStartup()).resolves.toBeUndefined();
    });
});
