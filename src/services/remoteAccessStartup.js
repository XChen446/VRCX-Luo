import { useRemoteAccessStore } from '../stores/remoteAccess';

async function initRemoteAccessOnStartup() {
    try {
        await useRemoteAccessStore().init();
    } catch (err) {
        // Remote access is optional: a failure here must never block the
        // main UI from mounting (it previously caused a blank screen).
        console.error('[remoteAccess] init failed:', err);
    }
}

export { initRemoteAccessOnStartup };
