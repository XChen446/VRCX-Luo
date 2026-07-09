import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref } from 'vue';

vi.mock('pinia', async (i) => ({ ...(await i()), storeToRefs: (s) => s }));
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (k) => k }) }));
vi.mock('../../../../stores', () => ({
    useUserStore: () => ({
        userDialog: ref({
            ref: { id: 'usr_2', $isModerator: false },
            isFriend: false,
            isFavorite: false,
            incomingRequest: false,
            outgoingRequest: false,
            isBlock: false,
            isMute: false,
            isMuteChat: false,
            isInteractOff: false,
            isHideAvatar: false,
            isShowAvatar: false
        }),
        currentUser: ref({ id: 'usr_1', isBoopingEnabled: true })
    }),
    useGameStore: () => ({ isGameRunning: ref(false) }),
    useLocationStore: () => ({ lastLocation: ref({ location: 'wrld_1:1' }) }),
    useTrackedNonFriendsStore: () => ({})
}));
vi.mock('../../../../stores/trackedNonFriends', () => ({
    useTrackedNonFriendsStore: () => ({})
}));

vi.mock('../../../../composables/useInviteChecks', () => ({
    useInviteChecks: () => ({ checkCanInvite: () => true })
}));
vi.mock('../../../../composables/useRecentActions', () => ({
    isActionRecent: () => false
}));
vi.mock('../../../ui/dropdown-menu', () => ({
    DropdownMenu: { template: '<div><slot /></div>' },
    DropdownMenuTrigger: { template: '<div><slot /></div>' },
    DropdownMenuContent: { template: '<div><slot /></div>' },
    DropdownMenuSeparator: { template: '<hr />' },
    DropdownMenuShortcut: { template: '<span><slot /></span>' },
    DropdownMenuItem: {
        emits: ['click'],
        template:
            '<button data-testid="dd-item" @click="$emit(\'click\')"><slot /></button>'
    }
}));
vi.mock('@/components/ui/button', () => ({
    Button: {
        emits: ['click'],
        template:
            '<button data-testid="btn" @click="$emit(\'click\')"><slot /></button>'
    }
}));
vi.mock('../../../ui/tooltip', () => ({
    TooltipWrapper: { template: '<div><slot /></div>' }
}));
vi.mock('lucide-vue-next', () => {
    const iconMock = { template: '<i />' };
    const iconMap = {};
    ['Check', 'CheckCircle', 'Clock', 'ExternalLink', 'Flag', 'LineChart', 'Mail', 'MessageCircle', 'MessageSquare', 'Mic', 'MoreHorizontal', 'MousePointer', 'Pencil', 'Plus', 'RefreshCw', 'Settings', 'Share2', 'Star', 'Trash2', 'User', 'VolumeX', 'X', 'XCircle'].forEach((name) => { iconMap[name] = iconMock; });
    return iconMap;
});

import UserActionDropdown from '../UserActionDropdown.vue';

describe('UserActionDropdown.vue', () => {
    it('forwards command callback from dropdown item', async () => {
        const userDialogCommand = vi.fn();
        const wrapper = mount(UserActionDropdown, {
            props: { userDialogCommand }
        });

        await wrapper.findAll('[data-testid="dd-item"]')[0].trigger('click');

        expect(userDialogCommand).toHaveBeenCalled();
    });
});
