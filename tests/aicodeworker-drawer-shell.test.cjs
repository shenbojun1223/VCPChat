const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const storeSource = source('modules/AICodeWorkerStore.js');
const drawerSource = source('modules/AICodeWorkerDrawer.js');
const overlaySource = source('modules/ui-system/next-shell/overlay-coordinator.js');
const escapeSource = source('modules/ui-system/next-shell/escape-dispatcher.js');
const shellSource = source('modules/ui-system/next-shell/next-shell-controller.js');

class FakeEventTarget {
    constructor() {
        this.listeners = new Map();
    }

    addEventListener(type, listener, options = {}) {
        if (typeof listener !== 'function') return;
        const signal = typeof options === 'object' ? options?.signal : null;
        if (signal?.aborted) return;
        const record = { type, listener, options, signal, abortListener: null };
        if (signal?.addEventListener) {
            record.abortListener = () => this._removeRecord(record);
            signal.addEventListener('abort', record.abortListener, { once: true });
        }
        const records = this.listeners.get(type) || new Set();
        records.add(record);
        this.listeners.set(type, records);
    }

    removeEventListener(type, listener) {
        for (const record of [...(this.listeners.get(type) || [])]) {
            if (record.listener === listener) this._removeRecord(record);
        }
    }

    _removeRecord(record) {
        const records = this.listeners.get(record.type);
        if (!records?.delete(record)) return;
        if (record.signal?.removeEventListener && record.abortListener) {
            record.signal.removeEventListener('abort', record.abortListener);
        }
        if (records.size === 0) this.listeners.delete(record.type);
    }

    dispatchEvent(event) {
        if (!event || typeof event.type !== 'string') throw new TypeError('Fake events require a type.');
        try {
            if (!event.target) event.target = this;
        } catch {}
        try {
            event.currentTarget = this;
        } catch {}
        const records = [...(this.listeners.get(event.type) || [])];
        for (const record of records) {
            if (!this.listeners.get(event.type)?.has(record)) continue;
            record.listener.call(this, event);
            if (record.options?.once) this._removeRecord(record);
            if (event.immediatePropagationStopped) break;
        }
        return !event.defaultPrevented;
    }

    listenerCount(type) {
        return (this.listeners.get(type) || new Set()).size;
    }
}

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

    toggle(name, force) {
        const next = force === undefined ? !this.tokens.has(name) : Boolean(force);
        if (next) this.add(name);
        else this.remove(name);
        return next;
    }

    contains(name) {
        return this.tokens.has(name);
    }
}

class FakeElement extends FakeEventTarget {
    constructor(document, tagName) {
        super();
        this.ownerDocument = document;
        this.tagName = String(tagName).toUpperCase();
        this.children = [];
        this.parentNode = null;
        this.attributes = new Map();
        this.dataset = {};
        this.style = {
            display: '',
            setProperty: (name, value) => { this.style[name] = String(value); },
        };
        this.hidden = false;
        this.disabled = false;
        this._text = null;
        this._innerHTML = '';
        this._className = '';
        this._id = '';
        this._title = '';
        this.classList = new FakeClassList(this);
    }

    set id(value) {
        this._id = String(value || '');
        if (this._id) this.attributes.set('id', this._id);
        else this.attributes.delete('id');
    }

    get id() {
        return this._id;
    }

    set className(value) {
        this._className = String(value || '');
        this.classList.sync(this._className);
    }

    get className() {
        return this._className;
    }

    set title(value) {
        this._title = String(value || '');
        if (this._title) this.attributes.set('title', this._title);
        else this.attributes.delete('title');
    }

    get title() {
        return this._title;
    }

    set textContent(value) {
        this._text = String(value ?? '');
        this._innerHTML = '';
        this.children.splice(0).forEach(child => { child.parentNode = null; });
    }

    get textContent() {
        if (this._text !== null) return this._text;
        return this.children.map(child => child.textContent).join('');
    }

    set innerHTML(value) {
        this._innerHTML = String(value ?? '');
        this._text = null;
        this.children.splice(0).forEach(child => { child.parentNode = null; });
    }

    get innerHTML() {
        return this._innerHTML || this.textContent;
    }

    append(...nodes) {
        nodes.filter(Boolean).forEach(node => {
            if (typeof node === 'string') return;
            if (node.parentNode) node.parentNode.removeChild(node);
            this.children.push(node);
            node.parentNode = this;
        });
        this._text = null;
        this._innerHTML = '';
    }

    appendChild(node) {
        this.append(node);
        return node;
    }

    before(node) {
        if (!this.parentNode) return;
        const siblings = this.parentNode.children;
        const index = siblings.indexOf(this);
        if (index < 0) return;
        if (node.parentNode) node.parentNode.removeChild(node);
        siblings.splice(index, 0, node);
        node.parentNode = this.parentNode;
    }

    removeChild(node) {
        const index = this.children.indexOf(node);
        if (index >= 0) {
            this.children.splice(index, 1);
            node.parentNode = null;
        }
        return node;
    }

    replaceChildren(...nodes) {
        this.children.splice(0).forEach(child => { child.parentNode = null; });
        this._text = null;
        this._innerHTML = '';
        this.append(...nodes);
    }

    remove() {
        this.parentNode?.removeChild(this);
    }

    dispatch(type, event = {}) {
        const payload = event;
        payload.type = type;
        payload.target ||= this;
        payload.currentTarget ||= this;
        payload.defaultPrevented ||= false;
        payload.preventDefault ||= () => { payload.defaultPrevented = true; };
        payload.stopPropagation ||= () => { payload.propagationStopped = true; };
        payload.stopImmediatePropagation ||= () => {
            payload.propagationStopped = true;
            payload.immediatePropagationStopped = true;
        };
        return this.dispatchEvent(payload);
    }

    click() {
        return this.dispatch('click');
    }

    focus() {
        this.ownerDocument.activeElement = this;
    }

    setAttribute(name, value) {
        const stringValue = String(value);
        this.attributes.set(name, stringValue);
        if (name === 'id') this.id = stringValue;
        if (name === 'class') this.className = stringValue;
        if (name === 'title') this.title = stringValue;
        if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = stringValue;
    }

    getAttribute(name) {
        if (this.attributes.has(name)) return this.attributes.get(name);
        if (name.startsWith('data-')) {
            const key = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
            return Object.prototype.hasOwnProperty.call(this.dataset, key) ? String(this.dataset[key]) : null;
        }
        return null;
    }

    hasAttribute(name) {
        return this.getAttribute(name) !== null;
    }

    removeAttribute(name) {
        this.attributes.delete(name);
        if (name === 'id') this.id = '';
        if (name === 'title') this.title = '';
        if (name.startsWith('data-')) {
            const key = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
            delete this.dataset[key];
        }
    }

    get isConnected() {
        let node = this;
        while (node?.parentNode) node = node.parentNode;
        return node === this.ownerDocument;
    }

    contains(candidate) {
        let node = candidate;
        while (node) {
            if (node === this) return true;
            node = node.parentNode;
        }
        return false;
    }

    matches(selector) {
        return String(selector).split(',').some(part => this._matchesSingle(part.trim()));
    }

    _matchesSingle(selector) {
        if (!selector || selector.includes(' ')) return false;
        const idMatches = [...selector.matchAll(/#([\w-]+)/g)].map(match => match[1]);
        if (idMatches.some(id => this.id !== id)) return false;
        const classMatches = [...selector.matchAll(/\.([\w-]+)/g)].map(match => match[1]);
        if (classMatches.some(name => !this.classList.contains(name))) return false;
        const attributes = [...selector.matchAll(/\[([^\]=\s]+)(?:=(['"]?)([^\]'"]+)\2)?\]/g)];
        if (attributes.some(([, name, , expected]) => {
            const actual = this.getAttribute(name);
            return actual === null || (expected !== undefined && String(actual) !== expected);
        })) return false;
        const tag = selector.match(/^([a-zA-Z][\w-]*)/);
        return !tag || this.tagName === tag[1].toUpperCase();
    }

    closest(selector) {
        let node = this;
        while (node && typeof node.matches === 'function') {
            if (node.matches(selector)) return node;
            node = node.parentNode;
        }
        return null;
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

    getBoundingClientRect() {
        return { left: 0, top: 0, right: 120, bottom: 32, width: 120, height: 32 };
    }

    setPointerCapture() {}
}

class FakeDocument extends FakeEventTarget {
    constructor() {
        super();
        this.activeElement = null;
        this.defaultView = null;
        this.documentElement = new FakeElement(this, 'html');
        this.documentElement.parentNode = this;
        this.body = new FakeElement(this, 'body');
        this.body.parentNode = this;
        this.children = [this.documentElement, this.body];
    }

    createElement(tagName) {
        return new FakeElement(this, tagName);
    }

    getElementById(id) {
        return this.children.map(root => root.id === id ? root : root.querySelector(`#${id}`)).find(Boolean) || null;
    }

    querySelectorAll(selector) {
        return this.children.flatMap(root => root.matches(selector) ? [root, ...root.querySelectorAll(selector)] : root.querySelectorAll(selector));
    }

    querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
    }
}

class FakeMutationObserver {
    constructor(callback) {
        this.callback = callback;
        this.observed = false;
        this.disconnected = false;
    }

    observe() {
        this.observed = true;
    }

    disconnect() {
        this.disconnected = true;
    }
}

class FakeStorage {
    constructor() {
        this.values = new Map();
    }

    getItem(key) {
        return this.values.has(key) ? this.values.get(key) : null;
    }

    setItem(key, value) {
        this.values.set(String(key), String(value));
    }

    removeItem(key) {
        this.values.delete(String(key));
    }
}

function createTimers() {
    const timers = {
        nextId: 0,
        intervals: new Map(),
        timeouts: new Map(),
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
    };
    return timers;
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

async function flush() {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise(resolve => setImmediate(resolve));
    await Promise.resolve();
}

function keydown(document) {
    const event = {
        type: 'keydown',
        key: 'Escape',
        defaultPrevented: false,
        propagationStopped: false,
        immediatePropagationStopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.propagationStopped = true; },
        stopImmediatePropagation() {
            this.propagationStopped = true;
            this.immediatePropagationStopped = true;
        },
    };
    const dispatchResult = document.dispatchEvent(event);
    return { dispatchResult, event };
}

class TestLifecycleScope {
    constructor(label, owner) {
        this.label = label;
        this.owner = owner;
        this.records = [];
        this.disposed = false;
        this.disposeCalls = 0;
        this.disposePromise = null;
    }

    _record(kind, label, cleanup) {
        const record = { kind, label, cleaned: false, cleanup };
        record.release = () => {
            if (record.cleaned) return undefined;
            record.cleaned = true;
            return cleanup?.();
        };
        this.records.push(record);
        return record.release;
    }

    listen(target, type, handler, options, label = `${this.label}:${type}`) {
        target.addEventListener(type, handler, options);
        return this._record('listen', label, () => target.removeEventListener(type, handler, options));
    }

    own(resource, label = `${this.label}:owned`, category = 'resource') {
        const cleanup = typeof resource === 'function'
            ? resource
            : () => resource?.dispose?.();
        return this._record(`${category}:own`, label, cleanup) && resource;
    }

    observe(observer, target, options, label = `${this.label}:observer`) {
        observer.observe(target, options);
        return this._record('observe', label, () => observer.disconnect?.());
    }

    child(label) {
        const child = new TestLifecycleScope(label, this.owner);
        this._record('child', label, () => child.dispose(`parent:${this.label}`));
        return child;
    }

    dispose(reason) {
        if (this.disposePromise) return this.disposePromise;
        this.disposed = true;
        this.disposeCalls += 1;
        this.disposePromise = (async () => {
            const pending = [];
            for (const record of [...this.records].reverse()) {
                try {
                    const result = record.release();
                    if (result && typeof result.then === 'function') pending.push(result);
                } catch (error) {
                    pending.push(Promise.reject(error));
                }
            }
            await Promise.all(pending);
            return reason;
        })();
        return this.disposePromise;
    }
}

class StubController {
    constructor(name) {
        this.name = name;
        this.mounted = false;
        this.disposeCalls = 0;
    }

    mount(scope) {
        if (this.mounted) return;
        this.mounted = true;
        if (scope) scope.own(() => this.dispose(), `stub:${this.name}`, 'controller');
    }

    dispose() {
        if (!this.mounted) return;
        this.mounted = false;
        this.disposeCalls += 1;
    }
}

class StubAppTabHost extends StubController {
    constructor(options = {}) {
        super('app-tabs');
        this.document = options.document;
        this.views = new Map();
        this.activeViewId = 'home';
        this.revision = 0;
    }

    readSession() {
        return null;
    }

    persist() {}

    snapshot() {
        return { tabs: [], activeViewId: this.activeViewId };
    }

    createTab({ id, title }) {
        const tab = this.document.createElement('button');
        tab.dataset.viewId = id;
        tab.title = title || '';
        return tab;
    }

    register(id, view) {
        this.views.set(id, view);
    }

    unregister(id) {
        this.views.delete(id);
        if (this.activeViewId === id) this.activeViewId = 'home';
        this.revision += 1;
    }

    setView(viewId) {
        this.activeViewId = viewId;
        this.revision += 1;
    }

    updateVisibility() {}
}

function createHarness(options = {}) {
    const timers = createTimers();
    const document = new FakeDocument();
    const warnings = [];
    const errors = [];
    const events = [];
    const scopes = [];
    const hideCalls = [];
    const hideDefers = [];
    const legacy = {
        hidePanelCalls: 0,
        panelOpen: true,
    };
    const storage = new FakeStorage();
    const sessionStorage = new FakeStorage();
    const windowTarget = new FakeEventTarget();
    const services = {
        hideEmbeddedView() {
            const call = { index: hideCalls.length + 1 };
            hideCalls.push(call);
            const result = options.hideBehavior?.(call.index, { hideDefers, hideCalls });
            if (result !== undefined) return result;
            return Promise.resolve({ success: true });
        },
        activate() {
            return Promise.resolve({ success: true });
        },
    };

    const host = document.createElement('span');
    host.id = 'nextUiChatWorkerDrawerHost';
    document.body.append(host);
    if (options.includeDrawerHost === false) host.remove();

    const legacyToggle = document.createElement('button');
    legacyToggle.id = 'worker-panel-toggle';
    legacyToggle.hidden = Boolean(options.legacyHidden);
    legacyToggle.style.display = options.legacyDisplay ?? 'inline-flex';
    document.body.append(legacyToggle);
    const legacyPanel = document.createElement('aside');
    legacyPanel.id = 'worker-panel';
    legacyPanel.hidden = false;
    document.body.append(legacyPanel);

    const context = {
        console: {
            warn: (...args) => warnings.push(args),
            error: (...args) => errors.push(args),
            log: () => {},
        },
        document,
        Date,
        Event,
        EventTarget,
        CustomEvent: class TestCustomEvent extends Event {
            constructor(type, init = {}) {
                super(type, init);
                this.detail = init.detail;
            }
        },
        AbortController,
        Element: FakeElement,
        MutationObserver: FakeMutationObserver,
        requestAnimationFrame: callback => {
            callback();
            return 1;
        },
        cancelAnimationFrame: () => {},
        setInterval: timers.setInterval,
        clearInterval: timers.clearInterval,
        setTimeout: timers.setTimeout,
        clearTimeout: timers.clearTimeout,
        queueMicrotask: callback => globalThis.queueMicrotask(callback),
        localStorage: storage,
        sessionStorage,
        innerWidth: 1200,
        screenX: 0,
        screenY: 0,
        outerWidth: 1200,
        outerHeight: 800,
        VCPPerformance: { begin: () => () => {} },
        VCPUI: {
            feedback: {
                cancelAll: () => { events.push('feedback-cancel-all'); },
                toast: () => {},
            },
        },
        MainChatCommands: {
            subscribeWindowState: listener => {
                services.windowStateListener = listener;
                return () => { services.windowStateListener = null; };
            },
            openThemes: () => {},
            toggleTheme: () => {},
            openSettings: () => {},
            minimizeToTray: () => {},
            minimize: () => {},
            toggleMaximize: () => {},
            close: () => {},
        },
        WorkerPanelClient: {
            hidePanel: () => {
                legacy.hidePanelCalls += 1;
                legacy.panelOpen = false;
                legacyPanel.hidden = true;
            },
        },
        uiHelperFunctions: {
            closeModal: modalId => {
                const modal = document.getElementById(modalId);
                modal?.classList.remove('active');
                services.closedModals = (services.closedModals || 0) + 1;
                return true;
            },
            openModal: () => {},
            filterAgentList: () => {},
            showToastNotification: () => {},
        },
        nextUiApps: { list: () => [], get: () => null },
        trayManager: { getApps: () => [], getIcon: () => '' },
        chatAPI: {
            subscriptions: 0,
            unsubscribeCount: 0,
            callbacks: new Set(),
            cancelled: [],
            onWorkerPanelMessage(callback) {
                this.subscriptions += 1;
                this.callbacks.add(callback);
                return () => {
                    if (this.callbacks.delete(callback)) this.unsubscribeCount += 1;
                };
            },
            requestWorkerPanelSnapshot: () => {},
            cancelWorkerJob(jobId) {
                this.cancelled.push(jobId);
                return true;
            },
        },
    };
    context.window = context;
    context.addEventListener = windowTarget.addEventListener.bind(windowTarget);
    context.removeEventListener = windowTarget.removeEventListener.bind(windowTarget);
    context.dispatchEvent = windowTarget.dispatchEvent.bind(windowTarget);
    document.defaultView = context;

    const harness = {
        context,
        document,
        errors,
        events,
        hideCalls,
        hideDefers,
        legacy,
        legacyPanel,
        legacyToggle,
        services,
        scopes,
        timers,
        warnings,
        drawerInstances: [],
        overlayInstances: [],
        escapeInstances: [],
        store: null,
        listenerSets: null,
        persistentStoreListener: null,
        controller: null,
        cleanup: async () => {},
    };

    class StubEmbeddedAppController extends StubController {
        constructor() {
            super('embedded-apps');
            this.callback = null;
        }

        mount(scope, callback) {
            super.mount(scope);
            this.callback = callback;
        }

        hide() {
            return services.hideEmbeddedView();
        }

        activate() {
            return services.activate();
        }

        list() {
            return Promise.resolve({ sessions: [], activeAction: null });
        }

        close() {
            return Promise.resolve({ success: true });
        }

        closeAll() {
            return Promise.resolve({ success: true });
        }

        create() {
            return Promise.resolve({ success: true });
        }

        detach() {
            return Promise.resolve({ success: true });
        }

        setBounds() {
            return Promise.resolve({ success: true });
        }
    }

    class StubSearchController extends StubController {
        constructor() { super('assistant-search'); }
    }

    class StubAccountController extends StubController {
        constructor() { super('account-menu'); }
        open() {}
    }

    class StubNotificationController extends StubController {
        constructor() { super('notifications'); }
    }

    class StubLaunchpadController extends StubController {
        constructor() { super('launchpad'); }
        render() {}
    }

    class StubCreationController extends StubController {
        constructor() { super('creation'); }
        open() { return Promise.resolve(true); }
        close() {}
    }

    context.VCPNextShell = {
        EmbeddedAppController: StubEmbeddedAppController,
        AppTabHost: StubAppTabHost,
        AssistantSearchController: StubSearchController,
        AccountMenuController: StubAccountController,
        NotificationMenuController: StubNotificationController,
        LaunchpadController: StubLaunchpadController,
        CreationController: StubCreationController,
    };

    vm.runInNewContext(storeSource, context, { filename: 'modules/AICodeWorkerStore.js' });
    vm.runInNewContext(drawerSource, context, { filename: 'modules/AICodeWorkerDrawer.js' });
    vm.runInNewContext(overlaySource, context, { filename: 'modules/ui-system/next-shell/overlay-coordinator.js' });
    vm.runInNewContext(escapeSource, context, { filename: 'modules/ui-system/next-shell/escape-dispatcher.js' });

    const ActualDrawer = context.AICodeWorkerDrawer;
    const ActualOverlayCoordinator = context.VCPNextShell.OverlayCoordinator;
    const ActualEscapeDispatcher = context.VCPNextShell.EscapeDispatcher;

    class RecordingDrawer extends ActualDrawer {
        constructor(drawerOptions) {
            super(drawerOptions);
            harness.drawerInstances.push(this);
        }

        destroy() {
            harness.events.push('drawer-destroy');
            return super.destroy();
        }
    }

    class RecordingOverlayCoordinator extends ActualOverlayCoordinator {
        constructor(coordinatorOptions) {
            super(coordinatorOptions);
            harness.overlayInstances.push(this);
        }

        dispose() {
            harness.events.push('coordinator-dispose');
            return super.dispose();
        }
    }

    class RecordingEscapeDispatcher extends ActualEscapeDispatcher {
        constructor(dispatcherOptions) {
            super(dispatcherOptions);
            harness.escapeInstances.push(this);
        }
    }

    context.AICodeWorkerDrawer = RecordingDrawer;
    context.VCPNextShell = Object.freeze({
        ...context.VCPNextShell,
        OverlayCoordinator: RecordingOverlayCoordinator,
        EscapeDispatcher: RecordingEscapeDispatcher,
    });

    harness.store = context.aicodeWorkerStore;
    assert.equal(harness.store.init(), true);
    const listenerSets = new Map();
    const nativeAdd = harness.store.addEventListener.bind(harness.store);
    const nativeRemove = harness.store.removeEventListener.bind(harness.store);
    harness.store.addEventListener = (type, listener, options) => {
        const listeners = listenerSets.get(type) || new Set();
        listeners.add(listener);
        listenerSets.set(type, listeners);
        return nativeAdd(type, listener, options);
    };
    harness.store.removeEventListener = (type, listener, options) => {
        listenerSets.get(type)?.delete(listener);
        return nativeRemove(type, listener, options);
    };
    harness.listenerSets = listenerSets;
    harness.persistentStoreListener = () => {};
    harness.store.addEventListener('change', harness.persistentStoreListener);

    vm.runInNewContext(shellSource, context, { filename: 'modules/ui-system/next-shell/next-shell-controller.js' });
    harness.controller = context.VCPNextShellController;
    harness.cleanup = async () => {
        await harness.controller?.unmount?.();
        harness.store?.removeEventListener('change', harness.persistentStoreListener);
        harness.store?.destroy?.();
    };
    if (options.withScope) {
        context.VCPLifecycle = {
            LifecycleScope: class HarnessLifecycleScope extends TestLifecycleScope {
                constructor(label) {
                    super(label, harness);
                    scopes.push(this);
                }
            },
        };
    }

    return harness;
}

function drawerElements(harness) {
    return {
        drawer: harness.document.getElementById('aicwWorkerDrawer'),
        trigger: harness.document.getElementById('aicwWorkerDrawerToggle'),
        close: harness.document.getElementById('aicwWorkerDrawerClose'),
    };
}

function requireElement(element, label) {
    assert.ok(element, `${label} should exist`);
    return element;
}

function addRunningJob(harness, jobId = 'job-running') {
    harness.store.handleMessage({
        type: 'job_status_update',
        data: { jobId, state: 'running', worker: 'worker', startedAt: Date.now() - 1000 },
    });
}

test('Next Shell mounts, unmounts and remounts with and without LifecycleScope', async t => {
    for (const withScope of [false, true]) {
        await t.test(withScope ? 'LifecycleScope seam' : 'AbortController path', async t2 => {
            const harness = createHarness({ withScope });
            t2.after(() => harness.cleanup());
            harness.controller.mount();
            await flush();

            const firstDrawer = harness.drawerInstances[0];
            const firstElements = drawerElements(harness);
            requireElement(firstElements.trigger, 'drawer trigger');
            assert.equal(firstDrawer.mounted, true);
            assert.equal(harness.legacyToggle.hidden, true);
            assert.equal(harness.legacyToggle.style.display, 'none');
            assert.equal(harness.legacy.panelOpen, false);
            assert.equal(harness.legacy.hidePanelCalls, 1);
            assert.equal(harness.legacyPanel.hidden, true);
            assert.equal(harness.listenerSets.get('change').size, 2);
            assert.equal(harness.listenerSets.get('action-result').size, 1);
            assert.equal(harness.context.chatAPI.subscriptions, 1);
            assert.equal(harness.context.chatAPI.callbacks.size, 1);
            assert.equal(harness.timers.intervals.size, 1);
            assert.equal(harness.escapeInstances[0].entries.size, 2);

            addRunningJob(harness);
            const cancelButton = requireElement(harness.document.querySelector('.aicw-worker-drawer-cancel'), 'cancel button');
            cancelButton.click();
            assert.equal(harness.timers.timeouts.size, 1);

            const firstUnmount = harness.controller.unmount();
            const secondUnmount = harness.controller.unmount();
            await Promise.all([firstUnmount, secondUnmount]);
            await flush();

            assert.equal(firstDrawer.mounted, false);
            assert.equal(firstElements.drawer.isConnected, false);
            assert.equal(firstElements.trigger.listenerCount('click'), 0);
            assert.equal(firstElements.close.listenerCount('click'), 0);
            assert.equal(harness.timers.intervals.size, 0);
            assert.equal(harness.timers.timeouts.size, 0);
            assert.equal(harness.escapeInstances[0].mounted, false);
            assert.equal(harness.escapeInstances[0].entries.size, 0);
            assert.equal(harness.listenerSets.get('change').size, 1);
            assert.equal(harness.listenerSets.get('action-result').size, 0);
            assert.equal(harness.context.chatAPI.subscriptions, 1);
            assert.equal(harness.context.chatAPI.unsubscribeCount, 0);
            assert.deepEqual(harness.context.chatAPI.cancelled, ['job-running']);
            assert.equal(harness.store.getJob('job-running').state, 'running');
            assert.equal(harness.events.indexOf('drawer-destroy') >= 0, true);
            assert.equal(harness.events.indexOf('coordinator-dispose') >= 0, true);
            assert.ok(harness.events.indexOf('drawer-destroy') < harness.events.indexOf('coordinator-dispose'));
            assert.equal(harness.legacyToggle.hidden, false);
            assert.equal(harness.legacyToggle.style.display, 'inline-flex');

            if (withScope) {
                assert.equal(harness.scopes.length, 1);
                assert.equal(harness.scopes[0].disposeCalls, 1);
                assert.ok(harness.scopes[0].records.some(record => record.label === 'escape-dispatcher'));
                assert.ok(harness.scopes[0].records.some(record => record.label === 'overlay-coordinator'));
                assert.ok(harness.scopes[0].records.every(record => record.cleaned));
            }

            await harness.controller.unmount();
            harness.controller.mount();
            await flush();
            const secondDrawer = harness.drawerInstances[1];
            const secondElements = drawerElements(harness);
            assert.notEqual(secondDrawer, firstDrawer);
            assert.equal(secondDrawer.mounted, true);
            assert.equal(harness.legacyToggle.hidden, true);
            assert.equal(harness.legacyToggle.style.display, 'none');
            assert.equal(harness.legacy.hidePanelCalls, 2);
            assert.equal(harness.context.chatAPI.subscriptions, 1);
            assert.equal(harness.timers.intervals.size, 1);
            assert.equal(secondElements.drawer.hidden, true);

            await harness.controller.unmount();
            await flush();
            assert.equal(secondDrawer.mounted, false);
            assert.equal(harness.timers.intervals.size, 0);
            assert.equal(harness.listenerSets.get('change').size, 1);
            assert.equal(harness.context.chatAPI.unsubscribeCount, 0);
            assert.equal(harness.legacyToggle.hidden, false);
            assert.equal(harness.legacyToggle.style.display, 'inline-flex');
        });
    }
});

test('A failed Drawer mount leaves the legacy entry usable and does not hide it', async t => {
    const harness = createHarness({ includeDrawerHost: false });
    t.after(() => harness.cleanup());
    harness.controller.mount();
    await flush();

    assert.equal(harness.drawerInstances.length, 1);
    assert.equal(harness.drawerInstances[0].mounted, false);
    assert.equal(harness.drawerInstances[0]._destroyed, true);
    assert.equal(harness.document.getElementById('aicwWorkerDrawerToggle'), null);
    assert.equal(harness.legacy.hidePanelCalls, 0);
    assert.equal(harness.legacy.panelOpen, true);
    assert.equal(harness.legacyPanel.hidden, false);
    assert.equal(harness.legacyToggle.hidden, false);
    assert.equal(harness.legacyToggle.style.display, 'inline-flex');

    await harness.controller.unmount();
    await flush();
    assert.equal(harness.legacyToggle.hidden, false);
    assert.equal(harness.legacyToggle.style.display, 'inline-flex');
});

test('Drawer opening uses one pending acquire, independent owners, and handles reject', async t => {
    const pending = [];
    const harness = createHarness({
        hideBehavior: index => {
            if (index <= 2) {
                const item = deferred();
                pending.push(item);
                return item.promise;
            }
            return Promise.resolve({ success: true });
        },
    });
    t.after(() => harness.cleanup());
    harness.controller.mount();
    await flush();

    const elements = drawerElements(harness);
    elements.trigger.click();
    elements.trigger.click();
    await flush();
    assert.equal(harness.hideCalls.length, 1);
    assert.equal(harness.controller.getDiagnostics().overlay.owners.length, 1);
    assert.equal(elements.drawer.hidden, true);

    pending[0].resolve({ success: true });
    await flush();
    assert.equal(elements.drawer.hidden, false);
    const firstOwner = harness.controller.getDiagnostics().overlay.owners[0];
    elements.close.click();
    await flush();
    assert.equal(harness.controller.getDiagnostics().overlay.owners.length, 0);

    elements.trigger.click();
    await flush();
    assert.equal(harness.hideCalls.length, 2);
    const secondOwner = harness.controller.getDiagnostics().overlay.owners[0];
    assert.notEqual(secondOwner, firstOwner);
    pending[1].resolve({ success: true });
    await flush();
    assert.equal(elements.drawer.hidden, false);
    elements.close.click();

    await harness.controller.unmount();
    await flush();

    const rejectHarness = createHarness({
        hideBehavior: index => index === 1
            ? Promise.reject(new Error('hide failed'))
            : Promise.resolve({ success: true }),
    });
    t.after(() => rejectHarness.cleanup());
    rejectHarness.controller.mount();
    await flush();
    const rejectElements = drawerElements(rejectHarness);
    rejectElements.trigger.click();
    await flush();
    assert.equal(rejectElements.drawer.hidden, true);
    assert.equal(rejectHarness.controller.getDiagnostics().overlay.active, false);
    assert.equal(rejectHarness.drawerInstances[0]._state, 'idle');
    assert.ok(rejectHarness.warnings.some(args => args.join(' ').includes('Failed to hide embedded app')));
    await rejectHarness.controller.unmount();
});

test('Close and destroy release pending leases before late acquire results', async t => {
    const closePending = deferred();
    const closeHarness = createHarness({
        hideBehavior: index => index === 1 ? closePending.promise : Promise.resolve({ success: true }),
    });
    t.after(() => closeHarness.cleanup());
    closeHarness.controller.mount();
    await flush();
    const closeElements = drawerElements(closeHarness);
    closeElements.trigger.click();
    await flush();
    assert.equal(closeHarness.controller.getDiagnostics().overlay.active, true);
    closeElements.close.click();
    assert.equal(closeHarness.controller.getDiagnostics().overlay.active, false);
    closePending.resolve({ success: true });
    await flush();
    assert.equal(closeElements.drawer.hidden, true);
    assert.equal(closeHarness.controller.getDiagnostics().overlay.owners.length, 0);
    await closeHarness.controller.unmount();

    const destroyPending = deferred();
    const destroyHarness = createHarness({
        hideBehavior: index => index === 1 ? destroyPending.promise : Promise.resolve({ success: true }),
    });
    t.after(() => destroyHarness.cleanup());
    destroyHarness.controller.mount();
    await flush();
    const destroyElements = drawerElements(destroyHarness);
    destroyElements.trigger.click();
    await flush();
    const oldDrawerElement = destroyElements.drawer;
    const unmount = destroyHarness.controller.unmount();
    await unmount;
    assert.equal(oldDrawerElement.isConnected, false);
    assert.equal(destroyHarness.controller.getDiagnostics().overlay, null);
    destroyPending.resolve({ success: true });
    await flush();
    assert.equal(oldDrawerElement.hidden, true);
    assert.equal(destroyHarness.drawerInstances[0].mounted, false);
});

test('Open-close-open interleaving keeps the new owner after the old acquire resolves', async t => {
    const pending = [];
    const harness = createHarness({
        hideBehavior: index => {
            if (index <= 2) {
                const item = deferred();
                pending.push(item);
                return item.promise;
            }
            return Promise.resolve({ success: true });
        },
    });
    t.after(() => harness.cleanup());
    harness.controller.mount();
    await flush();
    const elements = drawerElements(harness);
    elements.trigger.click();
    await flush();
    elements.close.click();
    elements.trigger.click();
    await flush();

    assert.equal(harness.hideCalls.length, 2);
    const ownerDuringSecondOpen = harness.controller.getDiagnostics().overlay.owners[0];
    assert.ok(ownerDuringSecondOpen);
    pending[0].resolve({ success: true });
    await flush();
    assert.deepEqual(Array.from(harness.controller.getDiagnostics().overlay.owners), [ownerDuringSecondOpen]);
    assert.equal(elements.drawer.hidden, true);

    pending[1].resolve({ success: true });
    await flush();
    assert.equal(elements.drawer.hidden, false);
    assert.deepEqual(Array.from(harness.controller.getDiagnostics().overlay.owners), [ownerDuringSecondOpen]);
    elements.close.click();
    await harness.controller.unmount();
});

test('A late result from an old Shell generation cannot open the remounted Drawer', async t => {
    const oldAcquire = deferred();
    const newAcquire = deferred();
    const harness = createHarness({
        withScope: true,
        hideBehavior: index => {
            if (index === 1) return oldAcquire.promise;
            if (index === 3) return newAcquire.promise;
            return Promise.resolve({ success: true });
        },
    });
    t.after(() => harness.cleanup());
    harness.controller.mount();
    await flush();
    const oldElements = drawerElements(harness);
    oldElements.trigger.click();
    await flush();
    const oldDrawerElement = oldElements.drawer;

    await harness.controller.unmount();
    harness.controller.mount();
    await flush();
    const newElements = drawerElements(harness);
    assert.notEqual(newElements.drawer, oldDrawerElement);
    newElements.trigger.click();
    await flush();
    assert.equal(harness.hideCalls.length, 3);

    oldAcquire.resolve({ success: true });
    await flush();
    assert.equal(newElements.drawer.hidden, true);
    assert.equal(harness.controller.getDiagnostics().overlay.owners.length, 1);
    assert.equal(harness.drawerInstances[0].mounted, false);
    assert.equal(harness.drawerInstances[1].mounted, true);

    newAcquire.resolve({ success: true });
    await flush();
    assert.equal(newElements.drawer.hidden, false);
    newElements.close.click();
    await harness.controller.unmount();
});

test('EscapeDispatcher honors 10/20/30/40 priority, modal yielding, and focus restore', async t => {
    const harness = createHarness();
    t.after(() => harness.cleanup());
    harness.controller.mount();
    await flush();

    const dispatcher = harness.escapeInstances[0];
    const modal = harness.document.createElement('div');
    modal.id = 'globalSettingsModal';
    modal.className = 'modal';
    harness.document.body.append(modal);
    const higherModal = harness.document.createElement('div');
    higherModal.id = 'higherModal';
    higherModal.className = 'modal';
    harness.document.body.append(higherModal);

    const closeOrder = [];
    const activity = { account: true, notification: true };
    dispatcher.register({
        priority: 30,
        isActive: () => activity.account,
        close: () => {
            closeOrder.push('account');
            activity.account = false;
            return true;
        },
    });
    dispatcher.register({
        priority: 40,
        isActive: () => activity.notification,
        close: () => {
            closeOrder.push('notification');
            activity.notification = false;
            return true;
        },
    });
    const priorities = [...dispatcher.entries].map(entry => entry.priority).sort((a, b) => a - b);
    assert.deepEqual(priorities, [10, 20, 30, 40]);

    const elements = drawerElements(harness);
    elements.trigger.focus();
    elements.trigger.click();
    await flush();
    assert.equal(elements.drawer.hidden, false);

    let result = keydown(harness.document);
    assert.deepEqual(closeOrder, ['notification']);
    assert.equal(result.event.defaultPrevented, true);
    assert.equal(elements.drawer.hidden, false);

    result = keydown(harness.document);
    assert.deepEqual(closeOrder, ['notification', 'account']);
    assert.equal(result.event.defaultPrevented, true);
    assert.equal(elements.drawer.hidden, false);

    modal.classList.add('active');
    result = keydown(harness.document);
    assert.equal(servicesClosed(harness), 1);
    assert.equal(result.event.defaultPrevented, true);
    assert.equal(elements.drawer.hidden, false);
    modal.classList.remove('active');

    higherModal.classList.add('active');
    result = keydown(harness.document);
    assert.equal(result.dispatchResult, true);
    assert.equal(result.event.defaultPrevented, false);
    assert.equal(elements.drawer.hidden, false);
    higherModal.classList.remove('active');

    result = keydown(harness.document);
    assert.equal(result.event.defaultPrevented, true);
    assert.equal(elements.drawer.hidden, true);
    assert.equal(harness.document.activeElement, elements.trigger);
    await harness.controller.unmount();
});

function servicesClosed(harness) {
    return harness.services.closedModals || 0;
}
