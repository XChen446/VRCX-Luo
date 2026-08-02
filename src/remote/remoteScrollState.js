function captureScrollState(root, selectors) {
    if (!root?.querySelectorAll) {
        return [];
    }
    const list = Array.isArray(selectors) ? selectors : [selectors];
    const state = [];
    for (const selector of list) {
        Array.from(root.querySelectorAll(selector)).forEach((node, index) => {
            state.push({
                selector,
                index,
                scrollTop: node.scrollTop || 0,
                scrollLeft: node.scrollLeft || 0
            });
        });
    }
    return state;
}

function restoreScrollState(root, selectors, state = []) {
    if (!root?.querySelectorAll || !Array.isArray(state) || !state.length) {
        return;
    }
    const list = Array.isArray(selectors) ? selectors : [selectors];
    for (const item of state) {
        if (!list.includes(item.selector)) {
            continue;
        }
        const nodes = Array.from(root.querySelectorAll(item.selector));
        const node = nodes[item.index];
        if (!node) {
            continue;
        }
        node.scrollTop = item.scrollTop || 0;
        node.scrollLeft = item.scrollLeft || 0;
    }
}

export { captureScrollState, restoreScrollState };
