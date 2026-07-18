// @ts-nocheck
import InteropApi from '../ipc-electron/interopApi.js';
import configRepository from '../services/config.js';
import vrcxJsonStorage from '../services/jsonStorage.js';
import { initAdapter } from '../services/database/adapter/index.js';

export async function initInteropApi(isVrOverlay = false) {
    if (isVrOverlay) {
        if (WINDOWS) {
            await CefSharp.BindObjectAsync('AppApiVr');
        } else {
            // @ts-ignore
            window.AppApiVr = InteropApi.AppApiVrElectron;
        }
    } else {
        // #region | Init Cef C# bindings
        if (WINDOWS) {
            await CefSharp.BindObjectAsync(
                'AppApi',
                'WebApi',
                'VRCXStorage',
                'SQLite',
                'MySQL',
                'LogWatcher',
                'Discord',
                'AssetBundleManager'
            );
        } else {
            window.AppApi = InteropApi.AppApiElectron;
            window.WebApi = InteropApi.WebApi;
            window.VRCXStorage = InteropApi.VRCXStorage;
            window.SQLite = InteropApi.SQLite;
            window.MySQL = InteropApi.MySQL;
            window.LogWatcher = InteropApi.LogWatcher;
            window.Discord = InteropApi.Discord;
            window.AssetBundleManager = InteropApi.AssetBundleManager;
            window.AppApiVrElectron = InteropApi.AppApiVrElectron;
        }

        // Switch database adapter based on VRCX_Database.mode config.
        // MUST run before configRepository.init() (which uses adapter).
        // VRCXStorage.Get is sync on CefSharp, async on Electron (IPC);
        // await handles both. Tests mock VRCXStorage.Get → '' → 'sqlite'.
        const dbMode = await VRCXStorage.Get('VRCX_Database.mode');
        initAdapter(typeof dbMode === 'string' && dbMode ? dbMode : 'sqlite');

        await configRepository.init();
        new vrcxJsonStorage(VRCXStorage);

        AppApi.SetUserAgent();
    }
}
