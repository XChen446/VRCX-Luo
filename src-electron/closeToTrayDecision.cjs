// Mirror of the button order used in main.js dialog.showMessageBox:
// buttons: ['最小化到托盘', '直接退出', '取消']
const MINIMIZE_TO_TRAY = 0;
const CANCEL = 2;

function resolveClosePromptResponse(response, checkboxChecked) {
    if (response === CANCEL) {
        return {
            action: 'cancel',
            persistPreference: false,
            closeToTrayEnabled: false
        };
    }

    return {
        action: response === MINIMIZE_TO_TRAY ? 'minimize' : 'exit',
        persistPreference: checkboxChecked,
        closeToTrayEnabled: response === MINIMIZE_TO_TRAY
    };
}

module.exports = { resolveClosePromptResponse };
