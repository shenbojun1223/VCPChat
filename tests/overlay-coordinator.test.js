const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { OverlayCoordinator } = require('../modules/ui-system/next-shell/overlay-coordinator.js');

function createFixture(overrides = {}) {
    const dom = new JSDOM('<!doctype html><body><div id="settings" class="modal active"></div></body>');
    const stateEvents = [];
    const calls = { hide: 0, reconcile: 0 };
    dom.window.document.addEventListener('next-ui-overlay-changed', event => stateEvents.push(event.detail.active));
    const coordinator = new OverlayCoordinator({
        document: dom.window.document,
        hideEmbeddedView: async () => { calls.hide += 1; },
        reconcileEmbeddedView: () => { calls.reconcile += 1; },
        ...overrides,
    });
    return { dom, coordinator, calls, stateEvents };
}

test('visible modals acquire one lease and close events release it', async () => {
    const { dom, coordinator, calls, stateEvents } = createFixture();
    coordinator.mount();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(coordinator.active, true);
    assert.equal(calls.hide, 1);
    dom.window.document.dispatchEvent(new dom.window.CustomEvent('modal-visibility-changed', {
        detail: { modalId: 'settings', active: true },
    }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.hide, 1, 'duplicate visibility events must not duplicate a modal lease');
    dom.window.document.dispatchEvent(new dom.window.CustomEvent('modal-visibility-changed', {
        detail: { modalId: 'settings', active: false },
    }));
    assert.equal(coordinator.active, false);
    assert.deepEqual(stateEvents, [true, false]);
    assert.equal(calls.reconcile, 1);
    coordinator.dispose();
});

test('a released lease reconciles after a delayed hide settles', async () => {
    let settleHide;
    const { coordinator, calls, stateEvents } = createFixture({
        hideEmbeddedView: () => new Promise(resolve => { settleHide = resolve; }),
    });
    coordinator.document.querySelector('.modal').classList.remove('active');
    coordinator.mount();
    const owner = Symbol('delayed');
    const pending = coordinator.acquire(owner);
    coordinator.release(owner);
    assert.equal(calls.reconcile, 1);
    settleHide();
    await pending;
    assert.equal(calls.reconcile, 2, 'late hide completion must reconcile the selected native view again');
    assert.deepEqual(stateEvents, [true, false]);
    coordinator.dispose();
});

test('dispose clears leases, retracts fallback listeners and is idempotent', async () => {
    const { dom, coordinator, calls, stateEvents } = createFixture();
    coordinator.document.querySelector('.modal').classList.remove('active');
    coordinator.mount();
    await coordinator.acquire(Symbol('owned'));
    coordinator.dispose();
    coordinator.dispose();
    assert.equal(coordinator.active, false);
    assert.equal(calls.reconcile, 1, 'dispose must reconcile a native view released with the coordinator');
    assert.deepEqual(stateEvents, [true, false]);
    dom.window.document.dispatchEvent(new dom.window.CustomEvent('modal-visibility-changed', {
        detail: { modalId: 'late', active: true },
    }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.hide, 1, 'disposed coordinator must not respond to later modal events');
});

test('stale close from an older modal root cannot release a reopened modal lease', async () => {
    const { dom, coordinator } = createFixture();
    const oldRoot = dom.window.document.getElementById('settings');
    coordinator.mount();
    await new Promise(resolve => setImmediate(resolve));
    oldRoot.classList.remove('active');
    dom.window.document.dispatchEvent(new dom.window.CustomEvent('modal-visibility-changed', {
        detail: { modalId: 'settings', active: false, root: oldRoot, generation: 1 },
    }));
    const newRoot = oldRoot.cloneNode(true);
    newRoot.classList.add('active');
    oldRoot.replaceWith(newRoot);
    dom.window.document.dispatchEvent(new dom.window.CustomEvent('modal-visibility-changed', {
        detail: { modalId: 'settings', active: true, root: newRoot, generation: 2 },
    }));
    dom.window.document.dispatchEvent(new dom.window.CustomEvent('modal-visibility-changed', {
        detail: { modalId: 'settings', active: false, root: oldRoot, generation: 1 },
    }));
    assert.equal(coordinator.active, true);
    dom.window.document.dispatchEvent(new dom.window.CustomEvent('modal-visibility-changed', {
        detail: { modalId: 'settings', active: false, root: newRoot, generation: 2 },
    }));
    assert.equal(coordinator.active, false);
    coordinator.dispose();
});

for (const staleClose of [false, true]) {
test(`repeated real modal opens release correctly (stale close: ${staleClose})`, async () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const dom = new JSDOM('<!doctype html><body><div id="globalSettingsModal" class="modal" tabindex="-1"></div></body>',
        { runScripts: 'outside-only', pretendToBeVisual: true });
    const { window } = dom;
    const calls = { hide: 0, reconcile: 0 };
    const events = [];
    window.document.addEventListener('modal-visibility-changed', event => events.push(event.detail));
    const coordinator = new OverlayCoordinator({
        document: window.document,
        hideEmbeddedView: async () => { calls.hide++; },
        reconcileEmbeddedView: () => { calls.reconcile++; },
    });
    try {
        window.eval(fs.readFileSync(path.join(__dirname, '../modules/ui-helpers.js'), 'utf8'));
        coordinator.mount();
        const helpers = window.uiHelperFunctions;
        helpers.openModal('globalSettingsModal');
        helpers.openModal('globalSettingsModal');
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(events[1].generation, events[0].generation + 1);
        assert.equal(coordinator.snapshot().owners.length, 1);
        assert.equal(calls.hide, 1, 'repeated open retains one overlay lease');
        // A delayed close for the first open must not release the latest open.
        if (staleClose) {
            window.document.dispatchEvent(new window.CustomEvent('modal-visibility-changed', {
                detail: { ...events[0], active: false },
            }));
            assert.equal(coordinator.active, true);
        }
        helpers.closeModal('globalSettingsModal');
        assert.equal(window.document.querySelectorAll('.modal.active').length, 0);
        assert.equal(coordinator.active, false, 'closing the current generation must release the native-view blocker');
        assert.deepEqual(coordinator.snapshot().modalIds, []);
        assert.equal(calls.reconcile, 1);
    } finally {
        coordinator.dispose();
        window.close();
    }
});
}

for (const replaceRoot of [false, true]) {
    test(`repeated modal open ${replaceRoot ? 'with a replacement root' : 'on the same root'} closes the current lease`, async () => {
        const { dom, coordinator, calls, stateEvents } = createFixture();
        const oldRoot = dom.window.document.getElementById('settings');
        oldRoot.classList.remove('active');
        coordinator.mount();
        const emit = (active, root, generation) => dom.window.document.dispatchEvent(new dom.window.CustomEvent('modal-visibility-changed', {
            detail: { modalId: 'settings', active, root, generation },
        }));
        try {
            oldRoot.classList.add('active');
            emit(true, oldRoot, 1);
            await new Promise(resolve => setImmediate(resolve));
            const currentRoot = replaceRoot ? oldRoot.cloneNode(true) : oldRoot;
            if (replaceRoot) oldRoot.replaceWith(currentRoot);
            emit(true, currentRoot, 2);
            assert.equal(calls.hide, 1, 'reopening must retain a single native hide lease');
            emit(true, oldRoot, 1);
            assert.equal(coordinator.modalOwners.get('settings').root, currentRoot,
                'a stale open must not restore the previous root');
            assert.equal(coordinator.modalOwners.get('settings').generation, 2,
                'a stale open must not rewind the current generation');
            emit(false, oldRoot, 1);
            assert.equal(coordinator.active, true, 'an older close must not release the current opening');
            assert.equal(calls.reconcile, 0);
            currentRoot.classList.remove('active');
            emit(false, currentRoot, 2);
            assert.equal(calls.reconcile, 1, 'the current close must restore the selected native view without waiting for another activation');
            assert.equal(coordinator.active, false);
            assert.deepEqual(stateEvents, [true, false]);
        } finally {
            coordinator.dispose();
            dom.window.close();
        }
    });
}

for (const [reason, hide] of [
    ['active class removed', modal => modal.classList.remove('active')],
    ['root disconnected', modal => modal.remove()],
    ['hidden attribute set', modal => { modal.hidden = true; }],
    ['aria-hidden set', modal => modal.setAttribute('aria-hidden', 'true')],
    ['display none set', modal => { modal.style.display = 'none'; }],
    ['search content hidden', modal => {
        const inner = modal.ownerDocument.createElement('div');
        inner.id = 'global-search-modal';
        inner.style.display = 'none';
        modal.append(inner);
    }],
]) {
    test(`stale modal leases are reclaimed when ${reason}`, async () => {
        const { dom, coordinator, stateEvents } = createFixture();
        const modal = dom.window.document.getElementById('settings');
        modal.id = 'globalSearchModal';
        coordinator.mount();
        try {
            await new Promise(resolve => setImmediate(resolve));
            assert.equal(coordinator.active, true);
            hide(modal);
            assert.equal(coordinator.active, false);
            assert.deepEqual(stateEvents, [true, false]);
        } finally {
            coordinator.dispose();
            dom.window.close();
        }
    });

}
