import { reactive, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { toast } from 'vue-sonner';
import { useI18n } from 'vue-i18n';

import { logWebRequest } from '../../services/appConfig';
import { database } from '../../services/database';
import { pushFromSqlite } from '../../services/database/pushEngine.js';
import { pullToSqlite as runPullToSqlite } from '../../services/database/pullEngine.js';
import {
    adapter,
    createAdapter
} from '../../services/database/adapter/index.js';
import { bootDbConfig } from '../../plugins/interopApi.js';
import { languageCodes } from '../../localization';
import { useGameStore } from '../game';
import { useModalStore } from '../modal';
import { useUpdateLoopStore } from '../updateLoop';
import { useVRCXUpdaterStore } from '../vrcxUpdater';
import { useVrcxStore } from '../vrcx';
import { watchState } from '../../services/watchState';

import configRepository from '../../services/config';
import webApiService from '../../services/webapi';

export const useAdvancedSettingsStore = defineStore('AdvancedSettings', () => {
    const gameStore = useGameStore();
    const vrcxStore = useVrcxStore();
    const VRCXUpdaterStore = useVRCXUpdaterStore();
    const modalStore = useModalStore();
    const updateLoopStore = useUpdateLoopStore();

    const { t } = useI18n();

    const state = reactive({
        folderSelectorDialogVisible: false
    });

    const enablePrimaryPassword = ref(false);
    const bioLanguage = ref('en');
    const relaunchVRChatAfterCrash = ref(false);
    const vrcQuitFix = ref(true);
    const autoSweepVRChatCache = ref(false);
    const selfInviteOverride = ref(false);
    const saveInstancePrints = ref(false);
    const cropInstancePrints = ref(false);
    const saveInstanceStickers = ref(false);
    const avatarRemoteDatabase = ref(true);
    const enableAppLauncher = ref(true);
    const enableAppLauncherAutoClose = ref(true);
    const enableAppLauncherRunProcessOnce = ref(true);
    const screenshotHelper = ref(true);
    const screenshotHelperModifyFilename = ref(false);
    const screenshotHelperCopyToClipboard = ref(false);
    const youTubeApi = ref(false);
    const youTubeApiKey = ref('');
    const translationApi = ref(false);
    const translationApiKey = ref('');
    const translationApiType = ref('google'); // 'google' | 'openai'
    const translationApiEndpoint = ref(
        'https://api.openai.com/v1/chat/completions'
    );
    const translationApiModel = ref('gpt-4o-mini');
    const translationApiPrompt = ref('');
    const progressPie = ref(false);
    const progressPieFilter = ref(true);
    const showConfirmationOnSwitchAvatar = ref(false);
    const gameLogDisabled = ref(false);
    const sqliteTableSizes = ref({});
    const avatarAutoCleanup = ref('Off');
    const purgeInProgress = ref(false);
    const ugcFolderPath = ref('');
    const autoDeleteOldPrints = ref(false);
    const notificationOpacity = ref(100);
    const currentUserInventory = reactive(new Map());
    const isVRChatConfigDialogVisible = ref(false);
    const saveInstanceEmoji = ref(false);
    const vrcRegistryAutoBackup = ref(true);
    const vrcRegistryAskRestore = ref(true);
    const sentryErrorReporting = ref(false);
    const autoJoinGroupCertification = ref(true);

    // ── Phase 9 §6.2 — Database engine selection + SQLite → remote migration ──
    /** @type {import('vue').Ref<'sqlite'|'postgresql'|'mysql'>} */
    const databaseEngine = ref('sqlite');
    const pgsqlHost = ref('localhost');
    const pgsqlPort = ref(5432);
    const pgsqlUsername = ref('vrcx');
    const pgsqlPassword = ref('');
    const pgsqlDatabase = ref('vrcx');
    /** @type {import('vue').Ref<'idle'|'testing'|'connected'|'failed'>} */
    const pgsqlConnectionStatus = ref('idle');
    /** @type {import('vue').Ref<'idle'|'pushing'|'done'|'failed'>} */
    const pgsqlPushStatus = ref('idle');
    // MySQL/MariaDB connection refs — mirror the PgSQL set so the Advanced tab
    // can render a symmetric form + migration control. Default port 3306 is the
    // MySQL/MariaDB convention; the database name defaults to 'vrcx' to match
    // the PgSQL default + the CI test fixture (`MYSQL_TEST_DATABASE: vrcx_test`).
    const mysqlHost = ref('localhost');
    const mysqlPort = ref(3306);
    const mysqlUsername = ref('root');
    const mysqlPassword = ref('');
    const mysqlDatabase = ref('vrcx');
    /** @type {import('vue').Ref<'idle'|'testing'|'connected'|'failed'>} */
    const mysqlConnectionStatus = ref('idle');
    // SQLite database file path. Persisted to VRCX_Database.name (which IS the
    // path field for sqlite mode — there is no separate sqlitePath key). An
    // empty value means "use the default AppData location" (handled by the C#
    // SQLite.Init / ResolveDatabasePath fallback).
    /** @type {import('vue').Ref<string>} */
    const sqlitePath = ref('');
    /** @type {import('vue').Ref<'idle'|'testing'|'connected'|'failed'>} */
    const sqliteConnectionStatus = ref('idle');
    /** @type {import('vue').Ref<string>} */
    const sqliteConnectionError = ref('');
    /** @type {import('vue').Ref<'idle'|'pushing'|'done'|'failed'>} */
    const mysqlPushStatus = ref('idle');
    // Remote → SQLite pull status. Mirrors the push status refs so the
    // Advanced tab can surface a progress indicator + outcome the same way.
    // Pull is non-destructive (read-only on the remote source, write to a
    // user-chosen NEW .sqlite3 file), so the status only reflects the copy
    // operation, not any engine switch.
    /** @type {import('vue').Ref<'idle'|'pulling'|'done'|'failed'>} */
    const pullStatus = ref('idle');

    watch(
        () => watchState.isLoggedIn,
        () => {
            currentUserInventory.clear();
            isVRChatConfigDialogVisible.value = false;
        },
        { flush: 'sync' }
    );

    async function initAdvancedSettings() {
        const [
            enablePrimaryPasswordConfig,
            bioLanguageConfig,
            relaunchVRChatAfterCrashConfig,
            vrcQuitFixConfig,
            autoSweepVRChatCacheConfig,
            selfInviteOverrideConfig,
            saveInstancePrintsConfig,
            cropInstancePrintsConfig,
            saveInstanceStickersConfig,
            avatarRemoteDatabaseConfig,
            enableAppLauncherConfig,
            enableAppLauncherAutoCloseConfig,
            enableAppLauncherRunProcessOnceConfig,
            screenshotHelperConfig,
            screenshotHelperModifyFilenameConfig,
            screenshotHelperCopyToClipboardConfig,
            youTubeApiConfig,
            youTubeApiKeyConfig,
            translationApiConfig,
            translationApiKeyConfig,
            translationApiTypeConfig,
            translationApiEndpointConfig,
            translationApiModelConfig,
            translationApiPromptConfig,
            progressPieConfig,
            progressPieFilterConfig,
            showConfirmationOnSwitchAvatarConfig,
            gameLogDisabledConfig,
            avatarAutoCleanupConfig,
            ugcFolderPathConfig,
            autoDeleteOldPrintsConfig,
            notificationOpacityConfig,
            saveInstanceEmojiConfig,
            vrcRegistryAutoBackupConfig,
            vrcRegistryAskRestoreConfig,
            sentryErrorReportingConfig,
            autoJoinGroupCertificationConfig
        ] = await Promise.all([
            configRepository.getBool('enablePrimaryPassword', false),
            configRepository.getString('VRCX_bioLanguage'),
            configRepository.getBool('VRCX_relaunchVRChatAfterCrash', false),
            configRepository.getBool('VRCX_vrcQuitFix', true),
            configRepository.getBool('VRCX_autoSweepVRChatCache', false),
            configRepository.getBool('VRCX_selfInviteOverride', false),
            configRepository.getBool('VRCX_saveInstancePrints', false),
            configRepository.getBool('VRCX_cropInstancePrints', false),
            configRepository.getBool('VRCX_saveInstanceStickers', false),
            configRepository.getBool('VRCX_avatarRemoteDatabase', true),
            configRepository.getBool('VRCX_enableAppLauncher', true),
            configRepository.getBool('VRCX_enableAppLauncherAutoClose', true),
            configRepository.getBool(
                'VRCX_enableAppLauncherRunProcessOnce',
                true
            ),
            configRepository.getBool('VRCX_screenshotHelper', true),
            configRepository.getBool(
                'VRCX_screenshotHelperModifyFilename',
                false
            ),
            configRepository.getBool(
                'VRCX_screenshotHelperCopyToClipboard',
                false
            ),
            configRepository.getBool('VRCX_youtubeAPI', false),
            configRepository.getString('VRCX_youtubeAPIKey', ''),
            configRepository.getBool('VRCX_translationAPI', false),
            configRepository.getString('VRCX_translationAPIKey', ''),
            configRepository.getString('VRCX_translationAPIType', 'google'),
            configRepository.getString('VRCX_translationAPIEndpoint', ''),
            configRepository.getString('VRCX_translationAPIModel', ''),
            configRepository.getString('VRCX_translationAPIPrompt', ''),
            configRepository.getBool('VRCX_progressPie', false),
            configRepository.getBool('VRCX_progressPieFilter', true),
            configRepository.getBool(
                'VRCX_showConfirmationOnSwitchAvatar',
                false
            ),
            configRepository.getBool('VRCX_gameLogDisabled', false),
            configRepository.getString('VRCX_avatarAutoCleanup', 'Off'),
            configRepository.getString('VRCX_userGeneratedContentPath', ''),
            configRepository.getBool('VRCX_autoDeleteOldPrints', false),
            configRepository.getFloat('VRCX_notificationOpacity', 100),
            configRepository.getBool('VRCX_saveInstanceEmoji', false),
            configRepository.getBool('VRCX_vrcRegistryAutoBackup', true),
            configRepository.getBool('VRCX_vrcRegistryAskRestore', true),
            configRepository.getString('VRCX_SentryEnabled', ''),
            configRepository.getBool('VRCX_autoJoinGroupCertification', true)
        ]);

        if (!bioLanguageConfig || !languageCodes.includes(bioLanguageConfig)) {
            bioLanguage.value = 'en';
        } else {
            bioLanguage.value = bioLanguageConfig;
        }

        enablePrimaryPassword.value = enablePrimaryPasswordConfig;
        relaunchVRChatAfterCrash.value = relaunchVRChatAfterCrashConfig;
        vrcQuitFix.value = vrcQuitFixConfig;
        autoSweepVRChatCache.value = autoSweepVRChatCacheConfig;
        selfInviteOverride.value = selfInviteOverrideConfig;
        saveInstancePrints.value = saveInstancePrintsConfig;
        cropInstancePrints.value = cropInstancePrintsConfig;
        saveInstanceStickers.value = saveInstanceStickersConfig;
        avatarRemoteDatabase.value = avatarRemoteDatabaseConfig;
        enableAppLauncher.value = enableAppLauncherConfig;
        enableAppLauncherAutoClose.value = enableAppLauncherAutoCloseConfig;
        enableAppLauncherRunProcessOnce.value =
            enableAppLauncherRunProcessOnceConfig;
        screenshotHelper.value = screenshotHelperConfig;
        screenshotHelperModifyFilename.value =
            screenshotHelperModifyFilenameConfig;
        screenshotHelperCopyToClipboard.value =
            screenshotHelperCopyToClipboardConfig;
        youTubeApi.value = youTubeApiConfig;
        youTubeApiKey.value = youTubeApiKeyConfig;
        translationApi.value = translationApiConfig;
        translationApiKey.value = translationApiKeyConfig;
        translationApiType.value = translationApiTypeConfig;
        translationApiEndpoint.value = translationApiEndpointConfig;
        translationApiModel.value = translationApiModelConfig;
        translationApiPrompt.value = translationApiPromptConfig;
        progressPie.value = progressPieConfig;
        progressPieFilter.value = progressPieFilterConfig;
        showConfirmationOnSwitchAvatar.value =
            showConfirmationOnSwitchAvatarConfig;
        gameLogDisabled.value = gameLogDisabledConfig;
        avatarAutoCleanup.value = avatarAutoCleanupConfig;
        ugcFolderPath.value = ugcFolderPathConfig;
        autoDeleteOldPrints.value = autoDeleteOldPrintsConfig;
        notificationOpacity.value = notificationOpacityConfig;
        saveInstanceEmoji.value = saveInstanceEmojiConfig;
        vrcRegistryAutoBackup.value = vrcRegistryAutoBackupConfig;
        vrcRegistryAskRestore.value = vrcRegistryAskRestoreConfig;
        sentryErrorReporting.value = sentryErrorReportingConfig === 'true';
        autoJoinGroupCertification.value = autoJoinGroupCertificationConfig;

        handleSetAppLauncherSettings();

        setTimeout(() => {
            if (
                VRCXUpdaterStore.branch === 'Nightly' &&
                sentryErrorReportingConfig === ''
            ) {
                checkSentryConsent();
            }
        }, 2000);
    }

    initAdvancedSettings();

    /**
     * @param {boolean} value
     */
    function setEnablePrimaryPasswordConfigRepository(value) {
        configRepository.setBool('enablePrimaryPassword', value);
    }

    /**
     * @param {boolean} value
     */
    function setEnablePrimaryPassword(value) {
        enablePrimaryPassword.value = value;
    }
    function setRelaunchVRChatAfterCrash() {
        relaunchVRChatAfterCrash.value = !relaunchVRChatAfterCrash.value;
        configRepository.setBool(
            'VRCX_relaunchVRChatAfterCrash',
            relaunchVRChatAfterCrash.value
        );
    }
    function setVrcQuitFix() {
        vrcQuitFix.value = !vrcQuitFix.value;
        configRepository.setBool('VRCX_vrcQuitFix', vrcQuitFix.value);
    }
    function setAutoSweepVRChatCache() {
        autoSweepVRChatCache.value = !autoSweepVRChatCache.value;
        configRepository.setBool(
            'VRCX_autoSweepVRChatCache',
            autoSweepVRChatCache.value
        );
    }
    function setSelfInviteOverride() {
        selfInviteOverride.value = !selfInviteOverride.value;
        configRepository.setBool(
            'VRCX_selfInviteOverride',
            selfInviteOverride.value
        );
    }
    function setSaveInstancePrints() {
        saveInstancePrints.value = !saveInstancePrints.value;
        configRepository.setBool(
            'VRCX_saveInstancePrints',
            saveInstancePrints.value
        );
    }
    function setCropInstancePrints() {
        cropInstancePrints.value = !cropInstancePrints.value;
        configRepository.setBool(
            'VRCX_cropInstancePrints',
            cropInstancePrints.value
        );
        cropPrintsChanged();
    }
    function setSaveInstanceStickers() {
        saveInstanceStickers.value = !saveInstanceStickers.value;
        configRepository.setBool(
            'VRCX_saveInstanceStickers',
            saveInstanceStickers.value
        );
    }
    /**
     * @param {boolean} value
     */
    function setAvatarRemoteDatabase(value) {
        avatarRemoteDatabase.value = value;
        configRepository.setBool(
            'VRCX_avatarRemoteDatabase',
            avatarRemoteDatabase.value
        );
    }
    async function setEnableAppLauncher() {
        enableAppLauncher.value = !enableAppLauncher.value;
        await configRepository.setBool(
            'VRCX_enableAppLauncher',
            enableAppLauncher.value
        );
        handleSetAppLauncherSettings();
    }
    async function setEnableAppLauncherAutoClose() {
        enableAppLauncherAutoClose.value = !enableAppLauncherAutoClose.value;
        await configRepository.setBool(
            'VRCX_enableAppLauncherAutoClose',
            enableAppLauncherAutoClose.value
        );
        handleSetAppLauncherSettings();
    }
    async function setEnableAppLauncherRunProcessOnce() {
        enableAppLauncherRunProcessOnce.value =
            !enableAppLauncherRunProcessOnce.value;
        await configRepository.setBool(
            'VRCX_enableAppLauncherRunProcessOnce',
            enableAppLauncherRunProcessOnce.value
        );
        handleSetAppLauncherSettings();
    }
    async function setScreenshotHelper() {
        screenshotHelper.value = !screenshotHelper.value;
        await configRepository.setBool(
            'VRCX_screenshotHelper',
            screenshotHelper.value
        );
    }
    async function setScreenshotHelperModifyFilename() {
        screenshotHelperModifyFilename.value =
            !screenshotHelperModifyFilename.value;
        await configRepository.setBool(
            'VRCX_screenshotHelperModifyFilename',
            screenshotHelperModifyFilename.value
        );
    }
    async function setScreenshotHelperCopyToClipboard() {
        screenshotHelperCopyToClipboard.value =
            !screenshotHelperCopyToClipboard.value;
        await configRepository.setBool(
            'VRCX_screenshotHelperCopyToClipboard',
            screenshotHelperCopyToClipboard.value
        );
    }
    async function setYouTubeApi() {
        youTubeApi.value = !youTubeApi.value;
        await configRepository.setBool('VRCX_youtubeAPI', youTubeApi.value);
    }
    async function setTranslationApi() {
        translationApi.value = !translationApi.value;
        await configRepository.setBool(
            'VRCX_translationAPI',
            translationApi.value
        );
    }
    /**
     * @param {string} value
     */
    async function setYouTubeApiKey(value) {
        youTubeApiKey.value = value;
        await configRepository.setString(
            'VRCX_youtubeAPIKey',
            youTubeApiKey.value
        );
    }
    async function setTranslationApiKey(value) {
        translationApiKey.value = value;
        await configRepository.setString(
            'VRCX_translationAPIKey',
            translationApiKey.value
        );
    }
    async function setTranslationApiType(value) {
        translationApiType.value = value || 'google';
        await configRepository.setString(
            'VRCX_translationAPIType',
            translationApiType.value
        );
    }
    async function setTranslationApiEndpoint(value) {
        translationApiEndpoint.value = value;
        await configRepository.setString(
            'VRCX_translationAPIEndpoint',
            translationApiEndpoint.value
        );
    }
    async function setTranslationApiModel(value) {
        translationApiModel.value = value;
        await configRepository.setString(
            'VRCX_translationAPIModel',
            translationApiModel.value
        );
    }
    async function setTranslationApiPrompt(value) {
        translationApiPrompt.value = value;
        await configRepository.setString(
            'VRCX_translationAPIPrompt',
            translationApiPrompt.value
        );
    }

    async function fetchAvailableModels(overrides = {}) {
        const baseURL = overrides.endpoint || translationApiEndpoint.value;

        if (!baseURL) {
            toast.warning('Translation endpoint not configured');
            return [];
        }

        let modelsURL = '';
        try {
            const url = new URL(baseURL);
            const basePath = url.pathname.replace(/\/+$/, '');

            if (basePath.endsWith('/chat/completions')) {
                url.pathname = basePath.replace(
                    /\/chat\/completions$/,
                    '/models'
                );
            } else if (basePath.endsWith('/models')) {
                url.pathname = basePath;
            } else {
                url.pathname = `${basePath}/models`;
            }

            url.search = '';
            url.hash = '';
            modelsURL = url.toString();
        } catch {
            const normalizedBaseURL = baseURL.endsWith('/')
                ? baseURL.slice(0, -1)
                : baseURL;

            if (normalizedBaseURL.includes('/chat/completions')) {
                modelsURL = normalizedBaseURL.replace(
                    /\/chat\/completions$/,
                    '/models'
                );
            } else if (normalizedBaseURL.endsWith('/models')) {
                modelsURL = normalizedBaseURL;
            } else {
                modelsURL = `${normalizedBaseURL}/models`;
            }
        }

        const headers = {};
        const keyToUse = overrides.key ?? translationApiKey.value;
        if (keyToUse) {
            headers.Authorization = `Bearer ${keyToUse}`;
        }

        try {
            const response = await webApiService.execute({
                url: modelsURL,
                method: 'GET',
                headers
            });

            if (response.status !== 200) {
                throw new Error(
                    `Failed to fetch models: ${response.status} - ${response.data}`
                );
            }

            const data = JSON.parse(response.data);
            logWebRequest(
                '[EXTERNAL GET]',
                modelsURL,
                `(${response.status})`,
                data
            );

            if (data.data && Array.isArray(data.data)) {
                return data.data
                    .map((model) => model.id)
                    .filter((id) => id && typeof id === 'string')
                    .sort();
            }

            if (Array.isArray(data)) {
                return data
                    .map((model) => model.id || model.name)
                    .filter((id) => id && typeof id === 'string')
                    .sort();
            }

            throw new Error('Unexpected API response format');
        } catch (error) {
            console.error('Failed to fetch models:', error);
            toast.error(`Failed to fetch models: ${error.message}`);
            return [];
        }
    }

    function setBioLanguage(language) {
        bioLanguage.value = language;
        configRepository.setString('VRCX_bioLanguage', language);
    }
    async function setProgressPie() {
        progressPie.value = !progressPie.value;
        await configRepository.setBool('VRCX_progressPie', progressPie.value);
    }
    async function setProgressPieFilter() {
        progressPieFilter.value = !progressPieFilter.value;
        await configRepository.setBool(
            'VRCX_progressPieFilter',
            progressPieFilter.value
        );
    }
    async function setShowConfirmationOnSwitchAvatar() {
        showConfirmationOnSwitchAvatar.value =
            !showConfirmationOnSwitchAvatar.value;
        await configRepository.setBool(
            'VRCX_showConfirmationOnSwitchAvatar',
            showConfirmationOnSwitchAvatar.value
        );
    }
    async function setGameLogDisabled() {
        gameLogDisabled.value = !gameLogDisabled.value;
        await configRepository.setBool(
            'VRCX_gameLogDisabled',
            gameLogDisabled.value
        );
    }

    async function setAvatarAutoCleanup(value) {
        avatarAutoCleanup.value = value;
        await configRepository.setString('VRCX_avatarAutoCleanup', value);
    }

    /**
     * @param {number|null} days - Number of days to keep. Null means delete all.
     */
    async function purgeAvatarFeedData(days) {
        let cutoffDate = null;
        if (days !== null) {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - days);
            cutoffDate = cutoff.toJSON();
        }

        purgeInProgress.value = true;
        const msgBox = toast.warning(
            t(
                'view.settings.advanced.advanced.database_cleanup.purge_in_progress'
            ),
            { duration: Infinity }
        );

        try {
            await database.purgeAvatarFeedData(cutoffDate);
            await database.vacuum();
            toast.dismiss(msgBox);
            toast.success(
                t(
                    'view.settings.advanced.advanced.database_cleanup.purge_complete'
                )
            );
            // Brief delay before restart to show success message
            await new Promise((resolve) => setTimeout(resolve, 1500));
            VRCXUpdaterStore.restartVRCX(false);
        } catch (err) {
            console.error(err);
            toast.dismiss(msgBox);
            toast.error(
                t(
                    'view.settings.advanced.advanced.database_cleanup.purge_failed',
                    { error: err }
                )
            );
        } finally {
            purgeInProgress.value = false;
        }
    }

    /**
     * Run auto-cleanup on startup if configured and enough time has passed.
     * Reads config directly from configRepository to avoid race condition
     * with initAdvancedSettings not having completed yet.
     * @param {string} userId - Current user ID for per-user cleanup tracking.
     */
    async function runAvatarAutoCleanup(userId) {
        const cleanupSetting = await configRepository.getString(
            'VRCX_avatarAutoCleanup',
            'Off'
        );
        if (cleanupSetting === 'Off') return;

        const configKey = `VRCX_lastAvatarCleanupDate_${userId}`;
        const lastCleanupStr = await configRepository.getString(configKey, '');
        const now = new Date();

        if (lastCleanupStr) {
            const lastCleanup = new Date(lastCleanupStr);
            const daysSinceLastCleanup =
                (now.getTime() - lastCleanup.getTime()) / (1000 * 60 * 60 * 24);
            if (daysSinceLastCleanup < 7) return;
        }

        const days = parseInt(cleanupSetting, 10);
        if (isNaN(days) || days <= 0) return;

        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        const cutoffDate = cutoff.toJSON();

        try {
            await database.purgeAvatarFeedData(cutoffDate);
            await configRepository.setString(configKey, now.toJSON());
            console.log(
                `Auto-cleaned avatar feed data older than ${days} days`
            );
        } catch (err) {
            console.error('Avatar auto-cleanup failed:', err);
        }
    }

    async function setSaveInstanceEmoji() {
        saveInstanceEmoji.value = !saveInstanceEmoji.value;
        await configRepository.setBool(
            'VRCX_saveInstanceEmoji',
            saveInstanceEmoji.value
        );
    }

    async function setUGCFolderPath(path) {
        if (typeof path !== 'string') {
            path = '';
        }
        ugcFolderPath.value = path;
        await configRepository.setString('VRCX_userGeneratedContentPath', path);
    }

    async function setAutoDeleteOldPrints() {
        autoDeleteOldPrints.value = !autoDeleteOldPrints.value;
        await configRepository.setBool(
            'VRCX_autoDeleteOldPrints',
            autoDeleteOldPrints.value
        );
    }

    async function setNotificationOpacity(value) {
        notificationOpacity.value = value;
        await configRepository.setInt('VRCX_notificationOpacity', value);
    }

    async function setVrcRegistryAutoBackup() {
        vrcRegistryAutoBackup.value = !vrcRegistryAutoBackup.value;
        await configRepository.setBool(
            'VRCX_vrcRegistryAutoBackup',
            vrcRegistryAutoBackup.value
        );
    }

    async function setVrcRegistryAskRestore() {
        vrcRegistryAskRestore.value = !vrcRegistryAskRestore.value;
        await configRepository.setBool(
            'VRCX_vrcRegistryAskRestore',
            vrcRegistryAskRestore.value
        );
    }

    async function setAutoJoinGroupCertification() {
        autoJoinGroupCertification.value = !autoJoinGroupCertification.value;
        await configRepository.setBool(
            'VRCX_autoJoinGroupCertification',
            autoJoinGroupCertification.value
        );
    }

    async function checkSentryConsent() {
        modalStore
            .confirm({
                description: t(
                    'view.settings.advanced.advanced.anonymous_error_reporting.consent_description'
                ),
                title: t(
                    'view.settings.advanced.advanced.anonymous_error_reporting.consent_title'
                )
            })
            .then(async ({ ok }) => {
                if (!ok) return;
                modalStore
                    .confirm({
                        description: t(
                            'view.settings.advanced.advanced.anonymous_error_reporting.enabled_restart_description'
                        ),
                        title: t('confirm.restart_required_title'),
                        confirmText: t('confirm.restart_now'),
                        cancelText: t('confirm.restart_later')
                    })
                    .then(async ({ ok }) => {
                        if (!ok) return;

                        sentryErrorReporting.value = true;
                        configRepository.setBool('VRCX_SentryEnabled', true);

                        VRCXUpdaterStore.restartVRCX(false);
                    });
            });
    }

    async function setSentryErrorReporting() {
        if (VRCXUpdaterStore.branch !== 'Nightly') return;

        modalStore
            .confirm({
                description: t(
                    'view.settings.advanced.advanced.anonymous_error_reporting.disabled_restart_description'
                ),
                title: t('confirm.restart_required_title'),
                confirmText: t('confirm.restart_now'),
                cancelText: t('confirm.restart_later')
            })
            .then(async ({ ok }) => {
                if (!ok) return;

                sentryErrorReporting.value = !sentryErrorReporting.value;
                await configRepository.setBool(
                    'VRCX_SentryEnabled',
                    sentryErrorReporting.value
                );
                VRCXUpdaterStore.restartVRCX(false);
            });
    }

    async function getSqliteTableSizes() {
        const [
            gps,
            status,
            bio,
            avatar,
            onlineOffline,
            friendLogHistory,
            notification,
            location,
            joinLeave,
            portalSpawn,
            videoPlay,
            event,
            external
        ] = await Promise.all([
            database.getGpsTableSize(),
            database.getStatusTableSize(),
            database.getBioTableSize(),
            database.getAvatarTableSize(),
            database.getOnlineOfflineTableSize(),
            database.getFriendLogHistoryTableSize(),
            database.getNotificationTableSize(),
            database.getLocationTableSize(),
            database.getJoinLeaveTableSize(),
            database.getPortalSpawnTableSize(),
            database.getVideoPlayTableSize(),
            database.getEventTableSize(),
            database.getExternalTableSize()
        ]);

        sqliteTableSizes.value = {
            gps,
            status,
            bio,
            avatar,
            onlineOffline,
            friendLogHistory,
            notification,
            location,
            joinLeave,
            portalSpawn,
            videoPlay,
            event,
            external
        };
    }

    function handleSetAppLauncherSettings() {
        AppApi.SetAppLauncherSettings(
            enableAppLauncher.value,
            enableAppLauncherAutoClose.value,
            enableAppLauncherRunProcessOnce.value
        );
    }

    /**
     * @param {string} videoId
     */
    async function lookupYouTubeVideo(videoId) {
        if (!youTubeApiKey.value) {
            console.warn('no Youtube API key configured');
            return null;
        }
        let data = null;
        let apiKey = '';
        if (youTubeApiKey.value) {
            apiKey = youTubeApiKey.value;
        }
        try {
            const url = `https://www.googleapis.com/youtube/v3/videos?id=${encodeURIComponent(
                videoId
            )}&part=snippet,contentDetails&key=${apiKey}`;
            const response = await webApiService.execute({
                url,
                method: 'GET',
                headers: {
                    Referer: 'https://vrcx.app'
                }
            });
            const json = JSON.parse(response.data);
            logWebRequest('[EXTERNAL GET]', url, `(${response.status})`, json);
            if (response.status === 200) {
                data = json;
            } else {
                throw new Error(`Error: ${response.data}`);
            }
        } catch {
            console.error(`YouTube video lookup failed for ${videoId}`);
        }
        return data;
    }

    async function translateText(text, targetLang, overrides) {
        if (!translationApi.value) {
            toast.warning('Translation API disabled');
            return null;
        }

        const provider =
            overrides?.type || translationApiType.value || 'google';

        if (provider === 'google') {
            const keyToUse = overrides?.key ?? translationApiKey.value;
            if (!keyToUse) {
                toast.warning('No Translation API key configured');
                return null;
            }
            try {
                const url = `https://translation.googleapis.com/language/translate/v2?key=${keyToUse}`;
                const response = await webApiService.execute({
                    url,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Referer: 'https://vrcx.app'
                    },
                    body: JSON.stringify({
                        q: text,
                        target: targetLang,
                        format: 'text'
                    })
                });
                if (response.status !== 200) {
                    throw new Error(
                        `Translation API error: ${response.status} - ${response.data}`
                    );
                }
                const data = JSON.parse(response.data);
                logWebRequest(
                    '[EXTERNAL POST]',
                    url,
                    `(${response.status})`,
                    data
                );
                return data.data.translations[0].translatedText;
            } catch (err) {
                toast.error(`Translation failed: ${err.message}`);
                return null;
            }
        }

        const endpoint =
            overrides?.endpoint ||
            translationApiEndpoint.value ||
            'https://api.openai.com/v1/chat/completions';
        const model =
            overrides?.model || translationApiModel.value || 'gpt-5.1';
        const prompt =
            overrides?.prompt ||
            translationApiPrompt.value ||
            `You are a translation assistant. Translate the user message into ${targetLang}. Only return the translated text.`;

        if (!endpoint || !model) {
            toast.warning('Translation endpoint/model missing');
            return null;
        }

        const headers = {
            'Content-Type': 'application/json',
            Referer: 'https://vrcx.app',
            'HTTP-Referer': 'https://vrcx.app',
            'X-Title': 'VRCX'
        };
        const keyToUse = overrides?.key ?? translationApiKey.value;
        if (keyToUse) {
            headers.Authorization = `Bearer ${keyToUse}`;
        }

        try {
            const response = await webApiService.execute({
                url: endpoint,
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model,
                    messages: [
                        {
                            role: 'system',
                            content: prompt
                        },
                        {
                            role: 'user',
                            content: text
                        }
                    ]
                })
            });

            if (response.status !== 200) {
                throw new Error(
                    `Translation API error: ${response.status} - ${response.data}`
                );
            }

            const data = JSON.parse(response.data);
            logWebRequest(
                '[EXTERNAL POST]',
                endpoint,
                `(${response.status})`,
                data
            );

            const translated = data?.choices?.[0]?.message?.content;
            return typeof translated === 'string' ? translated.trim() : null;
        } catch (err) {
            toast.error(`Translation failed`);
            return null;
        }
    }

    function cropPrintsChanged() {
        if (!cropInstancePrints.value) return;
        modalStore
            .confirm({
                description: t(
                    'view.settings.advanced.advanced.save_instance_prints_to_file.crop_convert_old'
                ),
                title: '',
                confirmText: t(
                    'view.settings.advanced.advanced.save_instance_prints_to_file.crop_convert_old_confirm'
                ),
                cancelText: t(
                    'view.settings.advanced.advanced.save_instance_prints_to_file.crop_convert_old_cancel'
                )
            })
            .then(async ({ ok }) => {
                if (!ok) return;
                const msgBox = toast.warning(
                    'Batch print cropping in progress...',
                    { duration: Infinity, position: 'bottom-right' }
                );
                try {
                    await AppApi.CropAllPrints(ugcFolderPath.value);
                    toast.success('Batch print cropping complete');
                } catch (err) {
                    console.error(err);
                    toast.error(`Batch print cropping failed: ${err}`);
                } finally {
                    toast.dismiss(msgBox);
                }
            })
            .catch(() => {});
    }

    function askDeleteAllScreenshotMetadata() {
        modalStore
            .confirm({
                description: t(
                    'view.settings.advanced.advanced.delete_all_screenshot_metadata.ask'
                ),
                title: '',
                confirmText: t(
                    'view.settings.advanced.advanced.delete_all_screenshot_metadata.confirm_yes'
                ),
                cancelText: t(
                    'view.settings.advanced.advanced.delete_all_screenshot_metadata.confirm_no'
                )
            })
            .then(({ ok }) => {
                if (!ok) return;
                deleteAllScreenshotMetadata();
            })
            .catch(() => {});
    }

    function deleteAllScreenshotMetadata() {
        modalStore
            .confirm({
                description: t(
                    'view.settings.advanced.advanced.delete_all_screenshot_metadata.confirm'
                ),
                title: '',
                confirmText: t(
                    'view.settings.advanced.advanced.save_instance_prints_to_file.crop_convert_old_confirm'
                ),
                cancelText: t(
                    'view.settings.advanced.advanced.save_instance_prints_to_file.crop_convert_old_cancel'
                )
            })
            .then(async ({ ok }) => {
                if (!ok) return;
                const msgBox = toast.warning(
                    'Batch metadata removal in progress...',
                    { duration: Infinity, position: 'bottom-right' }
                );
                try {
                    await AppApi.DeleteAllScreenshotMetadata();
                    toast.success('Batch metadata removal complete');
                } catch (err) {
                    console.error(err);
                    toast.error(`Batch metadata removal failed: ${err}`);
                } finally {
                    toast.dismiss(msgBox);
                }
            })
            .catch(() => {});
    }

    function resetUGCFolder() {
        setUGCFolderPath('');
    }

    async function openUGCFolder() {
        if (LINUX && ugcFolderPath.value == null) {
            resetUGCFolder();
        }
        await AppApi.OpenUGCPhotosFolder(ugcFolderPath.value);
    }

    async function folderSelectorDialog(oldPath) {
        if (state.folderSelectorDialogVisible) return;
        if (!oldPath) {
            oldPath = '';
        }

        state.folderSelectorDialogVisible = true;
        let newFolder = '';
        if (WINDOWS) {
            newFolder = await AppApi.OpenFolderSelectorDialog(oldPath);
        } else {
            newFolder = await window.electron.openDirectoryDialog();
        }

        state.folderSelectorDialogVisible = false;
        return newFolder;
    }

    async function openUGCFolderSelector() {
        const path = await folderSelectorDialog(ugcFolderPath.value);
        await setUGCFolderPath(path);
    }

    async function showVRChatConfig() {
        isVRChatConfigDialogVisible.value = true;
        if (!gameStore.VRChatUsedCacheSize) {
            gameStore.getVRChatCacheSize();
        }
    }

    function promptAutoClearVRCXCacheFrequency() {
        modalStore
            .prompt({
                title: t('prompt.auto_clear_cache.header'),
                description: t('prompt.auto_clear_cache.description'),
                confirmText: t('prompt.auto_clear_cache.ok'),
                cancelText: t('prompt.auto_clear_cache.cancel'),
                inputValue: (
                    vrcxStore.clearVRCXCacheFrequency /
                    3600 /
                    2
                ).toString(),
                pattern: /\d+$/,
                errorMessage: t('prompt.auto_clear_cache.input_error')
            })
            .then(async ({ ok, value }) => {
                if (!ok) return;
                if (value && !isNaN(parseInt(value, 10))) {
                    vrcxStore.setClearVRCXCacheFrequency(
                        parseInt(value, 10) * 3600 * 2
                    );
                    updateLoopStore.setNextClearVRCXCacheCheck(
                        vrcxStore.clearVRCXCacheFrequency / 2
                    );
                    await configRepository.setString(
                        'VRCX_clearVRCXCacheFrequency',
                        vrcxStore.clearVRCXCacheFrequency.toString()
                    );
                }
            })
            .catch(() => {});
    }

    // ── Phase 9 §6.2 — Database engine config + migration actions ───────
    /**
     * Load the database engine configuration from VRCXStorage into the
     * reactive refs. Called once during AdvancedTab mount so the UI reflects
     * the persisted mode/host/port/etc.
     *
     * @returns {Promise<void>}
     */
    async function loadDatabaseEngineConfig() {
        try {
            const [mode, host, port, username, password, name] =
                await Promise.all([
                    VRCXStorage.Get('VRCX_Database.mode'),
                    VRCXStorage.Get('VRCX_Database.host'),
                    VRCXStorage.Get('VRCX_Database.port'),
                    VRCXStorage.Get('VRCX_Database.username'),
                    VRCXStorage.Get('VRCX_Database.password'),
                    VRCXStorage.Get('VRCX_Database.name')
                ]);
            const normalizedMode =
                mode === 'postgresql'
                    ? 'postgresql'
                    : mode === 'mysql' || mode === 'mariadb'
                      ? 'mysql'
                      : 'sqlite';
            databaseEngine.value = normalizedMode;
            // SQLite path is the single `VRCX_Database.name` field — there is
            // no separate sqlitePath key. In sqlite mode `name` holds the file
            // path (or is empty for the default AppData location); in remote
            // modes `name` holds the remote database name. Load it into the
            // matching ref so the UI shows the right value for each engine.
            if (normalizedMode === 'sqlite') {
                sqlitePath.value = name || '';
            } else if (name && !/[\\/]/.test(name) && !/\.db$/i.test(name)) {
                // Looks like a remote database name (no path separators, no
                // .db suffix) — adopt it into the matching remote ref.
                if (normalizedMode === 'postgresql') {
                    pgsqlDatabase.value = name;
                } else {
                    mysqlDatabase.value = name;
                }
            }
            pgsqlHost.value = host || 'localhost';
            pgsqlPort.value = Number(port) || 5432;
            pgsqlUsername.value = username || 'vrcx';
            pgsqlPassword.value = password || '';
            // MySQL uses the same shared VRCX_Database.* keys, so mirror host/
            // port/user/pass into the MySQL refs when the active mode is mysql.
            if (normalizedMode === 'mysql') {
                mysqlHost.value = host || 'localhost';
                mysqlPort.value = Number(port) || 3306;
                mysqlUsername.value = username || 'root';
                mysqlPassword.value = password || '';
            }
            // Reset the SQLite connection probe state on load — the path may
            // have changed since last mount and a stale status is misleading.
            sqliteConnectionStatus.value = 'idle';
            sqliteConnectionError.value = '';
        } catch (err) {
            console.warn('loadDatabaseEngineConfig failed:', err);
        }
    }

    /**
     * Persist the database engine configuration to VRCXStorage. The C# layer
     * reads these keys at startup to decide which engine to Init, so a
     * restart is required after switching engines.
     *
     * `VRCX_Database.name` is a single shared field whose meaning depends on
     * the engine: it is the SQLite file path in `sqlite` mode and the remote
     * database name in `postgresql`/`mysql` mode. This function writes the
     * correct value into `name` for the chosen engine and never touches the
     * remote connection keys (host/port/username/password) when the target is
     * sqlite, so switching back to SQLite cannot be corrupted by leftover
     * remote values.
     *
     * @param {string} engine - 'sqlite' | 'postgresql' | 'mysql' | 'mariadb'
     * @param {{host?: string, port?: number, username?: string, password?: string, database?: string}} [remoteConfig]
     *   remote engine config; REQUIRED for `postgresql`/`mysql`, ignored for
     *   `sqlite`. Pass `null`/`undefined` for sqlite (the sqlite path comes
     *   from `sqlitePath` ref / caller).
     * @param {object} [opts] - extra options.
     * @param {string} [opts.sqlitePath] - SQLite file path to persist as
     *   `VRCX_Database.name` when `engine === 'sqlite'`. When omitted for
     *   sqlite, the current `sqlitePath` ref value is used (may be empty →
     *   C# falls back to the default AppData location).
     * @returns {Promise<void>}
     */
    async function saveDatabaseEngineConfig(engine, remoteConfig, opts = {}) {
        const normalizedEngine =
            engine === 'mariadb' ? 'mysql' : /** @type {string} */ (engine);
        await VRCXStorage.Set('VRCX_Database.mode', normalizedEngine);
        if (normalizedEngine === 'sqlite') {
            // Persist the SQLite file path into the shared `name` field.
            // Do NOT touch host/port/username/password — leaving whatever was
            // there is harmless (C# SQLite.Init ignores them) and avoids any
            // risk of overwriting the path with a remote database name.
            const pathToSave =
                opts.sqlitePath !== undefined
                    ? opts.sqlitePath
                    : sqlitePath.value;
            await VRCXStorage.Set('VRCX_Database.name', pathToSave || '');
            return;
        }
        if (remoteConfig) {
            await Promise.all([
                VRCXStorage.Set('VRCX_Database.host', remoteConfig.host),
                VRCXStorage.Set(
                    'VRCX_Database.port',
                    String(remoteConfig.port)
                ),
                VRCXStorage.Set(
                    'VRCX_Database.username',
                    remoteConfig.username
                ),
                VRCXStorage.Set(
                    'VRCX_Database.password',
                    remoteConfig.password
                ),
                VRCXStorage.Set('VRCX_Database.name', remoteConfig.database)
            ]);
        }
    }

    /**
     * Probe the PostgreSQL backend health. Only meaningful when the app
     * *booted* in `postgresql` mode, because the C# `PostgreSQL.Instance`
     * is only `Init()`'d at startup when `VRCX_Database.mode ===
     * 'postgresql'` (Program.cs). The frontend singleton `adapter` is the
     * authoritative witness of the current boot's engine: its
     * `engineType` getter returns `'postgresql'` only when
     * `initAdapter('postgresql')` ran at startup. We therefore gate on
     * `adapter.engineType` — NOT on `VRCXStorage.Get('VRCX_Database.mode')`,
     * which the user may have just rewritten via `onDatabaseEngineChange`
     * without restarting. Gating on the storage value would let a stale
     * `mode === 'postgresql'` reach `PostgreSQL.GetHealth()` on a process
     * that never Init'd PG, returning a misleading "connection failed"
     * that hides the real cause (needs restart).
     *
     * @returns {Promise<{connected: boolean, error?: string}>}
     */
    async function testPgsqlConnection() {
        pgsqlConnectionStatus.value = 'testing';
        try {
            // `adapter` is a live ESM binding, so it reflects whichever
            // adapter `initAdapter(mode)` constructed at startup. Reading
            // `VRCXStorage` here would be wrong — the user may have
            // switched the persisted mode without restarting.
            if (adapter?.engineType !== 'postgresql') {
                pgsqlConnectionStatus.value = 'failed';
                return {
                    connected: false,
                    error:
                        'VRCX is not running in postgresql mode this session. ' +
                        'Save the engine selection and restart VRCX, then test the connection again.'
                };
            }
            const health = await PostgreSQL.GetHealth?.();
            const parsed = health ? JSON.parse(health) : { connected: false };
            pgsqlConnectionStatus.value = parsed.connected
                ? 'connected'
                : 'failed';
            return parsed;
        } catch (err) {
            pgsqlConnectionStatus.value = 'failed';
            const msg = err.message || String(err);
            console.error('[testPgsqlConnection]', msg);
            return { connected: false, error: msg };
        }
    }

    /**
     * Probe the MySQL/MariaDB backend health. Symmetric to `testPgsqlConnection`:
     * both ultimately execute `SELECT 1` against the pooled data source via
     * the C# `Ping()` method, returning a real liveness result rather than
     * just an initialisation-state check. Only meaningful when the app
     * booted in `mysql`/`mariadb` mode (so `MySQL.Instance` is initialised);
     * in `sqlite` mode we can only report that a switch + restart is required.
     * Worst-case latency bounded by `ConnectionTimeout` (15s) when the
     * server is unreachable.
     *
     * @returns {Promise<{connected: boolean, error?: string}>}
     */
    async function testMysqlConnection() {
        mysqlConnectionStatus.value = 'testing';
        try {
            // Gate on the runtime adapter, not `VRCXStorage.mode`. See
            // `testPgsqlConnection` for the full rationale: the user may
            // have persisted `mysql`/`mariadb` without restarting, in
            // which case `MySQL.Instance` was never `Init()`'d this boot
            // and `MySQL.Ping` would attempt to connect with an empty
            // connection string, returning false for the wrong reason.
            // `MySQLAdapter.engineType` is `'mysql'` for both `mysql` and
            // `mariadb` modes (mariadb is a mysql alias), so a single
            // check covers both.
            if (adapter?.engineType !== 'mysql') {
                mysqlConnectionStatus.value = 'failed';
                return {
                    connected: false,
                    error:
                        'VRCX is not running in mysql/mariadb mode this session. ' +
                        'Save the engine selection and restart VRCX, then test the connection again.'
                };
            }
            const connected = await MySQL.Ping?.();
            mysqlConnectionStatus.value = connected ? 'connected' : 'failed';
            return { connected: !!connected };
        } catch (err) {
            mysqlConnectionStatus.value = 'failed';
            const msg = err.message || String(err);
            console.error('[testMysqlConnection]', msg);
            return { connected: false, error: msg };
        }
    }

    // ── SQLite path picker + connection probe ───────────────────────────
    //
    // The SQLite engine uses a single local file. The UI exposes a path
    // input + a "Browse..." button that opens a native dialog (folder OR
    // file) and a "Test Connection" button that opens the file through a
    // throwaway SQLite driver to confirm it is a readable database before
    // the user commits + restarts.
    //
    // `VRCX_Database.name` IS the path field for sqlite mode — there is no
    // separate sqlitePath key. The `sqlitePath` ref below is a UI-only copy
    // hydrated from `VRCX_Database.name` by `loadDatabaseEngineConfig` and
    // written back through `saveDatabaseEngineConfig('sqlite', null,
    // { sqlitePath })`.

    /** Allowed SQLite file extensions (must match C# `AllowedDatabaseExtensions`). */
    const SQLITE_ALLOWED_EXTENSIONS = ['.db', '.db3', '.sqlite3'];

    /**
     * Native browse dialog for the SQLite database path. The user may pick
     * either a folder or a file:
     *   - Folder → the canonical path gets `\VRCX.sqlite3` appended, then
     *     resolved through `AppApi.ResolveDatabaseName` (realpath +
     *     validation) so the returned value is the final absolute file path.
     *   - File → the selected file's extension is validated against the
     *     allowed set (`.db`/`.db3`/`.sqlite3`) before being accepted; an
     *     invalid extension is rejected with a toast and the ref is left
     *     unchanged.
     *
     * On cancel the ref is left untouched.
     *
     * @returns {Promise<void>}
     */
    async function browseSqlitePath() {
        if (state.folderSelectorDialogVisible) return;
        state.folderSelectorDialogVisible = true;
        let picked = '';
        try {
            // First offer a folder selection (the common case — the app
            // creates `VRCX.sqlite3` inside it). We reuse the file dialog
            // with a SQLite filter so the user can also pick an existing
            // database file in the same dialog.
            const filter =
                'SQLite database (*.db;*.db3;*.sqlite3)|*.db;*.db3;*.sqlite3|All files (*.*)|*.*';
            if (WINDOWS) {
                picked = await AppApi.OpenFileSelectorDialog(
                    sqlitePath.value || '',
                    '.sqlite3',
                    filter
                );
            } else {
                picked =
                    (await window.electron?.openFileDialog?.([
                        {
                            name: 'SQLite database',
                            extensions: ['db', 'db3', 'sqlite3']
                        },
                        { name: 'All files', extensions: ['*'] }
                    ])) || '';
            }
        } finally {
            state.folderSelectorDialogVisible = false;
        }
        if (!picked) return;

        // Distinguish folder vs file by checking the OS path type. On both
        // Windows (Cef `OpenFileSelectorDialog`) and Electron the dialog
        // above is a file picker, so `picked` is always a file path here.
        // For the folder→append case the UI also exposes a dedicated folder
        // browse handler (`browseSqliteFolder`).
        const ext = picked.toLowerCase().match(/(\.[^.\\/]+)$/)?.[1] || '';
        if (!SQLITE_ALLOWED_EXTENSIONS.includes(ext)) {
            toast.error(
                t(
                    'view.settings.advanced.advanced.database_engine.sqlite_invalid_extension',
                    {
                        ext: ext || '(none)',
                        allowed: SQLITE_ALLOWED_EXTENSIONS.join(', ')
                    }
                )
            );
            return;
        }
        sqlitePath.value = picked;
        // Reset the probe state — the path changed, the old result is stale.
        sqliteConnectionStatus.value = 'idle';
        sqliteConnectionError.value = '';
    }

    /**
     * Browse for a *folder* to host the SQLite database. The folder path gets
     * `\VRCX.sqlite3` appended and then canonicalized through
     * `AppApi.ResolveDatabaseName` (which performs realpath + the full
     * validation pipeline). This is the "I want a new DB in this directory"
     * flow.
     *
     * @returns {Promise<void>}
     */
    async function browseSqliteFolder() {
        if (state.folderSelectorDialogVisible) return;
        state.folderSelectorDialogVisible = true;
        let folder = '';
        try {
            if (WINDOWS) {
                // Default to the directory of the current path (if any) so
                // the dialog opens somewhere sensible.
                const current = sqlitePath.value || '';
                const initialDir = current
                    .split(/[\\/]/)
                    .slice(0, -1)
                    .join('\\');
                folder = await AppApi.OpenFolderSelectorDialog(initialDir);
            } else {
                folder = (await window.electron?.openDirectoryDialog?.()) || '';
            }
        } finally {
            state.folderSelectorDialogVisible = false;
        }
        if (!folder) return;
        // Append the default filename. Normalize separators to the platform
        // convention before appending.
        const sep = folder.includes('\\') ? '\\' : '/';
        let candidate = `${folder}${sep}VRCX.sqlite3`;
        // Canonicalize + validate through the C# bridge (realpath). This
        // rejects path traversal, reserved names, etc. and returns the
        // absolute path the app would actually use.
        if (typeof AppApi !== 'undefined' && AppApi.ResolveDatabaseName) {
            try {
                candidate = await AppApi.ResolveDatabaseName(candidate);
            } catch (err) {
                toast.error(
                    t(
                        'view.settings.advanced.advanced.database_engine.sqlite_path_invalid',
                        { error: err.message || String(err) }
                    )
                );
                return;
            }
        }
        sqlitePath.value = candidate;
        sqliteConnectionStatus.value = 'idle';
        sqliteConnectionError.value = '';
    }

    /**
     * Probe a SQLite database file by new-ing a throwaway `SQLiteAdapter`
     * through `createAdapter` and running `SELECT 1` against it. This goes
     * through the same adapter abstraction layer as every other database
     * operation (migration, CRUD, etc.), so the probe exercises the real
     * code path the app would use after a restart — not a raw C# shortcut.
     *
     * The probe uses **read-write mode** (`Read Only=False`, overriding the
     * adapter's default `Read Only=True`). This means:
     *   - If the file does not exist, SQLite creates it (a valid empty
     *     database). This verifies that the directory is writable, the disk
     *     is not full, and the path is not blocked by permissions / locks /
     *     reserved names. The created file is a real SQLite database ready
     *     for `SQLite.Init` on next restart — no separate "create" step
     *     needed.
     *   - If the file exists, it is opened in read-write mode and `SELECT 1`
     *     confirms it is a readable SQLite database.
     *   - If the path is invalid (permission denied, disk full, parent
     *     directory missing, etc.), SQLite throws and the error is surfaced
     *     to the UI.
     *
     * This is the most thorough probe possible without actually running the
     * full schema init: it proves the path is usable end-to-end.
     *
     * When the path is empty, the default AppData location is resolved
     * through `AppApi.ResolveDatabaseName('')` and probed.
     *
     * @returns {Promise<{connected: boolean, error?: string}>}
     */
    async function testSqliteConnection() {
        sqliteConnectionStatus.value = 'testing';
        sqliteConnectionError.value = '';
        try {
            // Resolve the canonical path (realpath + validation) before
            // constructing the connection URI, so an invalid path fails
            // with a clear message instead of a raw SQLite open error.
            // An empty path resolves to the default AppData location.
            let canonicalPath = sqlitePath.value || '';
            if (typeof AppApi !== 'undefined' && AppApi.ResolveDatabaseName) {
                try {
                    canonicalPath =
                        await AppApi.ResolveDatabaseName(canonicalPath);
                } catch (err) {
                    sqliteConnectionStatus.value = 'failed';
                    sqliteConnectionError.value = err.message || String(err);
                    return {
                        connected: false,
                        error: err.message || String(err)
                    };
                }
            }
            if (!canonicalPath) {
                sqliteConnectionStatus.value = 'failed';
                sqliteConnectionError.value = 'Could not resolve database path';
                return {
                    connected: false,
                    error: 'Could not resolve database path'
                };
            }
            // Build a sqlite:/// URI for createAdapter. On Windows the path
            // may start with a drive letter (C:\...); createAdapter's
            // SQLiteAdapter._buildConnectionString handles the leading-slash
            // stripping for drive-letter paths.
            const uri = `sqlite:///${canonicalPath}`;
            // new a throwaway adapter in READ-WRITE mode. The adapter's
            // _buildConnectionString defaults to Read Only=True; we override
            // it to False so SQLite creates the file if it doesn't exist
            // (proving the directory is writable) and opens existing files
            // in read-write mode. This is the same mode SQLite.Init will use
            // on next restart, so the probe is an end-to-end validation.
            const probeAdapter = await createAdapter(
                /** @type {any} */ ({
                    connection: uri,
                    'Read Only': 'False'
                })
            );
            let gotRow = false;
            await probeAdapter.execute(() => {
                gotRow = true;
            }, 'SELECT 1');
            if (gotRow) {
                sqliteConnectionStatus.value = 'connected';
                return { connected: true };
            }
            sqliteConnectionStatus.value = 'failed';
            sqliteConnectionError.value = 'No result from SELECT 1';
            return { connected: false, error: 'No result from SELECT 1' };
        } catch (err) {
            sqliteConnectionStatus.value = 'failed';
            const msg = err.message || String(err);
            sqliteConnectionError.value = msg;
            console.error('[testSqliteConnection]', msg);
            return { connected: false, error: msg };
        }
    }

    /**
     * Resolve the current SQLite database file path from VRCXStorage. Used as
     * the migration source when switching from SQLite to a remote engine.
     *
     * `VRCX_Database.name` is the single path field — in sqlite mode it holds
     * the file path, in remote mode it holds the remote database name. When
     * the user has already switched to a remote engine + restarted, `name`
     * no longer contains a SQLite path; in that case we fall back to the
     * default AppData location (the C# `ResolveDatabaseName` / AppApi bridge
     * resolves an empty name to `Program.ConfigLocation`).
     *
     * @returns {Promise<string>} canonical SQLite db path
     */
    async function resolveCurrentSqliteDbPath() {
        const dbName = await VRCXStorage.Get('VRCX_Database.name');
        if (typeof AppApi !== 'undefined' && AppApi.ResolveDatabaseName) {
            try {
                return await AppApi.ResolveDatabaseName(dbName || '');
            } catch {
                // `name` is a remote database name (not a SQLite path) after
                // a switch + restart — ResolveDatabaseName rejects it. Fall
                // back to the default location.
                return await AppApi.ResolveDatabaseName('');
            }
        }
        // Fallback for vitest / non-CefSharp environments.
        return dbName || '';
    }

    /**
     * Pre-flight guard for SQLite → remote push. Returns whether it is
     * safe to run `pushFromSqlite` against `targetEngine` right now.
     *
     * The migration destination is the live singleton `adapter`, whose
     * connection was fixed at boot by the C# layer from the then-persisted
     * `VRCX_Database.*` keys (captured in `bootDbConfig`). The Advanced tab
     * keeps editable refs (`pgsqlHost`, `mysqlPort`, …) the user may change
     * — and even persist — without restarting. Until a restart those edits
     * do NOT reach the running C# pool, so triggering a push from the UI
     * would silently target the boot-time connection while the form shows
     * the new values (defect 3, MEDIUM). This guard blocks that by requiring:
     *
     *   1. `adapter.engineType === targetEngine` — the app actually booted in
     *      the target engine (so the matching C# pool is Init'd). Gating on
     *      the runtime adapter, not `VRCXStorage.mode`, mirrors
     *      `testPgsqlConnection` / `testMysqlConnection`: the user may have
     *      switched the persisted mode without restarting.
     *   2. The target engine's current UI refs match the boot-time snapshot
     *      — i.e. the user has not edited host/port/user/pass/database since
     *      boot (or has edited + restarted, which re-snapshots). A mismatch
     *      means the form disagrees with where the push would actually
     *      write, so we refuse and tell the user to restart.
     *
     * `mariadb` is treated as `mysql` (same adapter / wire protocol).
     *
     * @param {'postgresql'|'mysql'|'mariadb'} targetEngine
     * @returns {{ ok: boolean, message: string }} `ok` true when the push
     *   may proceed; otherwise `message` explains why (English, consistent with
     *   the error strings returned by `testPgsqlConnection`).
     */
    function canPushToRemote(targetEngine) {
        const target = targetEngine === 'mariadb' ? 'mysql' : targetEngine;
        const runtimeEngine = adapter?.engineType;
        if (runtimeEngine !== target) {
            return {
                ok: false,
                message:
                    `VRCX is not running in ${target} mode this session ` +
                    `(runtime engine: ${runtimeEngine || 'unknown'}). ` +
                    'Save the engine selection and restart VRCX, then run the migration again.'
            };
        }

        // Resolve the boot-time connection params for this engine from the
        // snapshot, applying the same defaults as `loadDatabaseEngineConfig`
        // so a missing persisted key compares equal to its UI ref default.
        const defaultPort = target === 'mysql' ? 3306 : 5432;
        const bootHost = bootDbConfig.host || 'localhost';
        const bootPort = Number(bootDbConfig.port) || defaultPort;
        const bootUser =
            bootDbConfig.username || (target === 'mysql' ? 'root' : 'vrcx');
        const bootPass = bootDbConfig.password || '';
        const bootDb = bootDbConfig.name || '';

        // Current UI refs for the target engine — what the user sees as the
        // migration destination in the form.
        const uiHost = target === 'mysql' ? mysqlHost.value : pgsqlHost.value;
        const uiPort = target === 'mysql' ? mysqlPort.value : pgsqlPort.value;
        const uiUser =
            target === 'mysql' ? mysqlUsername.value : pgsqlUsername.value;
        const uiPass =
            target === 'mysql' ? mysqlPassword.value : pgsqlPassword.value;
        const uiDb =
            target === 'mysql' ? mysqlDatabase.value : pgsqlDatabase.value;

        const fields = [
            ['host', bootHost, uiHost],
            ['port', String(bootPort), String(Number(uiPort) || defaultPort)],
            ['username', bootUser, uiUser],
            ['password', bootPass, uiPass],
            ['database', bootDb, uiDb]
        ];
        const mismatch = fields.find(([, b, u]) => b !== u);
        if (mismatch) {
            return {
                ok: false,
                message:
                    `The ${target} connection parameters in the form differ ` +
                    `from the ones VRCX booted with (field "${mismatch[0]}"). ` +
                    'Restart VRCX so the running backend picks up the new ' +
                    'values, then run the migration again. Otherwise the ' +
                    'migration would silently target the previous connection.'
            };
        }
        return { ok: true, message: '' };
    }

    /**
     * Run the SQLite → PostgreSQL push. The destination is the live
     * singleton `adapter` (a `PgSQLAdapter` after the user switched engine +
     * restarted). Progress is mirrored into `vrcxStore.databaseUpgradeState`
     * so the existing `DatabaseUpgradeDialog` (which keys off
     * `fromVersion === -1`) surfaces a "push in progress" state.
     *
     * @param {string} [srcConnStr] - SQLite connection string. Defaults to the current SQLite db path.
     * @returns {Promise<import('../../services/database/pushEngine.js').PushResult>}
     */
    async function pushFromSqliteToPgsql(srcConnStr) {
        // Pre-flight guard (defect 3): refuse to run unless the live adapter
        // actually booted in postgresql mode AND the form's connection params
        // match the boot-time snapshot. Without this, a user who edited
        // host/port/database without restarting would see the push
        // "succeed" while it silently wrote to the previous connection.
        const guard = canPushToRemote('postgresql');
        if (!guard.ok) {
            pgsqlPushStatus.value = 'failed';
            throw new Error(guard.message);
        }
        pgsqlPushStatus.value = 'pushing';
        // Surface the push via the existing DatabaseUpgradeDialog. We
        // mutate the reactive object's properties (rather than replacing the
        // ref value) to stay within the ESLint store-boundary rule.
        vrcxStore.databaseUpgradeState.visible = true;
        vrcxStore.databaseUpgradeState.fromVersion = -1; // marks "push in progress"
        vrcxStore.databaseUpgradeState.toVersion = 0;
        try {
            const source = srcConnStr
                ? srcConnStr
                : `sqlite:///${await resolveCurrentSqliteDbPath()}`;
            // No `dstConfig` is passed: the destination is always the live
            // singleton adapter (guarded above to match the form). See
            // `pushFromSqlite` + defect 3 for why a candidate target
            // config is no longer accepted.
            const result = await pushFromSqlite(source, {
                onProgress: (p) => {
                    // Update the dialog's state so the UI can show the
                    // current table + running row count. We stash these
                    // on the same reactive object via extra fields the
                    // dialog doesn't strictly need but won't break on.
                    vrcxStore.databaseUpgradeState.currentTable = p.table;
                    vrcxStore.databaseUpgradeState.rowsCopied = p.rowsCopied;
                }
            });
            pgsqlPushStatus.value = 'done';
            vrcxStore.databaseUpgradeState.visible = false;
            return result;
        } catch (err) {
            pgsqlPushStatus.value = 'failed';
            vrcxStore.databaseUpgradeState.visible = false;
            throw err;
        }
    }

    /**
     * Run the SQLite → MySQL/MariaDB push. Symmetric to `pushFromSqliteToPgsql`;
     * the underlying `pushFromSqlite` is engine-agnostic and only
     * requires the live singleton `adapter` to be a `MySQLAdapter` (which it
     * is after the user switched engine + restarted so the C# `MySQL.Instance`
     * pool is initialised). The same `DatabaseUpgradeDialog` surfaces
     * progress.
     *
     * @param {string} [srcConnStr] - SQLite connection string. Defaults to the current SQLite db path.
     * @returns {Promise<import('../../services/database/pushEngine.js').PushResult>}
     */
    async function pushFromSqliteToMysql(srcConnStr) {
        // Pre-flight guard (defect 3): symmetric to `pushFromSqliteToPgsql`. Refuse
        // unless the live adapter booted in mysql/mariadb mode AND the form's
        // connection params match the boot-time snapshot.
        const guard = canPushToRemote('mysql');
        if (!guard.ok) {
            mysqlPushStatus.value = 'failed';
            throw new Error(guard.message);
        }
        mysqlPushStatus.value = 'pushing';
        vrcxStore.databaseUpgradeState.visible = true;
        vrcxStore.databaseUpgradeState.fromVersion = -1;
        vrcxStore.databaseUpgradeState.toVersion = 0;
        try {
            const source = srcConnStr
                ? srcConnStr
                : `sqlite:///${await resolveCurrentSqliteDbPath()}`;
            // No `dstConfig` — destination is the live singleton (guarded
            // above). See `pushFromSqlite` + defect 3.
            const result = await pushFromSqlite(source, {
                onProgress: (p) => {
                    vrcxStore.databaseUpgradeState.currentTable = p.table;
                    vrcxStore.databaseUpgradeState.rowsCopied = p.rowsCopied;
                }
            });
            mysqlPushStatus.value = 'done';
            vrcxStore.databaseUpgradeState.visible = false;
            return result;
        } catch (err) {
            mysqlPushStatus.value = 'failed';
            vrcxStore.databaseUpgradeState.visible = false;
            throw err;
        }
    }

    /**
     * Resolve the default directory for the SQLite backup Save-As dialog.
     * On Windows this is `%appdata%/VRCX` (the C# `Program.AppDataDirectory`
     * where `VRCX.sqlite3` lives by default); on other platforms it is the
     * equivalent VRCX config directory. We resolve it through
     * `AppApi.ResolveDatabaseName('')` — the C# bridge resolves an empty
     * name to `Program.ConfigLocation` (the default database file path),
     * then we strip the trailing `VRCX.sqlite3` filename to get the
     * containing directory. Falls back to the empty string (dialog default)
     * when the bridge is unavailable (vitest / non-CefSharp environments).
     *
     * @returns {Promise<string>} default directory path, or '' if unresolvable
     */
    async function resolveDefaultBackupDir() {
        if (typeof AppApi === 'undefined' || !AppApi.ResolveDatabaseName) {
            return '';
        }
        try {
            // ResolveDatabaseName('') → Program.ConfigLocation, which is
            // `<AppDataDirectory>/VRCX.sqlite3`. Strip the trailing
            // filename to get the directory.
            const dbPath = await AppApi.ResolveDatabaseName('');
            if (!dbPath) return '';
            const sep = dbPath.includes('\\') ? '\\' : '/';
            const lastSep = dbPath.lastIndexOf(sep);
            return lastSep >= 0 ? dbPath.slice(0, lastSep) : dbPath;
        } catch {
            return '';
        }
    }

    /**
     * Pre-flight guard for remote → SQLite pull. Returns whether it is
     * safe to run `pullToSqlite` right now. The pull source is
     * the live singleton `adapter`, whose connection was fixed at boot by
     * the C# layer; we only require that the runtime engine is a remote
     * engine (postgresql or mysql), NOT sqlite. Unlike the push guard
     * `canPushToRemote`, we do NOT compare the form's connection params
     * against the boot-time snapshot because the pull only READS from
     * the source — a param mismatch would mean reading from the wrong
     * host, but since the user already booted + connected successfully,
     * the boot-time connection IS the one they want to pull. The form
     * edits are irrelevant to a read-only pull.
     *
     * @returns {{ ok: boolean, message: string }}
     */
    function canPullFromRemote() {
        const runtimeEngine = adapter?.engineType;
        if (runtimeEngine !== 'postgresql' && runtimeEngine !== 'mysql') {
            return {
                ok: false,
                message:
                    `VRCX is not running in a remote database mode this session ` +
                    `(runtime engine: ${runtimeEngine || 'unknown'}). ` +
                    'Switch to PostgreSQL or MySQL, restart VRCX, then run the pull again.'
            };
        }
        return { ok: true, message: '' };
    }

    /**
     * Open the native Save-As dialog and pull the live remote database
     * to the user-chosen NEW `.sqlite3` file. The dialog defaults to the
     * VRCX AppData directory (`%appdata%/VRCX` on Windows) so the pull
     * lands next to the original `VRCX.sqlite3` for easy management, and
     * forces the `.sqlite3` extension. The pull is non-destructive: it
     * only reads from the remote source and writes to the new file.
     *
     * Progress is mirrored into `vrcxStore.databaseUpgradeState` so the
     * existing `DatabaseUpgradeDialog` (which keys off `fromVersion === -1`)
     * surfaces a "pull in progress" state, same as the push flow.
     *
     * @returns {Promise<import('../../services/database/pullEngine.js').PullResult|undefined>}
     *   `undefined` if the user cancelled the Save-As dialog.
     */
    async function pullToSqlite() {
        // Pre-flight guard: refuse unless the live adapter booted in a
        // remote engine mode.
        const guard = canPullFromRemote();
        if (!guard.ok) {
            pullStatus.value = 'failed';
            throw new Error(guard.message);
        }
        // ── 1. Open the Save-As dialog ──
        // Default to `<AppDataDirectory>/VRCX.sqlite3` so the suggested
        // filename is `VRCX.sqlite3` in the VRCX config directory. The
        // user can rename it (e.g. `VRCX-backup-20260724.sqlite3`); the
        // dialog forces the `.sqlite3` extension via the filter + defaultExt.
        const defaultDir = await resolveDefaultBackupDir();
        const defaultFileName = 'VRCX.sqlite3';
        const defaultPath = defaultDir
            ? `${defaultDir}${defaultDir.includes('\\') ? '\\' : '/'}${defaultFileName}`
            : defaultFileName;
        const filter =
            'SQLite database (*.sqlite3)|*.sqlite3|All files (*.*)|*.*';
        let picked = '';
        if (state.folderSelectorDialogVisible) return undefined;
        state.folderSelectorDialogVisible = true;
        try {
            if (WINDOWS) {
                picked = await AppApi.SaveFileSelectorDialog(
                    defaultPath,
                    '.sqlite3',
                    filter
                );
            } else {
                picked =
                    (await window.electron?.saveFileDialog?.(defaultPath, [
                        {
                            name: 'SQLite database',
                            extensions: ['sqlite3']
                        },
                        { name: 'All files', extensions: ['*'] }
                    ])) || '';
            }
        } finally {
            state.folderSelectorDialogVisible = false;
        }
        if (!picked) return undefined; // user cancelled

        // ── 2. Validate the extension ──
        // The dialog filter + defaultExt should guarantee a `.sqlite3`
        // extension, but validate defensively (same rule as `browseSqlitePath`).
        const ext = picked.toLowerCase().match(/(\.[^.\\/]+)$/)?.[1] || '';
        if (!SQLITE_ALLOWED_EXTENSIONS.includes(ext)) {
            pullStatus.value = 'failed';
            toast.error(
                t(
                    'view.settings.advanced.advanced.database_engine.sqlite_invalid_extension',
                    {
                        ext: ext || '(none)',
                        allowed: SQLITE_ALLOWED_EXTENSIONS.join(', ')
                    }
                )
            );
            return undefined;
        }

        // ── 3. Run the pull ──
        pullStatus.value = 'pulling';
        vrcxStore.databaseUpgradeState.visible = true;
        vrcxStore.databaseUpgradeState.fromVersion = -1;
        vrcxStore.databaseUpgradeState.toVersion = 0;
        try {
            const dstConnStr = `sqlite:///${picked}`;
            const result = await runPullToSqlite(dstConnStr, {
                onProgress: (p) => {
                    vrcxStore.databaseUpgradeState.currentTable = p.table;
                    vrcxStore.databaseUpgradeState.rowsCopied = p.rowsCopied;
                }
            });
            pullStatus.value = 'done';
            vrcxStore.databaseUpgradeState.visible = false;
            return result;
        } catch (err) {
            pullStatus.value = 'failed';
            vrcxStore.databaseUpgradeState.visible = false;
            throw err;
        }
    }

    return {
        state,

        bioLanguage,
        enablePrimaryPassword,
        relaunchVRChatAfterCrash,
        vrcQuitFix,
        autoSweepVRChatCache,
        selfInviteOverride,
        saveInstancePrints,
        cropInstancePrints,
        saveInstanceStickers,
        avatarRemoteDatabase,
        enableAppLauncher,
        enableAppLauncherAutoClose,
        enableAppLauncherRunProcessOnce,
        screenshotHelper,
        screenshotHelperModifyFilename,
        screenshotHelperCopyToClipboard,
        youTubeApi,
        translationApi,
        youTubeApiKey,
        translationApiKey,
        translationApiType,
        translationApiEndpoint,
        translationApiModel,
        translationApiPrompt,
        progressPie,
        progressPieFilter,
        showConfirmationOnSwitchAvatar,
        gameLogDisabled,
        sqliteTableSizes,
        avatarAutoCleanup,
        purgeInProgress,
        ugcFolderPath,
        currentUserInventory,
        autoDeleteOldPrints,
        notificationOpacity,
        isVRChatConfigDialogVisible,
        saveInstanceEmoji,
        vrcRegistryAutoBackup,
        vrcRegistryAskRestore,
        sentryErrorReporting,
        autoJoinGroupCertification,

        // Phase 9 §6.2 — database engine selection + migration
        databaseEngine,
        pgsqlHost,
        pgsqlPort,
        pgsqlUsername,
        pgsqlPassword,
        pgsqlDatabase,
        pgsqlConnectionStatus,
        pgsqlPushStatus,
        mysqlHost,
        mysqlPort,
        mysqlUsername,
        mysqlPassword,
        mysqlDatabase,
        mysqlConnectionStatus,
        mysqlPushStatus,
        pullStatus,
        sqlitePath,
        sqliteConnectionStatus,
        sqliteConnectionError,
        loadDatabaseEngineConfig,
        saveDatabaseEngineConfig,
        testPgsqlConnection,
        testMysqlConnection,
        testSqliteConnection,
        browseSqlitePath,
        browseSqliteFolder,
        pushFromSqliteToPgsql,
        pushFromSqliteToMysql,
        canPushToRemote,
        resolveCurrentSqliteDbPath,
        pullToSqlite,
        canPullFromRemote,

        setEnablePrimaryPassword,
        setEnablePrimaryPasswordConfigRepository,
        setBioLanguage,
        setRelaunchVRChatAfterCrash,
        setVrcQuitFix,
        setAutoSweepVRChatCache,
        setSelfInviteOverride,
        setSaveInstancePrints,
        setCropInstancePrints,
        setSaveInstanceStickers,
        setAvatarRemoteDatabase,
        setEnableAppLauncher,
        setEnableAppLauncherAutoClose,
        setEnableAppLauncherRunProcessOnce,
        setScreenshotHelper,
        setScreenshotHelperModifyFilename,
        setScreenshotHelperCopyToClipboard,
        setYouTubeApi,
        setTranslationApi,
        setYouTubeApiKey,
        setTranslationApiKey,
        setTranslationApiType,
        setTranslationApiEndpoint,
        setTranslationApiModel,
        setTranslationApiPrompt,
        setProgressPie,
        setProgressPieFilter,
        setShowConfirmationOnSwitchAvatar,
        setGameLogDisabled,
        setAvatarAutoCleanup,
        purgeAvatarFeedData,
        runAvatarAutoCleanup,
        setUGCFolderPath,
        cropPrintsChanged,
        setAutoDeleteOldPrints,
        setNotificationOpacity,
        getSqliteTableSizes,
        handleSetAppLauncherSettings,
        lookupYouTubeVideo,
        translateText,
        fetchAvailableModels,
        resetUGCFolder,
        openUGCFolder,
        openUGCFolderSelector,
        folderSelectorDialog,
        showVRChatConfig,
        promptAutoClearVRCXCacheFrequency,
        setSaveInstanceEmoji,
        setVrcRegistryAutoBackup,
        setVrcRegistryAskRestore,
        setSentryErrorReporting,
        setAutoJoinGroupCertification,
        checkSentryConsent,
        askDeleteAllScreenshotMetadata
    };
});
