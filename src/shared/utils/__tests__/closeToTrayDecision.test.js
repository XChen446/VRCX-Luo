import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveClosePromptResponse } = require(
    '../../../../src-electron/closeToTrayDecision.cjs'
);

describe('resolveClosePromptResponse', () => {
    test('cancelling the prompt keeps the app open and does not persist a preference', () => {
        expect(resolveClosePromptResponse(2, true)).toEqual({
            action: 'cancel',
            persistPreference: false,
            closeToTrayEnabled: false
        });
    });
});
