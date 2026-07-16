function resolveClosePromptResponse(response, checkboxChecked) {
    if (response === 2) {
        return {
            action: 'cancel',
            persistPreference: false,
            closeToTrayEnabled: false
        };
    }

    return {
        action: response === 0 ? 'minimize' : 'exit',
        persistPreference: checkboxChecked,
        closeToTrayEnabled: response === 0
    };
}

module.exports = { resolveClosePromptResponse };
