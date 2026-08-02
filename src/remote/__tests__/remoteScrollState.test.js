import { describe, expect, it } from 'vitest';

import { captureScrollState, restoreScrollState } from '../remoteScrollState';

describe('remote scroll state', () => {
    it('restores friend list scroll positions after the remote page re-renders', () => {
        const oldRoot = document.createElement('div');
        oldRoot.innerHTML = `
            <div class="friend-list"></div>
            <div class="friend-list"></div>
        `;
        oldRoot.querySelectorAll('.friend-list')[0].scrollTop = 120;
        oldRoot.querySelectorAll('.friend-list')[1].scrollTop = 260;

        const state = captureScrollState(oldRoot, '.friend-list');

        const newRoot = document.createElement('div');
        newRoot.innerHTML = `
            <div class="friend-list"></div>
            <div class="friend-list"></div>
        `;
        restoreScrollState(newRoot, '.friend-list', state);

        expect(newRoot.querySelectorAll('.friend-list')[0].scrollTop).toBe(120);
        expect(newRoot.querySelectorAll('.friend-list')[1].scrollTop).toBe(260);
    });

    it('captures and restores multiple scroll containers by selector', () => {
        const oldRoot = document.createElement('div');
        oldRoot.innerHTML = `
            <div class="content"><div class="friend-grid"></div></div>
        `;
        oldRoot.querySelector('.content').scrollTop = 540;
        oldRoot.querySelector('.friend-grid').scrollTop = 30;

        const state = captureScrollState(oldRoot, [
            '.content',
            '.friend-grid'
        ]);
        expect(state).toHaveLength(2);

        const newRoot = document.createElement('div');
        newRoot.innerHTML = `
            <div class="content"><div class="friend-grid"></div></div>
        `;
        restoreScrollState(
            newRoot,
            ['.content', '.friend-grid'],
            state
        );

        expect(newRoot.querySelector('.content').scrollTop).toBe(540);
        expect(newRoot.querySelector('.friend-grid').scrollTop).toBe(30);
    });
});
