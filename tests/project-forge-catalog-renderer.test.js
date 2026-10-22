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