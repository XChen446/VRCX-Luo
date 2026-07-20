import { i18n } from '../plugins/i18n';

import Noty from 'noty';

import { closeWebSocket, initWebsocket } from '../services/websocket';
import { escapeTag } from '../shared/utils';
import { queryClient } from '../queries';
import { useAuthStore } from '../stores/auth';
import { useNotificationStore } from '../stores/notification';
import { useUpdateLoopStore } from '../stores/updateLoop';
import { useUserStore } from '../stores/user';
import { applyCurrentUser } from './userCoordinator';
import { watchState } from '../services/watchState';
import { accountHub } from '../services/accountHub';

import configRepository from '../services/config';
import webApiService from '../services/webapi';

/**
 * Runs the shared logout side effects (including goodbye notification).
 */
export async function runLogoutFlow() {
    const authStore = useAuthStore();
    const userStore = useUserStore();
    const notificationStore = useNotificationStore();
    const t = i18n.global.t;

    if (watchState.isLoggedIn) {
        new Noty({
            type: 'success',
            text: t('message.auth.logout_greeting', {
                name: `<strong>${escapeTag(userStore.currentUser.displayName)}</strong>`
            })
        }).show();
    }

    userStore.setUserDialogVisible(false);
    accountHub.reset();
    watchState.isLoggedIn = false;
    watchState.isFriendsLoaded = false;
    watchState.isFavoritesLoaded = false;
    notificationStore.setNotificationInitStatus(false);
    await authStore.updateStoredUser(userStore.currentUser);
    await queryClient.cancelQueries();
    queryClient.clear();
    webApiService.clearCookies();
    authStore.loginForm.lastUserLoggedIn = '';
    await configRepository.remove('lastUserLoggedIn');
    authStore.setAttemptingAutoLogin(false);
    authStore.state.autoLoginAttempts.clear();
    closeWebSocket();
    const { router } = await import('../plugins/router');
    if (router.currentRoute.value.name !== 'login') {
        router.replace({ name: 'login' }).catch(() => {});
    }
}

/**
 * Runs post-login side effects after a successful auth response.
 * @param {object} json Current user payload from auth API.
 */
export async function runLoginSuccessFlow(json) {
    const updateLoopStore = useUpdateLoopStore();

    updateLoopStore.setNextCurrentUserRefresh(420); // 7mins
    applyCurrentUser(json);
    // 决策 #1(PR #7 review):.bak 恢复的 VRCX_Database.mode 延迟到主账号登录成功后再回写主配置。
    // bootstrap(Program.cs / main.js)Init 时若主配置缺 mode,已从 .bak 恢复 mode 启动数据库,
    // 但未写回主配置(避免 Init 阶段持久化)。此处登录成功后写回主配置,
    // 再 Backup(此时 Backup 备份含 mode 的配置,不丢失)。
    // 决策 #4:仅针对关键配置项 VRCX_Database.mode。
    try
    {
        if (!(await VRCXStorage.Get('VRCX_Database.mode')))
        {
            var bakJson = await VRCXStorage.GetBackup();
            if (bakJson && bakJson !== '{}')
            {
                var bak = JSON.parse(bakJson);
                if (bak['VRCX_Database.mode'])
                {
                    VRCXStorage.Set('VRCX_Database.mode', bak['VRCX_Database.mode']);
                    console.warn('[auth] VRCX_Database.mode recovered from .bak written back to main config');
                }
            }
        }
    }
    catch (e)
    {
        console.warn('[auth] Failed to recover VRCX_Database.mode from .bak:', e && e.message);
    }
    VRCXStorage.Backup();
    initWebsocket();
}
