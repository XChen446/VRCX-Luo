import { reactive, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { toast } from 'vue-sonner';
import { useI18n } from 'vue-i18n';

import { logWebRequest } from '../../services/appConfig';
import { database } from '../../services/database';
import { migrateSqliteToRemote } from '../../services/database/migrateEngine.js';
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
    /** @type {import('vue').Ref<'idle'|'migrating'|'done'|'failed'>} */
    const pgsqlMigrationStatus = ref('idle');
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
    /** @type {import('vue').Ref<'idle'|'migrating'|'done'|'failed'>} */
    const mysqlMigrationStatus = ref('idle');

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
                (now - lastCleanup) / (1000 * 60 * 60 * 24);
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
            const [
                mode,
                host,
                port,
                username,
                password,
                name
            ] = await Promise.all([
                VRCXStorage.Get('VRCX_Database.mode'),
                VRCXStorage.Get('VRCX_Database.host'),
                VRCXStorage.Get('VRCX_Database.port'),
                VRCXStorage.Get('VRCX_Database.username'),
                VRCXStorage.Get('VRCX_Database.password'),
                VRCXStorage.Get('VRCX_Database.name')
            ]);
            databaseEngine.value =
                mode === 'postgresql'
                    ? 'postgresql'
                    : mode === 'mysql' || mode === 'mariadb'
                    ? 'mysql'
                    : 'sqlite';
            pgsqlHost.value = host || 'localhost';
            pgsqlPort.value = Number(port) || 5432;
            pgsqlUsername.value = username || 'vrcx';
            pgsqlPassword.value = password || '';
            // When mode is sqlite, VRCX_Database.name holds the SQLite file
            // name — don't clobber the remote database name ref with it. Only
            // adopt the stored value when it looks like a remote database name
            // (no path separators, no .db suffix).
            if (mode !== 'sqlite' && name && !/[\\/]/.test(name) && !/\.db$/i.test(name)) {
                if (mode === 'postgresql') {
                    pgsqlDatabase.value = name;
                } else {
                    mysqlDatabase.value = name;
                }
            }
            // MySQL uses the same shared VRCX_Database.* keys, so mirror host/
            // port/user/pass into the MySQL refs when the active mode is mysql.
            if (mode === 'mysql' || mode === 'mariadb') {
                mysqlHost.value = host || 'localhost';
                mysqlPort.value = Number(port) || 3306;
                mysqlUsername.value = username || 'root';
                mysqlPassword.value = password || '';
            }
        } catch (err) {
            console.warn('loadDatabaseEngineConfig failed:', err);
        }
    }

    /**
     * Persist the database engine configuration to VRCXStorage. The C# layer
     * reads these keys at startup to decide which engine to Init, so a
     * restart is required after switching engines.
     *
     * @param {'sqlite'|'postgresql'|'mysql'} engine
     * @param {object} [pgConfig]
     * @param {string} [pgConfig.host]
     * @param {number} [pgConfig.port]
     * @param {string} [pgConfig.username]
     * @param {string} [pgConfig.password]
     * @param {string} [pgConfig.database]
     * @returns {Promise<void>}
     */
    async function saveDatabaseEngineConfig(engine, pgConfig) {
        // If we are switching away from SQLite, snapshot the SQLite file
        // name before VRCX_Database.name is repurposed for the remote
        // database. resolveCurrentSqliteDbPath reads sqlitePath first so the
        // SQLite → remote migration can still locate the source file after
        // restart. Applies to both postgresql and mysql/mariadb switches.
        const isRemoteEngine =
            engine === 'postgresql' ||
            engine === 'mysql' ||
            engine === 'mariadb';
        if (isRemoteEngine && pgConfig) {
            const currentMode = await VRCXStorage.Get('VRCX_Database.mode');
            if (currentMode !== engine) {
                const currentName = await VRCXStorage.Get(
                    'VRCX_Database.name'
                );
                if (currentName) {
                    await VRCXStorage.Set(
                        'VRCX_Database.sqlitePath',
                        currentName
                    );
                }
            }
        }
        await VRCXStorage.Set('VRCX_Database.mode', engine);
        if (pgConfig) {
            await Promise.all([
                VRCXStorage.Set('VRCX_Database.host', pgConfig.host),
                VRCXStorage.Set(
                    'VRCX_Database.port',
                    String(pgConfig.port)
                ),
                VRCXStorage.Set('VRCX_Database.username', pgConfig.username),
                VRCXStorage.Set('VRCX_Database.password', pgConfig.password),
                VRCXStorage.Set('VRCX_Database.name', pgConfig.database)
            ]);
        }
    }

    /**
     * Probe the PostgreSQL backend health. Only meaningful when the app
     * booted in `postgresql` mode (so `PostgreSQL.Instance` is initialised);
     * in `sqlite` mode we can only validate the config fields and report
     * that a switch + restart is required.
     *
     * @returns {Promise<{connected: boolean, error?: string}>}
     */
    async function testPgsqlConnection() {
        pgsqlConnectionStatus.value = 'testing';
        try {
            const mode = await VRCXStorage.Get('VRCX_Database.mode');
            if (mode === 'postgresql' && typeof PostgreSQL !== 'undefined') {
                const health = await PostgreSQL.GetHealth?.();
                const parsed = health ? JSON.parse(health) : { connected: false };
                pgsqlConnectionStatus.value = parsed.connected
                    ? 'connected'
                    : 'failed';
                return parsed;
            }
            pgsqlConnectionStatus.value = 'failed';
            return {
                connected: false,
                error: 'Current engine is sqlite. Switch to postgresql and restart to test connection.'
            };
        } catch (err) {
            pgsqlConnectionStatus.value = 'failed';
            return { connected: false, error: err.message || String(err) };
        }
    }

    /**
     * Probe the MySQL/MariaDB backend health. Symmetric to `testPgsqlConnection`;
     * unlike PG, the MySQL C# binding exposes `IsConnected` rather than a
     * JSON `GetHealth` payload, so we interpret a truthy `IsConnected` as
     * connected. Only meaningful when the app booted in `mysql`/`mariadb` mode
     * (so `MySQL.Instance` is initialised); in `sqlite` mode we can only
     * report that a switch + restart is required.
     *
     * @returns {Promise<{connected: boolean, error?: string}>}
     */
    async function testMysqlConnection() {
        mysqlConnectionStatus.value = 'testing';
        try {
            const mode = await VRCXStorage.Get('VRCX_Database.mode');
            if (
                (mode === 'mysql' || mode === 'mariadb') &&
                typeof MySQL !== 'undefined'
            ) {
                const connected = await MySQL.IsConnected?.();
                mysqlConnectionStatus.value = connected
                    ? 'connected'
                    : 'failed';
                return { connected: !!connected };
            }
            mysqlConnectionStatus.value = 'failed';
            return {
                connected: false,
                error: 'Current engine is sqlite. Switch to mysql/mariadb and restart to test connection.'
            };
        } catch (err) {
            mysqlConnectionStatus.value = 'failed';
            return { connected: false, error: err.message || String(err) };
        }
    }

    /**
     * Resolve the current SQLite database file path from VRCXStorage. Used as
     * the migration source when switching from SQLite to PostgreSQL. After
     * the user switches engine + restarts, `VRCX_Database.name` is
     * repurposed for the PG database name, so we read the snapshotted
     * `VRCX_Database.sqlitePath` first (written by
     * `saveDatabaseEngineConfig` before the switch) and fall back to
     * `VRCX_Database.name` for legacy configs that never switched.
     *
     * @returns {Promise<string>} canonical SQLite db path
     */
    async function resolveCurrentSqliteDbPath() {
        const dbName =
            (await VRCXStorage.Get('VRCX_Database.sqlitePath')) ||
            (await VRCXStorage.Get('VRCX_Database.name'));
        if (typeof AppApi !== 'undefined' && AppApi.ResolveDatabaseName) {
            return await AppApi.ResolveDatabaseName(dbName || '');
        }
        // Fallback for vitest / non-CefSharp environments.
        return dbName || '';
    }

    /**
     * Run the SQLite → PostgreSQL migration. The destination is the live
     * singleton `adapter` (a `PgSQLAdapter` after the user switched engine +
     * restarted). Progress is mirrored into `vrcxStore.databaseUpgradeState`
     * so the existing `DatabaseUpgradeDialog` (which keys off
     * `fromVersion === -1`) surfaces a "migration in progress" state.
     *
     * @param {string} [srcConnStr] - SQLite connection string. Defaults to the current SQLite db path.
     * @returns {Promise<import('../../services/database/migrateEngine.js').MigrationResult>}
     */
    async function migrateToPgsql(srcConnStr) {
        pgsqlMigrationStatus.value = 'migrating';
        // Surface the migration via the existing DatabaseUpgradeDialog. We
        // mutate the reactive object's properties (rather than replacing the
        // ref value) to stay within the ESLint store-boundary rule.
        vrcxStore.databaseUpgradeState.visible = true;
        vrcxStore.databaseUpgradeState.fromVersion = -1; // marks "migration in progress"
        vrcxStore.databaseUpgradeState.toVersion = 0;
        try {
            const source = srcConnStr
                ? srcConnStr
                : `sqlite:///${await resolveCurrentSqliteDbPath()}`;
            const result = await migrateSqliteToRemote(
                source,
                {
                    host: pgsqlHost.value,
                    port: pgsqlPort.value,
                    username: pgsqlUsername.value,
                    password: pgsqlPassword.value,
                    database: pgsqlDatabase.value
                },
                {
                    onProgress: (p) => {
                        // Update the dialog's state so the UI can show the
                        // current table + running row count. We stash these
                        // on the same reactive object via extra fields the
                        // dialog doesn't strictly need but won't break on.
                        vrcxStore.databaseUpgradeState.currentTable =
                            p.table;
                        vrcxStore.databaseUpgradeState.rowsCopied =
                            p.rowsCopied;
                    }
                }
            );
            pgsqlMigrationStatus.value = 'done';
            vrcxStore.databaseUpgradeState.visible = false;
            return result;
        } catch (err) {
            pgsqlMigrationStatus.value = 'failed';
            vrcxStore.databaseUpgradeState.visible = false;
            throw err;
        }
    }

    /**
     * Run the SQLite → MySQL/MariaDB migration. Symmetric to `migrateToPgsql`;
     * the underlying `migrateSqliteToRemote` is engine-agnostic and only
     * requires the live singleton `adapter` to be a `MySQLAdapter` (which it
     * is after the user switched engine + restarted so the C# `MySQL.Instance`
     * pool is initialised). The same `DatabaseUpgradeDialog` surfaces
     * progress.
     *
     * @param {string} [srcConnStr] - SQLite connection string. Defaults to the current SQLite db path.
     * @returns {Promise<import('../../services/database/migrateEngine.js').MigrationResult>}
     */
    async function migrateToMysql(srcConnStr) {
        mysqlMigrationStatus.value = 'migrating';
        vrcxStore.databaseUpgradeState.visible = true;
        vrcxStore.databaseUpgradeState.fromVersion = -1;
        vrcxStore.databaseUpgradeState.toVersion = 0;
        try {
            const source = srcConnStr
                ? srcConnStr
                : `sqlite:///${await resolveCurrentSqliteDbPath()}`;
            const result = await migrateSqliteToRemote(
                source,
                {
                    host: mysqlHost.value,
                    port: mysqlPort.value,
                    username: mysqlUsername.value,
                    password: mysqlPassword.value,
                    database: mysqlDatabase.value
                },
                {
                    onProgress: (p) => {
                        vrcxStore.databaseUpgradeState.currentTable =
                            p.table;
                        vrcxStore.databaseUpgradeState.rowsCopied =
                            p.rowsCopied;
                    }
                }
            );
            mysqlMigrationStatus.value = 'done';
            vrcxStore.databaseUpgradeState.visible = false;
            return result;
        } catch (err) {
            mysqlMigrationStatus.value = 'failed';
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
        pgsqlMigrationStatus,
        mysqlHost,
        mysqlPort,
        mysqlUsername,
        mysqlPassword,
        mysqlDatabase,
        mysqlConnectionStatus,
        mysqlMigrationStatus,
        loadDatabaseEngineConfig,
        saveDatabaseEngineConfig,
        testPgsqlConnection,
        testMysqlConnection,
        migrateToPgsql,
        migrateToMysql,
        resolveCurrentSqliteDbPath,

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
