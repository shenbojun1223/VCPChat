const assert = require('node:assert/strict');
const test = require('node:test');

const { AICodeWorkerTabView } = require('../modules/AICodeWorkerTabView.js');

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

    toggle(name, force) {
        const shouldAdd = typeof force === 'boolean' ? force : !this.contains(name);
        if (shouldAdd) this.add(name);
        else this.remove(name);
        return shouldAdd;
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

    set innerHTML(value) {
        this._text = String(value ?? '');
        this.children.splice(0).forEach(child => { child.parentNode = null; });
    }

    get innerHTML() {
        return this.textContent;
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

    replaceChildren(...nodes) {
        this.children.splice(0).forEach(child => { child.parentNode = null; });
        this._text = null;
        this.append(...nodes);
    }

    removeChild(node) {
        const index = this.children.indexOf(node);
        if (index >= 0) {
            this.children.splice(index, 1);
            node.parentNode = null;
        }
        return node;
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
        for (const listener of [...(this.listeners.get(type) || [])]) listener(payload);
    }

    click() {
        this.dispatch('click');
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
        if (name === 'id') this.id = String(value);
    }

    getAttribute(name) {
        return this.attributes.has(name) ? this.attributes.get(name) : null;
    }

    querySelectorAll(selector) {
        const matches = [];
        const visit = node => {
            node.children.forEach(child => {
                if (child._matchesSelector(selector)) matches.push(child);
                visit(child);
            });
        };
        visit(this);
        return matches;
    }

    querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
    }

    _matchesSelector(selector) {
        if (selector.startsWith('.')) {
            return this.classList.contains(selector.slice(1));
        }
        if (selector.startsWith('#')) {
            return this.id === selector.slice(1);
        }
        return this.tagName.toLowerCase() === selector.toLowerCase();
    }
}

class FakeDocument {
    constructor() {
        this.body = new FakeElement(this, 'body');
    }

    createElement(tagName) {
        return new FakeElement(this, tagName);
    }
}

class FakeStore {
    constructor(jobs = []) {
        this.jobs = jobs;
        this.listeners = new Map();
        this.cancelled = [];
        this.queried = [];
    }

    getJobs() {
        return this.jobs.map(job => ({ ...job }));
    }

    getJob(jobId) {
        return this.jobs.find(j => j.jobId === jobId) || null;
    }

    cancelWorkerJob(jobId) {
        this.cancelled.push(jobId);
        return true;
    }

    fetchJobDetail(jobId, traceMode) {
        this.queried.push({ jobId, traceMode });
        return true;
    }

    addEventListener(type, listener) {
        const listeners = this.listeners.get(type) || new Set();
        listeners.add(listener);
        this.listeners.set(type, listeners);
    }

    removeEventListener(type, listener) {
        this.listeners.get(type)?.delete(listener);
    }

    emit(type) {
        for (const listener of [...(this.listeners.get(type) || [])]) listener({ type });
    }
}

test('AICodeWorkerTabView renders workbench layout, job cards and details', () => {
    const document = new FakeDocument();
    const container = document.createElement('div');
    const store = new FakeStore([
        {
            jobId: 'job_001',
            worker: 'codex',
            mode: 'write',
            state: 'running',
            pid: 1234,
            startedAt: 1700000000000,
            summary: 'Running analyze stage...',
        },
        {
            jobId: 'job_002',
            worker: 'codex',
            mode: 'patch',
            state: 'completed',
            pid: 5678,
            exitCode: 0,
            startedAt: 1699999000000,
            completedAt: 1699999050000,
            summary: 'Patch applied successfully',
        }
    ]);

    const view = new AICodeWorkerTabView({
        container,
        document,
        store,
        now: () => 1700000025000,
    });

    assert.equal(view.mount(), true);

    const cards = container.querySelectorAll('.aicw-tab-job-card');
    assert.equal(cards.length, 2);
    assert.equal(cards[0].classList.contains('active'), true);
    assert.equal(cards[0].dataset.jobid, 'job_001');

    const stageTitle = container.querySelector('.aicw-tab-stage-title');
    assert.match(stageTitle.textContent, /job_001/);

    const killBtn = container.querySelector('.aicw-tab-kill-btn');
    assert.notEqual(killBtn, null);
    killBtn.click();
    assert.deepEqual(store.cancelled, ['job_001']);

    cards[1].click();
    assert.equal(view.selectedJobId, 'job_002');
    assert.match(container.querySelector('.aicw-tab-stage-title').textContent, /job_002/);
    assert.equal(container.querySelector('.aicw-tab-kill-btn'), null);

    const filterBtns = container.querySelectorAll('.aicw-tab-filter-btn');
    assert.equal(filterBtns.length, 3);
    filterBtns[1].click();
    assert.equal(container.querySelectorAll('.aicw-tab-job-card').length, 1);

    view.dispose();
    assert.equal(container.children.length, 0);
    assert.equal(store.listeners.get('change')?.size || 0, 0);
});

test('AICodeWorkerTabView renders diff panel, validation chips and event timeline', () => {
    const document = new FakeDocument();
    const container = document.createElement('div');
    const store = new FakeStore([
        {
            jobId: 'job_write_001',
            worker: 'codex',
            mode: 'write',
            state: 'completed',
            startedAt: 1700000000000,
            completedAt: 1700000060000,
            candidateAvailable: true,
            resultCommit: 'a1b2c3d4e5f6',
            changedFiles: [
                { path: 'modules/Engine.js', status: 'M' },
                { path: 'styles/theme.css', status: 'A' }
            ],
            validation: {
                passed: true,
                steps: [
                    { name: 'syntaxCheck', status: 'passed', exitCode: 0 },
                    { name: 'unitTest', status: 'passed', exitCode: 0 }
                ]
            },
            executionTrace: [
                { kind: 'step', status: 'done', text: 'Baseline captured' },
                { kind: 'command', status: 'ok', command: 'node --test' }
            ]
        }
    ]);

    const view = new AICodeWorkerTabView({
        container,
        document,
        store,
        now: () => 1700000070000,
    });

    assert.equal(view.mount(), true);

    // 检查 Diff 面板与候选 Badge
    const diffPanel = container.querySelector('.aicw-tab-diff-panel');
    assert.notEqual(diffPanel, null);
    const badge = container.querySelector('.aicw-tab-candidate-badge');
    assert.match(badge.textContent, /a1b2c3d/);

    const fileItems = container.querySelectorAll('.aicw-tab-diff-file-item');
    assert.equal(fileItems.length, 2);
    assert.match(fileItems[0].textContent, /modules\/Engine\.js/);

    const chips = container.querySelectorAll('.aicw-tab-validation-chip');
    assert.equal(chips.length, 2);
    assert.match(chips[0].textContent, /syntaxCheck/);

    // 切换到 Events Tab，验证时间线生成并触发 fetchJobDetail
    const traceTabs = container.querySelectorAll('.aicw-tab-trace-tab-btn');
    traceTabs[1].click(); // 'events'
    assert.equal(view.traceTab, 'events');
    const eventItems = container.querySelectorAll('.aicw-tab-event-item');
    assert.equal(eventItems.length, 2);
    assert.match(eventItems[0].textContent, /Baseline captured/);
    assert.ok(store.queried.some(q => q.jobId === 'job_write_001' && q.traceMode === 'events'));

    view.dispose();
});test('AICodeWorkerTabView preserves stage DOM nodes and scroll position on in-place updates', () => {
    const document = new FakeDocument();
    const container = document.createElement('div');
    const store = new FakeStore([
        {
            jobId: 'job_scroll_001',
            worker: 'codex',
            mode: 'write',
            state: 'running',
            startedAt: 1700000000000,
            summary: 'Initial line',
        }
    ]);

    const view = new AICodeWorkerTabView({
        container,
        document,
        store,
        now: () => 1700000010000,
    });

    assert.equal(view.mount(), true);

    const initialContent = container.querySelector('.aicw-tab-stage-content');
    const initialViewport = container.querySelector('.aicw-tab-console-viewport');
    assert.notEqual(initialContent, null);
    assert.notEqual(initialViewport, null);

    // 模拟用户向下滚动控制台
    initialViewport.scrollTop = 250;

    // 模拟任务状态更新（例如心跳/耗时推进/Summary更新）
    store.jobs[0].summary = 'Second line of diagnosis';
    store.emit('change');

    // 验证：更新后舞台与视窗 DOM 节点保持同一引用，未被全量销毁重建
    const updatedContent = container.querySelector('.aicw-tab-stage-content');
    const updatedViewport = container.querySelector('.aicw-tab-console-viewport');
    assert.equal(updatedContent, initialContent);
    assert.equal(updatedViewport, initialViewport);

    // 验证：滚动条位置保留，没有被重置为 0
    assert.equal(updatedViewport.scrollTop, 250);

    view.dispose();
});