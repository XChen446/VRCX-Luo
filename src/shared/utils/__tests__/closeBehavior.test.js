import {
    CLOSE_BEHAVIOR,
    getCloseBehaviorSettings,
    resolveCloseBehavior
} from '../closeBehavior';

describe('close behavior settings', () => {
    test.each([
        [true, false, CLOSE_BEHAVIOR.TRAY],
        [true, true, CLOSE_BEHAVIOR.TRAY],
        [false, true, CLOSE_BEHAVIOR.ASK],
        [false, false, CLOSE_BEHAVIOR.EXIT]
    ])(
        'maps closeToTray=%s and prompt=%s to %s',
        (closeToTray, promptBeforeClosing, expected) => {
            expect(resolveCloseBehavior(closeToTray, promptBeforeClosing)).toBe(
                expected
            );
        }
    );

    test.each([
        [CLOSE_BEHAVIOR.TRAY, true, false],
        [CLOSE_BEHAVIOR.ASK, false, true],
        [CLOSE_BEHAVIOR.EXIT, false, false]
    ])(
        'maps %s to native storage values',
        (behavior, closeToTray, promptBeforeClosing) => {
            expect(getCloseBehaviorSettings(behavior)).toEqual({
                closeToTray,
                promptBeforeClosing
            });
        }
    );
});
