const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const rootDir = path.join(__dirname, '..');
const workerPanelSource = fs.readFileSync(
    path.join(rootDir, 'modules', 'WorkerPanelClient.js'),
    'utf8'
);
const storeSource = fs.readFileSync(
    path.join(rootDir, 'modules', 'AICodeWorkerStore.js'),
    'utf8'
);

function createClock(start = 1700000000000) {
    const clock = { now: start };
    class TestDate extends Date {
        constructor(...args) {
            super(args.length === 0 ? clock.now : args[0], ...args.slice(1));
        }

        static now() {
            return clock.now;
        }
    }
    return { clock, Date: TestDate };
}

function createClassList() {
    const tokens = new Set();
    return {
        add(...names) {
            names.forEach(name => tokens.add(name));
        },
        remove(...names) {
            names.forEach(name => tokens.delete(name));
        },
        toggle(name) {
            if (tokens.has(name)) {
                tokens.delete(name);
                return false;
            }
            tokens.add(name);
            return true;
        },
        contains(name) {
            return tokens.has(name);
        }
    };
}

function readHeaderField(headerHTML, className) {
    const field = headerHTML.match(new RegExp(
        `<span class="${className}">([^<]*)</span>`
    ));
    return field ? field[1] : '';
}

function observeCards(list) {
    return list._cards.map(card => ({
        stateClass: card.stateClass,
        workerInfo: card.workerInfo,
        stateLabel: card.stateLabel,
        elapsed: card.elapsed
    }));
}

function createElement(id) {
    return {
        id,
        classList: createClassList(),
        dataset: {},
        style: {},
        listeners: new Map(),
        addEventListener(type, listener) {
            const listeners = this.listeners.get(type) || [];
            listeners.push(listener);
            this.listeners.set(type, listeners);
        },
        dispatch(type, event = {}) {
            event.type = type;
            if (typeof event.stopPropagation !== 'function') event.stopPropagation = () => {};
            for (const listener of this.listeners.get(type) || []) listener(event);
        },
        click() {
            this.dispatch('click');
        }
    };
}

function createListElement() {
    const list = createElement('worker-panel-list');
    list._innerHTML = '';
    list._headers = [];
    list._cards = [];
    list._cancelButtons = [];
    Object.defineProperty(list, 'innerHTML', {
        get() {
            return list._innerHTML;
        },
        set(value) {
            list._innerHTML = String(value);
            list._headers = [];
            list._cards = [];
            list._cancelButtons = [];

            // These boundaries mirror buildCardHTML: an outer .wp-card followed
            // by its immediate .wp-card-header. They keep assertions card-local
            // without parsing or comparing the entire rendered HTML string.
            const cards = Array.from(list._innerHTML.matchAll(
                /<div class="wp-card ([^"]+)">\s*<div class="wp-card-header">([\s\S]*?)<\/div>/g
            ));
            cards.forEach((match, index) => {
                const card = createElement(`card-${index}`);
                const classNames = match[1];
                const headerHTML = match[2];
                classNames.split(' ').filter(Boolean).forEach(token => card.classList.add(token));
                card.stateClass = classNames.split(' ').find(name => name.startsWith('wp-state-')) || '';
                card.workerInfo = readHeaderField(headerHTML, 'wp-worker-info');
                card.stateLabel = readHeaderField(headerHTML, 'wp-state-label');
                card.elapsed = readHeaderField(headerHTML, 'wp-elapsed');
                const header = createElement(`header-${index}`);
                header.closest = selector => selector === '.wp-card' ? card : null;
                list._headers.push(header);
                list._cards.push(card);
            });

            const cancelButtons = Array.from(
                list._innerHTML.matchAll(/<button class="wp-cancel-btn" data-jobid="([^"]*)">取消<\/button>/g)
            );
            cancelButtons.forEach((match, index) => {
                const button = createElement(`cancel-${index}`);
                button.dataset.jobid = match[1];
                list._cancelButtons.push(button);
            });
        }
    });
    list.querySelectorAll = selector => {
        if (selector === '.wp-card-header') return list._headers;
        if (selector === '.wp-cancel-btn') return list._cancelButtons;
        return [];
    };
    return list;
}

function createChatAPI() {
    const callbacks = new Set();
    const api = {
        callbacks,
        subscriptionCount: 0,
        requestCount: 0,
        cancelled: [],
        onWorkerPanelMessage(callback) {
            api.subscriptionCount += 1;
            callbacks.add(callback);
            return () => callbacks.delete(callback);
        },
        requestWorkerPanelSnapshot() {
            api.requestCount += 1;
        },
        cancelWorkerJob(jobId) {
            api.cancelled.push(jobId);
        },
        emit(data) {
            for (const callback of Array.from(callbacks)) callback(data);
        }
    };
    return api;
}

function createHarness({ includeStore, panelSource, missingDom = false }) {
    const { clock, Date: TestDate } = createClock();
    const api = createChatAPI();
    const warnings = [];
    const logs = [];
    const timers = [];
    const clearIntervalCalls = [];
    const panel = missingDom ? null : createElement('worker-panel');
    const list = missingDom ? null : createListElement();
    const badge = missingDom ? null : createElement('worker-panel-badge');
    const close = missingDom ? null : createElement('worker-panel-close');
    const toggle = missingDom ? null : createElement('worker-panel-toggle');
    const elements = new Map([
        ['worker-panel', panel],
        ['worker-panel-list', list],
        ['worker-panel-badge', badge],
        ['worker-panel-close', close],
        ['worker-panel-toggle', toggle]
    ]);
    if (list) list.innerHTML = '<div class="wp-empty">等待任务数据…</div>';

    const document = {
        readyState: 'complete',
        getElementById(id) {
            return elements.get(id) || null;
        },
        addEventListener() {}
    };
    const context = {
        chatAPI: api,
        console: {
            warn: (...args) => warnings.push(args),
            log: (...args) => logs.push(args)
        },
        document,
        Event,
        EventTarget,
        Date: TestDate,
        setInterval(callback, delay) {
            timers.push({ callback, delay });
            return timers.length;
        },
        clearInterval(id) {
            clearIntervalCalls.push(id);
        },
        window: null
    };
    context.window = context;

    if (includeStore) vm.runInNewContext(storeSource, context, { filename: 'modules/AICodeWorkerStore.js' });
    vm.runInNewContext(panelSource, context, { filename: 'modules/WorkerPanelClient.js' });

    return {
        api,
        badge,
        clearIntervalCalls,
        clock,
        context,
        elements,
        list,
        logs,
        panel,
        timers,
        warnings
    };
}

function runScenario(panelSource, includeStore) {
    const harness = createHarness({ includeStore, panelSource });
    const client = harness.context.WorkerPanelClient;
    const list = harness.list;
    const panel = harness.panel;
    const snapshot = {
        type: 'job_status_snapshot',
        data: {
            jobs: [
                {
                    jobId: 'job-completed-123456',
                    state: 'completed',
                    worker: 'alpha',
                    mode: 'batch',
                    startedAt: harness.clock.now - 90000,
                    completedAt: harness.clock.now - 30000
                },
                {
                    jobId: 'job-running-abcdef',
                    state: 'running',
                    worker: 'beta',
                    mode: 'live',
                    startedAt: harness.clock.now - 60000
                }
            ]
        }
    };

    harness.api.emit(snapshot);
    const afterSnapshot = {
        cards: observeCards(list),
        html: list.innerHTML,
        badge: harness.badge.textContent,
        badgeDisplay: harness.badge.style.display,
        cancelButtonJobIds: list.querySelectorAll('.wp-cancel-btn').map(btn => btn.dataset.jobid)
    };

    client.showPanel();
    const afterShow = {
        visible: panel.classList.contains('wp-visible'),
        timerCount: harness.timers.length,
        clearIntervalCount: harness.clearIntervalCalls.length,
        subscriptionCount: harness.api.subscriptionCount,
        requestCount: harness.api.requestCount,
        activeCallbacks: harness.api.callbacks.size
    };
    const cancelButtons = list.querySelectorAll('.wp-cancel-btn');
    assert.equal(cancelButtons.length, 1);
    const cancelButton = cancelButtons[0];
    cancelButton.click();
    const afterCancel = {
        cards: observeCards(list),
        cancelled: harness.api.cancelled.slice(),
        html: list.innerHTML,
        cancelButtonJobIds: list.querySelectorAll('.wp-cancel-btn').map(btn => btn.dataset.jobid)
    };

    harness.clock.now += 5000;
    harness.timers[0].callback();
    const afterTimer = {
        cards: observeCards(list),
        html: list.innerHTML
    };

    client.hidePanel();
    const afterHide = {
        visible: panel.classList.contains('wp-visible'),
        timerCount: harness.timers.length,
        clearIntervalCount: harness.clearIntervalCalls.length,
        subscriptionCount: harness.api.subscriptionCount,
        requestCount: harness.api.requestCount,
        activeCallbacks: harness.api.callbacks.size
    };

    harness.api.emit({
        type: 'job_status_update',
        data: { jobId: 'job-running-abcdef', state: 'completed', completedAt: harness.clock.now }
    });
    const afterUpdate = {
        cards: observeCards(list),
        html: list.innerHTML,
        badge: harness.badge.textContent,
        badgeDisplay: harness.badge.style.display,
        cancelButtonJobIds: list.querySelectorAll('.wp-cancel-btn').map(btn => btn.dataset.jobid)
    };

    return {
        afterCancel,
        afterHide,
        afterShow,
        afterSnapshot,
        afterTimer,
        afterUpdate,
        externalInterface: Object.keys(client).sort(),
        timerCount: harness.timers.length,
        timerDelays: harness.timers.map(timer => timer.delay),
        logs: harness.logs,
        warnings: harness.warnings,
        visibleAfterShow: afterShow.visible
    };
}

// The former dynamic A/B comparison was historical acceptance evidence against
// the pre-extraction source. This portable test now checks the fixed behavior
// contract directly, without relying on server-only Git history.
test('WorkerPanelClient honors the extracted Store rendering contract', () => {
    const extracted = runScenario(workerPanelSource, true);

    assert.deepEqual(extracted.afterSnapshot.cards, [
        {
            stateClass: 'wp-state-completed',
            workerInfo: 'alpha / batch',
            stateLabel: '已完成',
            elapsed: '1m0s'
        },
        {
            stateClass: 'wp-state-running',
            workerInfo: 'beta / live',
            stateLabel: '运行中',
            elapsed: '1m0s'
        }
    ]);
    assert.equal(extracted.afterSnapshot.badge, '1');
    assert.equal(extracted.afterSnapshot.badgeDisplay, 'flex');
    assert.deepEqual(extracted.afterSnapshot.cancelButtonJobIds, ['job-running-abcdef']);

    assert.deepEqual(extracted.afterCancel.cards, extracted.afterSnapshot.cards);
    assert.deepEqual(extracted.afterCancel.cancelled, ['job-running-abcdef']);
    assert.equal(extracted.afterCancel.html, extracted.afterSnapshot.html);
    assert.deepEqual(extracted.afterCancel.cancelButtonJobIds, ['job-running-abcdef']);

    assert.deepEqual(extracted.afterTimer.cards, [
        {
            stateClass: 'wp-state-completed',
            workerInfo: 'alpha / batch',
            stateLabel: '已完成',
            elapsed: '1m0s'
        },
        {
            stateClass: 'wp-state-running',
            workerInfo: 'beta / live',
            stateLabel: '运行中',
            elapsed: '1m5s'
        }
    ]);
    assert.equal(extracted.timerCount, 1);
    assert.deepEqual(extracted.timerDelays, [5000]);

    assert.deepEqual(extracted.afterUpdate.cards, [
        {
            stateClass: 'wp-state-completed',
            workerInfo: 'beta / live',
            stateLabel: '已完成',
            elapsed: '1m5s'
        },
        {
            stateClass: 'wp-state-completed',
            workerInfo: 'alpha / batch',
            stateLabel: '已完成',
            elapsed: '1m0s'
        }
    ]);
    assert.equal(extracted.afterUpdate.badge, '');
    assert.equal(extracted.afterUpdate.badgeDisplay, 'none');
    assert.deepEqual(extracted.afterUpdate.cancelButtonJobIds, []);

    assert.equal(extracted.visibleAfterShow, true);
    assert.deepEqual(extracted.afterShow, {
        visible: true,
        timerCount: 1,
        clearIntervalCount: 0,
        subscriptionCount: 1,
        requestCount: 1,
        activeCallbacks: 1
    });
    assert.deepEqual(extracted.afterHide, {
        visible: false,
        timerCount: 1,
        clearIntervalCount: 0,
        subscriptionCount: 1,
        requestCount: 1,
        activeCallbacks: 1
    });
    assert.deepEqual(extracted.externalInterface, [
        'handleMessage',
        'hidePanel',
        'init',
        'showPanel',
        'togglePanel'
    ]);
    assert.deepEqual(extracted.warnings, []);
});

test('WorkerPanelClient preserves the missing-DOM early exit', () => {
    const harness = createHarness({
        includeStore: true,
        panelSource: workerPanelSource,
        missingDom: true
    });

    assert.equal(harness.api.subscriptionCount, 0);
    assert.equal(harness.api.requestCount, 0);
    assert.equal(harness.api.callbacks.size, 0);
    assert.deepEqual(harness.warnings, [[
        '[WorkerPanel] DOM elements not found. Panel disabled.'
    ]]);
});

function findScriptTags(html, src) {
    return Array.from(html.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/gi))
        .map(match => {
            const srcMatch = match[0].match(/(?:^|\s)src\s*=\s*(['"])([^'"]+)\1/i);
            return srcMatch && srcMatch[2] === src
                ? { html: match[0], index: match.index }
                : null;
        })
        .filter(Boolean);
}

function hasAttribute(tagHTML, attributeName) {
    return new RegExp(
        `(?:^|\\s)${attributeName}(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+))?(?=\\s|>)`,
        'i'
    ).test(tagHTML);
}

test('main.html loads the unique Store and Drawer before Next Shell and legacy WorkerPanelClient', () => {
    const currentHTML = fs.readFileSync(path.join(rootDir, 'main.html'), 'utf8');
    const storeTags = findScriptTags(currentHTML, 'modules/AICodeWorkerStore.js');
    const drawerTags = findScriptTags(currentHTML, 'modules/AICodeWorkerDrawer.js');
    const shellTags = findScriptTags(currentHTML, 'modules/ui-system/next-shell/next-shell-controller.js');
    const workerTags = findScriptTags(currentHTML, 'modules/WorkerPanelClient.js');

    assert.equal(storeTags.length, 1);
    assert.equal(drawerTags.length, 1);
    assert.equal(shellTags.length, 1);
    assert.equal(workerTags.length, 1);
    assert.equal(hasAttribute(storeTags[0].html, 'defer'), false);
    assert.equal(hasAttribute(drawerTags[0].html, 'defer'), false);
    assert.equal(hasAttribute(workerTags[0].html, 'defer'), true);
    assert.equal(storeTags[0].index < drawerTags[0].index, true);
    assert.equal(drawerTags[0].index < shellTags[0].index, true);
    assert.equal(shellTags[0].index < workerTags[0].index, true);
    assert.equal(storeTags[0].index < workerTags[0].index, true);
});

test('WorkerPanelClient delegates data ownership and cancellation to the Store', () => {
    assert.doesNotMatch(workerPanelSource, /const jobs = new Map/);
    assert.doesNotMatch(workerPanelSource, /onWorkerPanelMessage/);
    assert.match(workerPanelSource, /store\.cancelWorkerJob\(jobId\)/);
    assert.match(workerPanelSource, /store\.addEventListener\('change'/);
});
