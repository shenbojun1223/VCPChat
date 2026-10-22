const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '../..');

function fixture(t) {
    const ids = ['project-header', 'pane-overview', 'pane-timeline', 'pane-files', 'pane-report', 'history-results'];
    const dom = new JSDOM(ids.map(id => `<div id="${id}"></div>`).join(''), {
        url: 'https://fixture.invalid/', runScripts: 'outside-only',
    });
    t.after(() => dom.window.close());
    const w = dom.window;
    w.utilityAPI = {};
    w.eval(fs.readFileSync(path.join(root, 'vendor/marked.min.js'), 'utf8'));
    // Render explicitly: do not run the application's IPC/bootstrap lifecycle.
    const listen = w.document.addEventListener;
    w.document.addEventListener = () => {};
    try {
        w.eval(fs.readFileSync(path.join(root, 'ProjectForgemodules/projectforge.js'), 'utf8') +
            '\nwindow.testRender = value => { state.detail = value; renderRemotePlan(); };');
    } finally {
        w.document.addEventListener = listen;
    }
    return w;
}

function detail() {
    return {
        project: {
            name: '远端工程', status: 'review',
            progress: { text: '1/2', done: 1, total: 2 },
            catalog: { remote: true, sourceId: 'server', localProjectId: 'p1', version: 2, observedAt: 1000, stale: true },
        },
        todos: [{ seq: 1, title: '施工', status: 'done', note: '<script>bad()</script>', truncated: [] }],
        contributors: [], timeline: [], files: [],
        engineering: {
            state: 'shared',
            report: { text: '# 验收\n\n| 项目 | 结果 |\n| --- | --- |\n| 测试 | 通过 |\n\n- 列表\n\n```js\nconst answer = 42;\n```', by: 'Kerr', truncated: [] },
            timeline: { total: 8, truncated: true, items: [{
                id: 7, kind: 'edit', maid: 'Kerr', created_at: '2026-10-22',
                reason: '说明 <img src=x>', node_count: 3, added: 5, removed: 2,
                files: ['src/a.js'], file_total: 2, files_truncated: true, truncated: [],
            }] },
            files: { total: 4, truncated: true, items: [
                { file_path: 'src/a.js', edits: 2, added: 5, removed: 2, last_node: 9 },
            ] },
        },
    };
}

test('remote details share local visual components without local action hooks or invented totals', t => {
    const w = fixture(t), d = w.document;
    w.testRender(detail());
    assert.ok(d.querySelector('#pane-overview .stat-grid'));
    assert.match(d.querySelector('#pane-overview').textContent, /未提供/);
    assert.ok(d.querySelector('#pane-timeline .timeline .tl-card'));
    assert.ok(d.querySelector('#pane-timeline .plus'));
    assert.ok(d.querySelector('#pane-files table.grid .minus'));
    assert.ok(d.querySelector('#pane-report .markdown h1'));
    assert.ok(d.querySelector('#pane-report .markdown table'));
    assert.ok(d.querySelector('#pane-report .markdown ul'));
    assert.ok(d.querySelector('#pane-report .markdown pre code'));
    assert.match(d.querySelector('#pane-timeline').textContent, /截断/);
    assert.match(d.querySelector('#project-header').textContent, /离线缓存/);
    assert.equal(d.querySelectorAll('[data-batch],[data-node],[data-file],[data-history-maid],.clickable').length, 0);
    assert.equal(d.querySelectorAll('script,img').length, 0);
});

test('remote Markdown displays raw HTML as text and never emits resource or navigation elements', t => {
    const w = fixture(t), value = detail();
    value.engineering.report.text = [
        '# 标题',
        '<img src="https://example.invalid/pixel" onerror="bad()">',
        '<svg onload="bad()"><a href="javascript:bad()">危险</a></svg>',
        '<iframe src="https://example.invalid/frame"></iframe>',
        '![远程图片](https://example.invalid/image.png)',
        '[危险链接](javascript:bad())',
        '[本地文件](file:///C:/private.txt)',
        '[普通链接](https://example.invalid/)',
        '<form><input autofocus onfocus="bad()"></form>',
    ].join('\n\n');
    w.testRender(value);
    const report = w.document.querySelector('#pane-report');
    assert.ok(report.querySelector('.markdown h1'));
    assert.equal(report.querySelectorAll('img,svg,iframe,script,style,form,input,a,video,audio,object,embed').length, 0);
    assert.match(report.textContent, /<img/);
    assert.match(report.textContent, /远程图片/);
    for (const el of report.querySelectorAll('*')) {
        for (const attr of el.attributes) assert.doesNotMatch(attr.name, /^(on|src|href)/i);
    }
});

test('unshared, empty and truncated reports retain their distinct meaning', t => {
    const w = fixture(t), value = detail();
    value.engineering.report.text = null;
    w.testRender(value);
    assert.match(w.document.querySelector('#pane-report').textContent, /未提交/);
    value.engineering.report.text = '';
    w.testRender(value);
    assert.match(w.document.querySelector('#pane-report').textContent, /报告为空/);
    value.engineering.report.text = '# 部分报告';
    value.engineering.report.truncated = ['text'];
    w.testRender(value);
    assert.match(w.document.querySelector('#pane-report').textContent, /截断/);
    value.engineering = { state: 'not-shared' };
    w.testRender(value);
    assert.match(w.document.querySelector('#pane-overview').textContent, /尚未共享/);
    assert.equal(w.document.querySelector('#pane-report .markdown'), null);
});