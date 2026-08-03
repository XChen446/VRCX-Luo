import { describe, expect, test, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

import MemoryCleanupDialog from '../MemoryCleanupDialog.vue';

const translations = {
    'view.tools.system_tools.memory_cleanup': 'Memory Cleanup',
    'view.tools.system_tools.memory_cleanup_16gb_notice': 'Designed for 16 GB memory.',
    'view.tools.system_tools.memory_cleanup_available': 'Available memory',
    'view.tools.system_tools.memory_cleanup_load': 'Memory load',
    'view.tools.system_tools.memory_cleanup_target_total': 'Target processes',
    'view.tools.system_tools.memory_cleanup_result': 'Cleanup result',
    'view.tools.system_tools.memory_cleanup_freed': 'Freed about {size}.',
    'view.tools.system_tools.memory_cleanup_process': 'Process',
    'view.tools.system_tools.memory_cleanup_working_set': 'Working set',
    'view.tools.system_tools.memory_cleanup_private': 'Private memory',
    'view.tools.system_tools.memory_cleanup_empty': 'No target process is running.',
    'view.tools.system_tools.memory_cleanup_notice': 'Normal cleanup trims VRCX, VRChat and CEF working sets. Deep cleanup runs in a separate elevated helper process.',
    'view.tools.system_tools.memory_cleanup_run': 'Clean Related Processes',
    'view.tools.system_tools.memory_cleanup_deep_run': 'Deep Cleanup',
    'view.tools.system_tools.memory_cleanup_deep_tooltip': 'Purge system memory lists. A UAC prompt will appear for the helper process.',
    'view.tools.system_tools.memory_cleanup_admin_failed': 'Deep cleanup was cancelled or failed',
    'view.tools.system_tools.memory_cleanup_operation_SeProfileSingleProcessPrivilege': 'Enable profile privilege',
    'view.tools.system_tools.memory_cleanup_operation_SeIncreaseQuotaPrivilege': 'Enable quota privilege',
    'view.tools.system_tools.memory_cleanup_operation_modifiedPageList': 'Modified page list',
    'view.tools.system_tools.memory_cleanup_operation_standbyList': 'Standby list',
    'view.tools.system_tools.memory_cleanup_operation_lowPriorityStandbyList': 'Low priority standby list',
    'view.tools.system_tools.memory_cleanup_operation_systemFileCache': 'System file cache',
    'view.tools.system_tools.memory_cleanup_operation_ok': 'OK',
    'view.tools.system_tools.memory_cleanup_operation_failed': 'Failed',
    'view.tools.system_tools.memory_cleanup_done': 'Memory cleanup completed',
    'view.tools.system_tools.memory_cleanup_failed': 'Memory cleanup failed',
    'common.actions.refresh': 'Refresh'
};

vi.mock('vue-i18n', () => ({
    useI18n: () => ({
        t: (key, params = {}) =>
            (translations[key] || key).replace(/\{(\w+)\}/g, (_, name) => params[name] ?? '')
    })
}));

vi.mock('vue-sonner', () => ({
    toast: {
        error: vi.fn(),
        success: vi.fn()
    }
}));

vi.mock('@/components/ui/dialog', () => ({
    Dialog: { template: '<div><slot /></div>', props: ['open'] },
    DialogContent: { template: '<section><slot /></section>' },
    DialogFooter: { template: '<footer><slot /></footer>' },
    DialogHeader: { template: '<header><slot /></header>' },
    DialogTitle: { template: '<h2><slot /></h2>' }
}));

vi.mock('@/components/ui/alert', () => ({
    Alert: { template: '<div><slot /></div>' },
    AlertDescription: { template: '<p><slot /></p>' },
    AlertTitle: { template: '<strong><slot /></strong>' }
}));

vi.mock('@/components/ui/button', () => ({
    Button: {
        template: '<button :disabled="disabled" :title="title"><slot /></button>',
        props: ['disabled', 'title']
    }
}));

vi.mock('@/components/ui/progress', () => ({
    Progress: {
        template: '<div data-testid="progress" :data-value="modelValue"></div>',
        props: ['modelValue']
    }
}));

vi.mock('@/components/ui/tooltip', () => ({
    TooltipWrapper: {
        template: '<span><slot /></span>',
        props: ['content', 'side']
    }
}));

function mockSnapshot() {
    globalThis.AppApi = {
        GetMemoryCleanupSnapshot: vi.fn().mockResolvedValue(
            JSON.stringify({
                TotalAvailableMemoryBytes: 1000,
                MemoryLoadBytes: 400,
                TargetProcessWorkingSetBytes: 100,
                Processes: [
                    {
                        Id: 1,
                        Name: 'VRCX-Luo',
                        WorkingSetBytes: 100,
                        PrivateMemoryBytes: 200
                    }
                ]
            })
        ),
        LaunchMemoryCleanupHelper: vi.fn().mockResolvedValue(
            JSON.stringify({
                FreedBytes: 100,
                Before: {
                    TargetProcessWorkingSetBytes: 100,
                    TotalAvailableMemoryBytes: 1000,
                    MemoryLoadBytes: 400,
                    Processes: []
                },
                After: {
                    TargetProcessWorkingSetBytes: 0,
                    TotalAvailableMemoryBytes: 1000,
                    MemoryLoadBytes: 300,
                    Processes: []
                },
                Deep: {
                    Requested: true,
                    Ran: true,
                    Status: 'completed',
                    Operations: [
                        {
                            Kind: 'cleanup',
                            Name: 'standbyList',
                            Ok: true
                        }
                    ]
                }
            })
        )
    };
}

describe('MemoryCleanupDialog', () => {
    test('renders localized actions and memory progress bars', async () => {
        mockSnapshot();

        const wrapper = mount(MemoryCleanupDialog, {
            props: { visible: true }
        });
        await flushPromises();

        expect(wrapper.text()).toContain('Refresh');
        expect(wrapper.text()).toContain('!');
        expect(wrapper.text()).not.toContain('common.refresh');
        expect(wrapper.findAll('[data-testid="progress"]')).toHaveLength(3);
        expect(wrapper.text()).toContain('Clean Related Processes');
        expect(wrapper.text()).toContain('Deep Cleanup');
    });

    test('runs normal cleanup via helper process', async () => {
        mockSnapshot();

        const wrapper = mount(MemoryCleanupDialog, {
            props: { visible: true }
        });
        await flushPromises();

        const runButton = wrapper
            .findAll('button')
            .find((button) => button.text().includes('Clean Related Processes'));

        await runButton.trigger('click');
        await flushPromises();

        expect(globalThis.AppApi.LaunchMemoryCleanupHelper).toHaveBeenCalledWith(false);
        expect(wrapper.text()).toContain('Standby list');
        expect(wrapper.text()).toContain('OK');
    });

    test('runs deep cleanup via elevated helper process', async () => {
        mockSnapshot();

        const wrapper = mount(MemoryCleanupDialog, {
            props: { visible: true }
        });
        await flushPromises();

        const deepButton = wrapper
            .findAll('button')
            .find((button) => button.text().includes('Deep Cleanup'));

        await deepButton.trigger('click');
        await flushPromises();

        expect(globalThis.AppApi.LaunchMemoryCleanupHelper).toHaveBeenCalledWith(true);
        expect(wrapper.text()).toContain('Standby list');
        expect(wrapper.text()).toContain('OK');
    });

    test('shows error when helper is cancelled or fails', async () => {
        mockSnapshot();
        globalThis.AppApi.LaunchMemoryCleanupHelper.mockResolvedValueOnce(null);

        const wrapper = mount(MemoryCleanupDialog, {
            props: { visible: true }
        });
        await flushPromises();

        const deepButton = wrapper
            .findAll('button')
            .find((button) => button.text().includes('Deep Cleanup'));

        await deepButton.trigger('click');
        await flushPromises();

        expect(globalThis.AppApi.LaunchMemoryCleanupHelper).toHaveBeenCalledWith(true);
        expect(wrapper.text()).not.toContain('Standby list');
    });
});
