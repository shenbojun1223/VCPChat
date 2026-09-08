const assert = require('node:assert/strict');
const test = require('node:test');

const AICodeWorkerDrawer = require('../modules/AICodeWorkerDrawer.js');

class FakeClassList {
    constructor(element) {
        this.element = element;
        this.tokens = new Set();
    }

    sync(value) {
        this.tokens = new Set(String(value || '').split(/\s+/).filter(Boolean));
    }

    add(...names) {
        names.forEach(name => this.tokens.add(name));
        this.element._className = [...this.tokens].join(' ');
    }

    remove(...names) {
        names.forEach(name => this.tokens.delete(name));
        this.element._className = [...this.tokens].join(' ');
    }

    contains(name) {
        return this.tokens.has(name);
    }
}

class FakeElement {
    constructor(document, tagName) {
        this.ownerDocument = document;
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.parentNode = null;
        this.listeners = new Map();
        this.attributes = new Map();
        this.dataset = {};
        this.style = {};
        this.hidden = false;
        this.disabled = false;
        this._text = null;
        this._className = '';
        this.classList = new FakeClassList(this);
        this.focusCalls = [];
    }

    set className(value) {
        this._className = String(value || '');
        this.classList.sync(this._className);
    }

    get className() {
        return this._className;
    }

    set textContent(value) {
        this._text = String(value ?? '');
        this.children.splice(0).forEach(child => { child.parentNode = null; });
    }

    get textContent() {
        if (this._text !== null) return this._text;
        return this.children.map(child => child.textContent).join('');
    }

    append(...nodes) {
        nodes.filter(Boolean).forEach(node => {
            if (node.parentNode) node.parentNode.removeChild(node);
            this.children.push(node);
            node.parentNode = this;
        });
        this._text = null;
    }

    appendChild(node) {
        this.append(node);
        return node;
    }

    insertBefore(node, referenceNode) {
        if (node === referenceNode) return node;
        if (node.parentNode) node.parentNode.removeChild(node);
        const index = referenceNode === null ? this.children.length : this.children.indexOf(referenceNode);
        if (index < 0) this.children.push(node);
        else this.children.splice(index, 0, node);
        node.parentNode = this;
        this._text = null;
        return node;
    }

    removeChild(node) {
        const index = this.children.indexOf(node);
        if (index >= 0) {
            if (this.ownerDocument.activeElement && node.contains(this.ownerDocument.activeElement)) {
                this.ownerDocument.activeElement = this.ownerDocument.body;
            }
            this.children.splice(index, 1);
            node.parentNode = null;
        }
        return node;
    }

    remove() {
        this.parentNode?.removeChild(this);
    }

    addEventListener(type, listener) {
        const listeners = this.listeners.get(type) || new Set();
        listeners.add(listener);
        this.listeners.set(type, listeners);
    }

    removeEventListener(type, listener) {
        this.listeners.get(type)?.delete(listener);
    }

    dispatch(type, event = {}) {
        const payload = event;
        payload.type = type;
        payload.target = this;
        payload.currentTarget = this;
        payload.stopPropagation ||= () => {};
        payload.preventDefault ||= () => { payload.defaultPrevented = true; };
        for (const listener of [...(this.listeners.get(type) || [])]) listener(payload);
    }

    click() {
        this.dispatch('click');
    }

    focus() {
        this.focusCalls.push(arguments[0]);
        this.ownerDocument.activeElement = this;
    }

    contains(node) {
        let current = node;
        while (current) {
            if (current === this) return true;
            current = current.parentNode;
        }
        return false;
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
        if (name === 'id') this.id = String(value);
    }

    getAttribute(name) {
        return this.attributes.has(name) ? this.attributes.get(name) : null;
    }

    removeAttribute(name) {
        this.attributes.delete(name);
    }

    get isConnected() {
        let node = this;
        while (node?.parentNode) node = node.parentNode;
        return node === this.ownerDocument;
    }

    matches(selector) {
        return selector.split(',').some(part => this._matchesSingle(part.trim()));
    }

    _matchesSingle(selector) {
        const id = selector.match(/^#([\w-]+)/);
        if (id) return this.id === id[1];
        const classes = [...selector.matchAll(/\.([\w-]+)/g)].map(match => match[1]);
        if (classes.some(className => !this.classList.contains(className))) return false;
        const attribute = selector.match(/\[([^\]=]+)(?:=(["']?)([^\]"']+)\2)?\]/);
        if (attribute) {
            const actual = this.getAttribute(attribute[1]) ?? this.dataset[attribute[1].replace(/^data-/, '')];
            if (actual === null || actual === undefined) return false;
            if (attribute[3] && String(actual) !== attribute[3]) return false;
        }
        const tag = selector.match(/^([a-zA-Z][\w-]*)/);
        return !tag || this.tagName === tag[1].toUpperCase();
    }

    querySelectorAll(selector) {
        const matches = [];
        const visit = node => {
            node.children.forEach(child => {
                if (child.matches(selector)) matches.push(child);
                visit(child);
            });
        };
        visit(this);
        return matches;
    }

    querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
    }
}

class FakeDocument {
    constructor() {
        this.activeElement = null;
        this.listeners = new Map();
        this.body = new FakeElement(this, 'body');
        this.body.parentNode = this;
        this.activeElement = this.body;
        this.host = new FakeElement(this, 'span');
        this.host.id = 'nextUiChatWorkerDrawerHost';
        this.body.append(this.host);
    }

    createElement(tagName) {
        return new FakeElement(this, tagName);
    }

    getElementById(id) {
        if (this.body.id === id) return this.body;
        if (this.host.id === id) return this.host;
        return this.body.querySelector(`#${id}`);
    }

    addEventListener(type, listener) {
        const listeners = this.listeners.get(type) || new Set();
        listeners.add(listener);
        this.listeners.set(type, listeners);
    }

    removeEventListener(type, listener) {
        this.listeners.get(type)?.delete(listener);
    }

    querySelector(selector) {
        return this.body.querySelector(selector);
    }
}

class FakeStore {
    constructor(jobs = []) {
        this.jobs = jobs;
        this.listeners = new Map();
        this.cancelled = [];
        this.cancelResult = true;
    }

    getJobs() {
        return this.jobs.map(job => ({ ...job }));
    }

    cancelWorkerJob(jobId) {
        this.cancelled.push(jobId);
        return typeof this.cancelResult === 'function' ? this.cancelResult(jobId) : this.cancelResult;
    }

    addEventListener(type, listener) {
        const listeners = this.listeners.get(type) || new Set();
        listeners.add(listener);
        this.listeners.set(type, listeners);
    }

    removeEventListener(type, listener) {
        this.listeners.get(type)?.delete(listener);
    }

    emit(type, detail) {
        for (const listener of [...(this.listeners.get(type) || [])]) listener({ type, detail });
    }
}

function createTimers() {
    const timers = {
        intervals: new Map(),
        timeouts: new Map(),
        nextId: 0,
        setInterval(callback, delay) {
            const id = ++timers.nextId;
            timers.intervals.set(id, { callback, delay });
            return id;
        },
        clearInterval(id) {
            timers.intervals.delete(id);
        },
        setTimeout(callback, delay) {
            const id = ++timers.nextId;
            timers.timeouts.set(id, { callback, delay });
            return id;
        },
        clearTimeout(id) {
            timers.timeouts.delete(id);
        },
        runInterval(id) {
            timers.intervals.get(id)?.callback();
        },
        runAllTimeouts() {
            for (const [id, timer] of [...timers.timeouts]) {
                timers.timeouts.delete(id);
                timer.callback();
            }
        }
    };
    return timers;
}

function createEscapeDispatcher() {
    const registrations = [];
    return {
        registrations,
        register(options) {
            registrations.push(options);
            return () => {
                options.disposed = true;
            };
        }
    };
}

function createHarness(jobs = []) {
    const document = new FakeDocument();
    const store = new FakeStore(jobs);
    const timers = createTimers();
    const escapeDispatcher = createEscapeDispatcher();
    const clock = { now: 1700000000000 };
    const owners = [];
    const releases = [];
    const drawer = new AICodeWorkerDrawer({
        document,
        store,
        escapeDispatcher,
        now: () => clock.now,
        setInterval: timers.setInterval,
        clearInterval: timers.clearInterval,
        setTimeout: timers.setTimeout,
        clearTimeout: timers.clearTimeout,
        acquireOverlay: owner => {
            owners.push(owner);
            return Promise.resolve(owner);
        },
        releaseOverlay: owner => {
            releases.push(owner);
            return true;
        },
    });
    assert.equal(drawer.mount(), true);
    return { clock, document, drawer, escapeDispatcher, owners, releases, store, timers };
}

function cards(harness) {
    return harness.drawer.element.querySelectorAll('.aicw-worker-drawer-card');
}

function cardFor(harness, jobId) {
    return cards(harness).find(card => card.dataset.jobid === jobId);
}

test('Drawer renders initial jobs, states, details and running count with stable safe nodes', async () => {
    const harness = createHarness([
        {
            jobId: 'job-running',
            state: 'running',
            worker: 'alpha',
            mode: 'live',
            startedAt: harnessNow => harnessNow,
        },
        {
            jobId: 'job-completed',
            state: 'completed',
            startedAt: 1699999940000,
            completedAt: 1699999970000,
            projectPath: 'C:\\safe\\project',
            pid: 0,
            exitCode: 0,
            exitReason: '<b>done</b>',
        },
        { jobId: 'job-failed', state: 'failed' },
        { jobId: 'job-cancelled', state: 'cancelled' },
        { jobId: 'job-timeout', state: 'timeout' },
        {
            jobId: 'job-unknown',
            state: '<img src=x onerror=alert(1)>',
            projectPath: '<script>bad()</script>',
        },
    ]);
    harness.store.jobs[0].startedAt = harness.clock.now - 65000;
    harness.store.emit('change');

    const initialCards = cards(harness);
    assert.equal(initialCards.length, 6);
    assert.equal(harness.drawer.element.hidden, true);
    assert.equal(harness.drawer.element.querySelector('.aicw-worker-drawer-list').textContent.includes('<script>bad()</script>'), true);
    assert.equal(harness.document.host.querySelector('.aicw-worker-drawer-running-count').textContent, '1');
    assert.equal(harness.document.host.querySelector('.aicw-worker-drawer-trigger').getAttribute('aria-label'), '伴随任务，运行中 1 个');
    assert.equal(harness.document.host.querySelector('.aicw-worker-drawer-trigger').dataset.running, 'true');

    const running = cardFor(harness, 'job-running');
    const completed = cardFor(harness, 'job-completed');
    const unknown = cardFor(harness, 'job-unknown');
    assert.equal(running.classList.contains('aicw-state-running'), true);
    assert.equal(completed.classList.contains('aicw-state-completed'), true);
    assert.equal(completed.querySelector('.aicw-worker-drawer-state-label').textContent, '已完成');
    assert.equal(completed.querySelector('.aicw-worker-drawer-detail-value').textContent, 'C:\\safe\\project');
    assert.equal(unknown.classList.contains('aicw-state-unknown'), true);
    assert.equal(unknown.querySelector('.aicw-worker-drawer-state-label').textContent, '<img src=x onerror=alert(1)>');

    const toggle = running.querySelector('.aicw-worker-drawer-card-toggle');
    const details = running.querySelector('.aicw-worker-drawer-details');
    toggle.focus();
    toggle.click();
    assert.equal(details.hidden, false);
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');

    const beforeUpdate = running;
    harness.clock.now += 5000;
    harness.store.jobs = harness.store.jobs.map(job => job.jobId === 'job-running'
        ? { ...job, worker: 'beta', mode: 'batch' }
        : job);
    harness.store.emit('change');
    assert.equal(cardFor(harness, 'job-running'), beforeUpdate);
    assert.equal(details.hidden, false);
    assert.equal(harness.document.activeElement, toggle);
    assert.equal(running.querySelector('.aicw-worker-drawer-elapsed').textContent, '1m10s');

    await harness.drawer.open();
    assert.equal(harness.drawer.element.hidden, false);
    assert.equal(harness.drawer.element.classList.contains('active'), true);
    assert.equal(harness.owners.length, 1);
    harness.drawer.close({ immediate: true });
    assert.equal(harness.drawer.element.classList.contains('active'), false);
    assert.equal(harness.releases.length, 1);
});

test('Drawer timer updates elapsed text without replacing the running card', () => {
    const harness = createHarness([{
        jobId: 'timer-job',
        state: 'running',
        startedAt: 1700000000000,
    }]);
    const card = cardFor(harness, 'timer-job');
    const intervalId = [...harness.timers.intervals.keys()][0];
    harness.clock.now += 10000;
    harness.timers.runInterval(intervalId);
    assert.equal(cardFor(harness, 'timer-job'), card);
    assert.equal(card.querySelector('.aicw-worker-drawer-elapsed').textContent, '10s');
});

test('Drawer rolls back a render exception and releases only the failed opening lease', async () => {
    const harness = createHarness([]);
    const originalUpdate = harness.drawer.update;
    let injectFailure = true;
    harness.drawer.update = function updateWithOneInjectedFailure(...args) {
        if (injectFailure) {
            injectFailure = false;
            throw new Error('injected drawer render failure');
        }
        return originalUpdate.apply(this, args);
    };

    const unhandled = [];
    const onUnhandledRejection = reason => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandledRejection);
    let firstOpen;
    try {
        firstOpen = await harness.drawer.open();
        await new Promise(resolve => setImmediate(resolve));
    } finally {
        process.removeListener('unhandledRejection', onUnhandledRejection);
    }

    assert.equal(firstOpen, false);
    assert.equal(harness.drawer.element.hidden, true);
    assert.equal(harness.drawer.element.getAttribute('aria-hidden'), 'true');
    assert.equal(harness.document.host.querySelector('.aicw-worker-drawer-trigger').getAttribute('aria-expanded'), 'false');
    assert.equal(harness.drawer.isOpen, false);
    assert.equal(harness.drawer._attempt, null);
    assert.equal(harness.drawer._activeAttempt, null);
    assert.equal(harness.releases.length, 1);
    assert.equal(harness.releases[0], harness.owners[0]);
    assert.equal(unhandled.length, 0);

    assert.equal(await harness.drawer.open(), true);
    assert.equal(harness.owners.length, 2);
    assert.equal(harness.releases.length, 1);
    harness.drawer.close({ immediate: true });
    assert.equal(harness.releases.length, 2);
});

test('Drawer preserves focus and expansion when data changes without card reordering', () => {
    const harness = createHarness([
        { jobId: 'same-first', state: 'running', worker: 'before' },
        { jobId: 'same-second', state: 'completed', worker: 'stable' },
    ]);
    const firstCard = cardFor(harness, 'same-first');
    const details = firstCard.querySelector('.aicw-worker-drawer-details');
    const cancel = firstCard.querySelector('.aicw-worker-drawer-cancel');
    firstCard.querySelector('.aicw-worker-drawer-card-toggle').click();
    cancel.focus();

    harness.store.jobs = [
        { jobId: 'same-first', state: 'running', worker: 'after' },
        { jobId: 'same-second', state: 'completed', worker: 'stable' },
    ];
    harness.store.emit('change');

    assert.equal(cardFor(harness, 'same-first'), firstCard);
    assert.equal(details.hidden, false);
    assert.equal(harness.document.activeElement, cancel);
    assert.equal(harness.drawer.element.querySelector('.aicw-worker-drawer-list').children[0], firstCard);
});

test('Drawer reorders by reusing cards and restores an in-drawer focus without scrolling', () => {
    const harness = createHarness([
        { jobId: 'reorder-first', state: 'completed' },
        { jobId: 'reorder-second', state: 'running' },
    ]);
    const firstCard = cardFor(harness, 'reorder-first');
    const secondCard = cardFor(harness, 'reorder-second');
    const details = secondCard.querySelector('.aicw-worker-drawer-details');
    const cancel = secondCard.querySelector('.aicw-worker-drawer-cancel');
    secondCard.querySelector('.aicw-worker-drawer-card-toggle').click();
    cancel.focus();

    harness.store.jobs = [
        { jobId: 'reorder-second', state: 'running', worker: 'still-running' },
        { jobId: 'reorder-first', state: 'completed', worker: 'stable' },
    ];
    harness.store.emit('change');

    const list = harness.drawer.element.querySelector('.aicw-worker-drawer-list');
    assert.deepEqual([...list.children].map(card => card.dataset.jobid), ['reorder-second', 'reorder-first']);
    assert.equal(cardFor(harness, 'reorder-first'), firstCard);
    assert.equal(cardFor(harness, 'reorder-second'), secondCard);
    assert.equal(details.hidden, false);
    assert.equal(harness.document.activeElement, cancel);
    assert.deepEqual(cancel.focusCalls.at(-1), { preventScroll: true });
});

test('Drawer does not steal outside focus or restore a deleted control', () => {
    const harness = createHarness([
        { jobId: 'outside-first', state: 'completed' },
        { jobId: 'outside-second', state: 'running' },
    ]);
    const outside = harness.document.createElement('button');
    harness.document.body.append(outside);
    outside.focus();
    harness.store.jobs = [
        { jobId: 'outside-second', state: 'running' },
        { jobId: 'outside-first', state: 'completed' },
    ];
    harness.store.emit('change');
    assert.equal(harness.document.activeElement, outside);

    const deletedHarness = createHarness([{ jobId: 'deleted-control', state: 'running' }]);
    const deletedCard = cardFor(deletedHarness, 'deleted-control');
    const cancel = deletedCard.querySelector('.aicw-worker-drawer-cancel');
    cancel.focus();
    deletedHarness.store.jobs = [{ jobId: 'deleted-control', state: 'completed' }];
    deletedHarness.store.emit('change');
    assert.equal(cancel.parentNode, null);
    assert.equal(cancel.isConnected, false);
    assert.notEqual(deletedHarness.document.activeElement, cancel);
    assert.equal(deletedHarness.document.activeElement, deletedHarness.document.body);
});

test('Drawer cancellation stays conservative and prevents duplicate requests', () => {
    const harness = createHarness([{ jobId: 'cancel-job', state: 'running', startedAt: 1700000000000 }]);
    const card = cardFor(harness, 'cancel-job');
    const cancel = card.querySelector('.aicw-worker-drawer-cancel');

    cancel.click();
    assert.deepEqual(harness.store.cancelled, ['cancel-job']);
    assert.equal(cancel.disabled, true);
    assert.match(card.textContent, /已请求，等待确认/);
    cancel.click();
    assert.deepEqual(harness.store.cancelled, ['cancel-job']);

    harness.store.emit('action-result', {
        action: 'cancel',
        jobId: 'cancel-job',
        success: true,
        resultSummary: 'returned',
    });
    assert.match(card.textContent, /请求已返回，等待任务状态确认/);
    assert.equal(cancel.disabled, true);

    harness.store.jobs = [{
        jobId: 'cancel-job',
        state: 'completed',
        startedAt: 1700000000000,
        completedAt: harness.clock.now,
    }];
    harness.store.emit('change');
    assert.equal(cardFor(harness, 'cancel-job'), card);
    assert.equal(card.classList.contains('aicw-state-completed'), true);
    assert.equal(card.querySelector('.aicw-worker-drawer-cancel'), null);
    assert.equal(card.querySelector('.aicw-worker-drawer-card-notice').hidden, true);
});

test('Drawer exposes sending failures, action failures and confirmation timeout without inventing cancellation', async () => {
    const unavailable = createHarness([{ jobId: 'unavailable', state: 'running' }]);
    unavailable.store.cancelResult = false;
    const unavailableCard = cardFor(unavailable, 'unavailable');
    unavailableCard.querySelector('.aicw-worker-drawer-cancel').click();
    assert.match(unavailableCard.textContent, /发送失败/);
    assert.equal(unavailableCard.querySelector('.aicw-worker-drawer-cancel').disabled, false);

    const failed = createHarness([{ jobId: 'failed-action', state: 'running' }]);
    const failedCard = cardFor(failed, 'failed-action');
    failedCard.querySelector('.aicw-worker-drawer-cancel').click();
    failed.store.emit('action-result', {
        action: 'cancel',
        jobId: 'failed-action',
        success: false,
        error: 'backend rejected <unsafe>',
    });
    assert.match(failedCard.textContent, /操作失败反馈：backend rejected <unsafe>/);
    assert.equal(failedCard.querySelector('.aicw-worker-drawer-cancel').disabled, false);

    const timedOut = createHarness([{ jobId: 'timed-out', state: 'running' }]);
    const timedOutCard = cardFor(timedOut, 'timed-out');
    timedOutCard.querySelector('.aicw-worker-drawer-cancel').click();
    timedOut.timers.runAllTimeouts();
    assert.match(timedOutCard.textContent, /未确认/);
    assert.equal(timedOutCard.querySelector('.aicw-worker-drawer-cancel').disabled, false);
    timedOutCard.querySelector('.aicw-worker-drawer-cancel').click();
    assert.deepEqual(timedOut.store.cancelled, ['timed-out', 'timed-out']);
    timedOut.store.emit('action-result', {
        action: 'cancel',
        jobId: 'timed-out',
        success: true,
    });
    assert.match(timedOutCard.textContent, /无法关联具体请求/);

    const rejected = createHarness([{ jobId: 'promise-failure', state: 'running' }]);
    rejected.store.cancelResult = () => Promise.reject(new Error('promise send failed'));
    const rejectedCard = cardFor(rejected, 'promise-failure');
    rejectedCard.querySelector('.aicw-worker-drawer-cancel').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.match(rejectedCard.textContent, /发送失败/);
});

test('Drawer close and reopen do not resend cancellation requests', async () => {
    const harness = createHarness([{ jobId: 'reopen-job', state: 'running' }]);
    const card = cardFor(harness, 'reopen-job');
    card.querySelector('.aicw-worker-drawer-cancel').click();
    harness.drawer.close({ immediate: true });
    await harness.drawer.open();
    assert.deepEqual(harness.store.cancelled, ['reopen-job']);
    assert.equal(card.querySelector('.aicw-worker-drawer-cancel').disabled, true);
    harness.drawer.destroy();
    harness.drawer.destroy();
    assert.equal(harness.timers.intervals.size, 0);
    assert.equal(harness.store.listeners.get('change')?.size || 0, 0);
    assert.equal(harness.store.listeners.get('action-result')?.size || 0, 0);
});

test('Drawer docks into mainPanel when available and manages resizer visibility', async () => {
    const document = new FakeDocument();
    const mainPanel = document.createElement('section');
    mainPanel.id = 'nextUiMainPanel';
    const notifSidebar = document.createElement('aside');
    notifSidebar.id = 'notificationsSidebar';
    mainPanel.append(notifSidebar);
    document.body.append(mainPanel);

    const store = new FakeStore([]);
    const timers = createTimers();
    const drawer = new AICodeWorkerDrawer({
        document,
        store,
        setInterval: timers.setInterval,
        clearInterval: timers.clearInterval,
        setTimeout: timers.setTimeout,
        clearTimeout: timers.clearTimeout,
    });

    assert.equal(drawer.mount(), true);
    assert.equal(drawer.element.parentNode, mainPanel);
    assert.equal(mainPanel.children[0].id, 'aicwWorkerDrawerResizer');
    assert.equal(mainPanel.children[1].id, 'aicwWorkerDrawer');
    assert.equal(mainPanel.children[2].id, 'notificationsSidebar');

    const resizer = mainPanel.children[0];
    assert.equal(resizer.hidden, true);
    await drawer.open();
    assert.equal(resizer.hidden, false);
    assert.equal(drawer.element.classList.contains('active'), true);
    drawer.close({ immediate: true });
    assert.equal(resizer.hidden, true);
    assert.equal(drawer.element.classList.contains('active'), false);
    drawer.destroy();
});

test('Drawer enforces mutual exclusion with notifications sidebar', async () => {
    const document = new FakeDocument();
    const notifSidebar = document.createElement('aside');
    notifSidebar.id = 'notificationsSidebar';
    document.body.append(notifSidebar);

    let toggledCount = 0;
    let notifListener = null;
    const fakeChatApi = {
        sendToggleNotificationsSidebar() {
            toggledCount += 1;
            notifSidebar.classList.remove('active');
        },
        onDoToggleNotificationsSidebar(fn) {
            notifListener = fn;
            return () => { notifListener = null; };
        }
    };

    const store = new FakeStore([]);
    const timers = createTimers();
    const drawer = new AICodeWorkerDrawer({
        document,
        store,
        chatAPI: fakeChatApi,
        setInterval: timers.setInterval,
        clearInterval: timers.clearInterval,
        setTimeout: timers.setTimeout,
        clearTimeout: timers.clearTimeout,
    });

    assert.equal(drawer.mount(), true);

    notifSidebar.classList.add('active');
    await drawer.open();
    assert.equal(drawer.isOpen, true);
    assert.equal(toggledCount, 1);

    notifSidebar.classList.add('active');
    notifListener?.();
    assert.equal(drawer.isOpen, false);

    drawer.destroy();
});