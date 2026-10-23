'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../ProjectForgemodules/projectforge.js'), 'utf8');
function deferred() {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    return { promise, resolve };
}
function harness(api = {}) {
    const nodes = new Map();
    function element(id = '') {
        const classes = new Set();
        return {
            id, innerHTML: '', textContent: '', value: '', checked: false, hidden: false,
            disabled: false, dataset: {}, style: {}, attributes: {},
            classList: {
                contains: name => classes.has(name),
                toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
            },
            setAttribute(name, value) { this.attributes[name] = value; },
            before(node) { nodes.set(node.id, node); },
        };
    }
    const get = id => {
        if (!nodes.has(id)) nodes.set(id, element(id));
        return nodes.get(id);
    };
    const tabs = ['overview', 'timeline', 'files', 'report', 'history'].map(name => {
        const el = element(); el.dataset.tab = name; return el;
    });
    const document = {
        getElementById: get, createElement: () => element(),
        addEventListener() {},
        querySelectorAll: selector => selector === '.tab' ? tabs : [],
        body: element('body'),
    };
    const context = vm.createContext({
        window: { utilityAPI: api }, document,
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        setTimeout: () => 1, clearTimeout() {}, console,
    });
    vm.runInContext(source, context, { filename: 'projectforge.js' });
    const run = script => vm.runInContext(script, context);
    return { context, get, tabs, run, api };
}
function detail(id, name = '服务器计划') {
    return {
        project: { id, name, status: 'accepted', progress: { text: '1/1', total: 1, done: 1 },
            catalog: { remote: true, sourceId: 'server', localProjectId: 'p1',
                version: 2, observedAt: 1000, stale: true } },
        todos: [{ seq: 1, title: '<img src=x onerror=boom()>', note: '<script>boom()</script>',
            status: 'done', updated_by: 'Kerr', updated_at: '2026-10-21T00:00:00.000Z',
            truncated: ['note'] }],
        files: [], timeline: [], contributors: [],
    };
}
test('actual renderer requests unified list and omits remote delete controls', async () => {
    let options;
    const row = detail('remote:a').project;
    const h = harness({ projectForgeListProjects: async value => {
        options = value;
        return { success: true, data: { projects: [row], catalog: { phase: 'offline', cached: true } } };
    } });
    await h.run('loadProjects()');
    assert.equal(options.includeCatalog, true);
    assert.match(h.get('catalog-status').textContent, /缓存/);
    assert.match(h.get('project-list').innerHTML, /远端只读|离线缓存/);
    assert.match(h.get('project-list').innerHTML, /代码历史未同步/);
    assert.doesNotMatch(h.get('project-list').innerHTML, /project-delete-confirm/);
});
test('actual remote detail escapes text, displays truncation and hides code tabs', async () => {
    let nodeCalls = 0, historyCalls = 0;
    const h = harness({
        projectForgeGetProject: async id => ({ success: true, data: detail(id, '<svg onload=boom()>') }),
        projectForgeGetNode: async () => { nodeCalls++; },
        projectForgeSearchHistory: async () => { historyCalls++; },
    });
    await h.run("selectProject('remote:a')");
    assert.match(h.get('project-header').innerHTML, /&lt;svg/);
    assert.doesNotMatch(h.get('project-header').innerHTML, /<svg/);
    assert.match(h.get('pane-overview').innerHTML, /&lt;script&gt;/);
    assert.doesNotMatch(h.get('pane-overview').innerHTML, /<script>/);
    assert.match(h.get('pane-overview').innerHTML, /截断预览/);
    assert.ok(h.tabs.filter(t => t.dataset.tab !== 'overview').every(t => t.hidden));
    await h.run('openNode(1)');
    await h.run('runHistorySearch()');
    assert.equal(nodeCalls, 0); assert.equal(historyCalls, 0);
});
test('late detail cannot replace the newer selected remote project', async () => {
    const old = deferred();
    const h = harness({ projectForgeGetProject: id => id === 'remote:old' ? old.promise :
        Promise.resolve({ success: true, data: detail(id, 'new selection') }) });
    const pending = h.run("selectProject('remote:old')");
    await h.run("selectProject('remote:new')");
    old.resolve({ success: true, data: detail('remote:old', 'obsolete') });
    await pending;
    assert.equal(h.run('state.detail.project.id'), 'remote:new');
    assert.match(h.get('project-header').innerHTML, /new selection/);
    assert.doesNotMatch(h.get('project-header').innerHTML, /obsolete/);
});
test('closing node modal invalidates in-flight local node response', async () => {
    const pending = deferred();
    const h = harness({ projectForgeGetNode: () => pending.promise });
    h.run("state.currentId='p1'; state.detail={project:{id:'p1'}}");
    const opened = h.run('openNode(1)');
    h.run('closeNodeModal()');
    // Invalid detail would crash rendering if the stale response were consumed.
    pending.resolve({ success: true, data: {} });
    await opened;
    assert.equal(h.run('state.currentNode'), null);
    assert.equal(h.get('node-modal').hidden, true);
});
test('late list cannot restore rows removed by a newer authorization result', async () => {
    const old = deferred();
    let calls = 0;
    const h = harness({ projectForgeListProjects: () => ++calls === 1 ? old.promise :
        Promise.resolve({ success: true, data: {
            projects: [], catalog: { phase: 'error', cached: false },
        } }) });
    const pending = h.run('loadProjects()');
    await h.run('loadProjects()');
    old.resolve({ success: true, data: { projects: [detail('remote:old').project],
        catalog: { phase: 'online' } } });
    await pending;
    assert.equal(h.run('state.projects.length'), 0);
    assert.match(h.get('catalog-status').textContent, /缓存已清除/);
});
test('actual page loads CodeMirror simple-mode dependency before Rust mode', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '../ProjectForgemodules/projectforge.html'), 'utf8');
    const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map(m => m[1]);
    const core = '../node_modules/codemirror/lib/codemirror.js';
    const simple = '../node_modules/codemirror/addon/mode/simple.js';
    const rust = '../node_modules/codemirror/mode/rust/rust.js';
    assert.equal(scripts.filter(src => src === simple).length, 1);
    assert.ok(scripts.indexOf(core) >= 0 && scripts.indexOf(core) < scripts.indexOf(simple));
    assert.ok(scripts.indexOf(simple) < scripts.indexOf(rust));
});

function engineeringRendererDetail(id) {
    const result = detail(id);
    result.engineering = {
        version: 1, state: 'shared',
        report: { text: '<img src=x onerror=boom()>报告', by: 'Kerr', truncated: ['text'] },
        timeline: {
            total: 2, truncated: true,
            items: [{
                id: 7, kind: 'edit', reason: '<script>boom()</script>', maid: 'Kerr',
                created_at: '2026-10-22T02:00:00.000Z',
                node_count: 2, added: 2, removed: 1,
                files: ['src/a.js'], file_total: 2, files_truncated: true, truncated: [],
            }],
        },
        files: {
            total: 2, truncated: true,
            items: [{ file_path: 'src/a.js', edits: 1, added: 2, removed: 1, last_node: 9 }],
        },
    };
    return result;
}

test('engineering renderer exposes summaries without local history controls or raw HTML', async () => {
    let batchCalls = 0, nodeCalls = 0, historyCalls = 0;
    const h = harness({
        projectForgeGetProject: async id => ({ success: true, data: engineeringRendererDetail(id) }),
        projectForgeGetBatch: async () => { batchCalls++; return { success: true, data: { nodes: [] } }; },
        projectForgeGetNode: async () => { nodeCalls++; },
        projectForgeSearchHistory: async () => { historyCalls++; },
    });
    await h.run("selectProject('remote:a')");
    assert.deepEqual(h.tabs.filter(t => !t.hidden).map(t => t.dataset.tab),
        ['overview', 'timeline', 'files', 'report']);
    for (const name of ['timeline', 'files', 'report']) {
        h.run(`switchTab('${name}')`);
        assert.equal(h.tabs.find(t => t.dataset.tab === name).classList.contains('active'), true);
    }
    h.run("switchTab('history')");
    assert.equal(h.tabs.find(t => t.dataset.tab === 'history').classList.contains('active'), false);
    assert.equal(h.tabs.find(t => t.dataset.tab === 'report').classList.contains('active'), true);
    assert.match(h.get('pane-report').innerHTML, /&lt;img/);
    assert.doesNotMatch(h.get('pane-report').innerHTML, /<img/);
    assert.match(h.get('pane-report').innerHTML, /截断/);
    assert.match(h.get('project-header').innerHTML, /离线缓存/);
    assert.doesNotMatch(h.get('pane-report').innerHTML, /离线缓存/);
    assert.match(h.get('pane-timeline').innerHTML, /&lt;script&gt;/);
    assert.match(h.get('pane-timeline').innerHTML, /截断/);
    assert.match(h.get('pane-files').innerHTML, /src\/a\.js/);
    assert.match(h.get('pane-timeline').innerHTML, /class="tl-card"/);
    assert.match(h.get('pane-timeline').innerHTML, /class="tl-head"/);
    assert.match(h.get('pane-overview').innerHTML, /class="stat-grid"/);
    assert.doesNotMatch(h.get('pane-timeline').innerHTML, /data-batch=|data-node=/);
    assert.doesNotMatch(h.get('pane-files').innerHTML, /data-file=|data-node=|clickable/);
    await h.run('toggleBatch(null)');
    await h.run('openNode(7)');
    await h.run('runHistorySearch()');
    assert.equal(batchCalls, 0);
    assert.equal(nodeCalls, 0);
    assert.equal(historyCalls, 0);
});

test('engineering renderer distinguishes unshared, unavailable and shared empty data', async () => {
    let value = { version: 1, state: 'not-shared' };
    const h = harness({
        projectForgeGetProject: async id => ({
            success: true, data: { ...detail(id), engineering: value },
        }),
    });
    await h.run("selectProject('remote:a')");
    assert.match(h.get('pane-overview').innerHTML, /尚未共享/);
    assert.ok(h.tabs.filter(t => t.dataset.tab !== 'overview').every(t => t.hidden));
    value = { version: 1, state: 'unavailable', reason: 'endpoint-or-resource-unavailable' };
    await h.run("selectProject('remote:a')");
    assert.match(h.get('pane-overview').innerHTML, /不可用/);
    assert.doesNotMatch(h.get('pane-overview').innerHTML, /尚未提交验收报告/);
    value = {
        version: 1, state: 'shared', report: { text: null, by: null, truncated: [] },
        timeline: { items: [], total: 0, truncated: false },
        files: { items: [], total: 0, truncated: false },
    };
    await h.run("selectProject('remote:a')");
    assert.match(h.get('pane-report').innerHTML, /未提交/);
    assert.match(h.get('pane-timeline').innerHTML, /无施工/);
    assert.match(h.get('pane-files').innerHTML, /无变更文件/);
    value.report.text = '';
    await h.run("selectProject('remote:a')");
    assert.match(h.get('pane-report').innerHTML, /报告为空/);
});

function remoteCodeHarness() {
    let pending = null, request = null, localCalls = 0;
    const value = engineeringRendererDetail('remote:' + 'a'.repeat(64));
    Object.assign(value.project.catalog, { kind: 'source', digest: 'b'.repeat(64), stale: false });
    const result = {
        version: 1, state: 'shared',
        binding: { sourceId: 'server', localProjectId: 'p1', version: 2,
            digest: 'b'.repeat(64), node: 9 },
        file: { file_path: 'src/a.js', node: 9, batch: 7,
            before: { state: 'text', size: 3, text: 'old' },
            after: { state: 'text', size: 3, text: 'new' } },
    };
    const h = harness({
        projectForgeGetProject: async () => ({ success: true, data: value }),
        projectForgeGetRemoteCode: async (id, options) => {
            request = { id, options };
            return pending ? pending.promise : { success: true, data: result };
        },
        projectForgeGetNode: async () => { localCalls++; },
        projectForgeRevertFile: async () => { localCalls++; },
    });
    // Execute the actual MergeView constructor path, with only CodeMirror mocked.
    h.context.CodeMirror = { MergeView(_container, options) {
        h.context.mergeOptions = options;
        return { editor: () => ({}) };
    } };
    h.run("toast = message => { globalThis.lastToast = message; }");
    return { h, value, result, request: () => request, localCalls: () => localCalls,
        defer: () => { pending = deferred(); return pending; } };
}

test('remote file opens pinned readonly MergeView and cannot call local revert even directly', async () => {
    const f = remoteCodeHarness(), { h } = f;
    await h.run(`selectProject('${f.value.project.id}')`);
    assert.match(h.get('pane-files').innerHTML, /data-remote-code="9"/);
    await h.run('openRemoteCode(9)');
    assert.equal(f.request().options.version, 2);
    assert.equal(f.request().options.digest, 'b'.repeat(64));
    assert.equal(h.get('node-modal').hidden, false);
    assert.equal(h.context.mergeOptions.origLeft, 'old');
    assert.equal(h.context.mergeOptions.value, 'new');
    assert.equal(h.context.mergeOptions.readOnly, true);
    assert.equal(h.context.mergeOptions.revertButtons, false);
    assert.equal(h.get('revert-before-btn').disabled, true);
    assert.equal(h.get('revert-after-btn').disabled, true);
    assert.equal(h.get('revert-reason').disabled, true);
    assert.match(h.get('node-meta').textContent, /发布版本 2/);
    await h.run("revertCurrent('before')");
    await h.run('openNode(9)');
    assert.equal(f.localCalls(), 0);
});

test('remote non-text and not-shared states never masquerade as empty complete text', async () => {
    for (const state of ['binary', 'too-large', 'unsupported-encoding', 'not-shared']) {
        const f = remoteCodeHarness(), { h } = f;
        await h.run(`selectProject('${f.value.project.id}')`);
        if (state === 'not-shared') {
            f.result.state = state; delete f.result.file;
        } else Object.assign(f.result.file.after, { state, text: null });
        await h.run('openRemoteCode(9)');
        assert.equal(h.context.mergeOptions, undefined);
        if (state === 'not-shared') {
            assert.equal(h.get('node-modal').hidden, true);
            assert.match(h.context.lastToast, /未共享/);
        } else {
            assert.equal(h.get('diff-fallback').hidden, false);
            assert.match(h.get('diff-fallback').textContent, /无法生成完整文本差异/);
            assert.equal(h.get('diff-wrap-btn').disabled, true);
        }
    }
});

test('remote code late success cannot reopen modal after close, list refresh or selection change', async () => {
    for (const action of [
        'closeNodeModal()', '++listRequest',
        "state.currentId='another'; ++detailRequest",
    ]) {
        const f = remoteCodeHarness(), { h } = f;
        await h.run(`selectProject('${f.value.project.id}')`);
        const pending = f.defer();
        const read = h.run('openRemoteCode(9)');
        h.run(action);
        pending.resolve({ success: true, data: f.result });
        await read;
        assert.equal(h.get('node-modal').hidden, true);
        assert.equal(h.run('state.currentNode'), null);
        assert.equal(h.context.mergeOptions, undefined);
    }
});

test('renderer rejects mismatched publication and clears any partially prepared remote node', async () => {
    const f = remoteCodeHarness(), { h } = f;
    await h.run(`selectProject('${f.value.project.id}')`);
    f.result.binding.version = 1;
    await h.run('openRemoteCode(9)');
    assert.equal(h.get('node-modal').hidden, true);
    assert.equal(h.run('state.currentNode'), null);
    assert.match(h.context.lastToast, /INVALID_RESPONSE/);
    assert.equal(f.localCalls(), 0);
});