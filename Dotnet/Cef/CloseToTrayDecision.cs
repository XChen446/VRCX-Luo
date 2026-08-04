namespace VRCX
{
    public enum CloseToTrayPromptResult
    {
        Cancel,
        MinimizeToTray,
        Exit
    }

    public readonly struct CloseToTrayPromptDecision
    {
        public bool CancelClose { get; }
        public bool MinimizeToTray { get; }
        public bool ShouldPersistPreference { get; }
        public bool CloseToTrayEnabled { get; }

        public CloseToTrayPromptDecision(
            bool cancelClose,
            bool minimizeToTray,
            bool shouldPersistPreference,
            bool closeToTrayEnabled
        )
        {
            CancelClose = cancelClose;
            MinimizeToTray = minimizeToTray;
            ShouldPersistPreference = shouldPersistPreference;
            CloseToTrayEnabled = closeToTrayEnabled;
        }
    }

    public static class CloseToTrayDecision
    {
        public static CloseToTrayPromptDecision Resolve(
            CloseToTrayPromptResult result,
            bool dontAskAgain
        )
        {
            return result switch
            {
                CloseToTrayPromptResult.Cancel => new CloseToTrayPromptDecision(
                    cancelClose: true,
                    minimizeToTray: false,
                    shouldPersistPreference: false,
                    closeToTrayEnabled: false
                ),
                CloseToTrayPromptResult.MinimizeToTray =>
                    new CloseToTrayPromptDecision(
                        cancelClose: false,
                        minimizeToTray: true,
                        shouldPersistPreference: dontAskAgain,
                        closeToTrayEnabled: true
                    ),
                _ => new CloseToTrayPromptDecision(
                    cancelClose: false,
                    minimizeToTray: false,
                    shouldPersistPreference: dontAskAgain,
                    closeToTrayEnabled: false
                )
            };
        }
    }
}
