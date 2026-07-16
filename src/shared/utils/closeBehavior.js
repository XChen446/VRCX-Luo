export const CLOSE_BEHAVIOR = Object.freeze({
    ASK: 'ask',
    TRAY: 'tray',
    EXIT: 'exit'
});

export function resolveCloseBehavior(closeToTray, promptBeforeClosing) {
    if (closeToTray) {
        return CLOSE_BEHAVIOR.TRAY;
    }
    if (promptBeforeClosing) {
        return CLOSE_BEHAVIOR.ASK;
    }
    return CLOSE_BEHAVIOR.EXIT;
}

export function getCloseBehaviorSettings(behavior) {
    return {
        closeToTray: behavior === CLOSE_BEHAVIOR.TRAY,
        promptBeforeClosing: behavior === CLOSE_BEHAVIOR.ASK
    };
}
