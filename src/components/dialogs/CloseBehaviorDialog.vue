<template>
    <Dialog :open="visible" @update:open="handleOpenChange">
        <DialogContent class="x-dialog sm:max-w-100">
            <DialogHeader>
                <DialogTitle>{{ t('view.settings.interface.window_behavior.dialog_title') }}</DialogTitle>
                <DialogDescription class="text-xs">
                    {{ t('view.settings.interface.window_behavior.dialog_description') }}
                </DialogDescription>
            </DialogHeader>

            <label class="flex cursor-pointer items-center gap-2 text-xs text-foreground">
                <Checkbox v-model="dontAskAgain" />
                <span>{{ t('view.settings.interface.window_behavior.dont_ask_again') }}</span>
            </label>

            <DialogFooter>
                <Button size="sm" variant="secondary" @click="cancel">
                    {{ t('view.settings.interface.window_behavior.cancel') }}
                </Button>
                <Button size="sm" variant="destructive" @click="submit('exit')">
                    {{ t('view.settings.interface.window_behavior.exit') }}
                </Button>
                <Button size="sm" @click="submit('tray')">
                    {{ t('view.settings.interface.window_behavior.tray') }}
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
</template>

<script setup>
    import { onBeforeUnmount, onMounted, ref } from 'vue';
    import { useI18n } from 'vue-i18n';

    import { Button } from '@/components/ui/button';
    import { Checkbox } from '@/components/ui/checkbox';
    import {
        Dialog,
        DialogContent,
        DialogDescription,
        DialogFooter,
        DialogHeader,
        DialogTitle
    } from '@/components/ui/dialog';
    import { useGeneralSettingsStore } from '@/stores';

    const { t } = useI18n();
    const generalSettingsStore = useGeneralSettingsStore();
    const visible = ref(false);
    const dontAskAgain = ref(false);

    function show() {
        dontAskAgain.value = false;
        visible.value = true;
    }

    function cancel() {
        visible.value = false;
        AppApi.HandleClosePromptChoice('cancel', false);
    }

    function handleOpenChange(open) {
        if (!open) {
            cancel();
        }
    }

    async function submit(action) {
        visible.value = false;
        if (dontAskAgain.value) {
            generalSettingsStore.setCloseButtonAction(action);
        }
        await AppApi.HandleClosePromptChoice(action, dontAskAgain.value);
    }

    onMounted(() => window.addEventListener('vrcx-close-requested', show));
    onBeforeUnmount(() => {
        window.removeEventListener('vrcx-close-requested', show);
        // A page reload while the prompt is visible would otherwise leave the
        // C# side waiting for a choice that can never arrive; cancel it.
        if (visible.value) {
            AppApi.HandleClosePromptChoice('cancel', false);
        }
    });
</script>
