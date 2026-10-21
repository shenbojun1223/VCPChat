'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const ui = require('../projectforge-catalog-ui.js');
const remote = (sourceId, extra = {}) => ({
    id: 'remote:' + sourceId, name: '计划', status: 'accepted',
    updated_at: '2026-10-15T00:00:00Z',
    progress: { total: 2, done: 1 },
    catalog: { remote: true, kind: 'source', sourceId, localProjectId: 'p1',
        observedAt: Date.parse('2026-10-21T00:00:00Z'), ...extra },
});
test('source aliases do not infer local device or global lease holder', () => {
    assert.equal(ui.origin(remote('home-forge-plans')).label, '家中');
    assert.equal(ui.origin(remote('company-forge-plans')).label, '公司');
    assert.equal(ui.origin(remote('server-forge-plans')).label, '服务器');
    assert.equal(ui.origin(remote('custom-origin')).label, 'custom-origin');
    assert.equal(ui.origin({ id: 'p1', workspace_alias: 'home-forge-plans' }).label, '本机');
    assert.equal(ui.origin(remote('home-forge-plans', { kind: 'global' })).label, '接续工程');
});
test('search includes Chinese origin, raw identity, project ID and author', () => {
    const p = remote('company-forge-plans');
    assert.ok(ui.matches(p, '公司'));
    assert.ok(ui.matches(p, 'company-forge-plans'));
    assert.ok(ui.matches(p, 'p1'));
    assert.ok(ui.matches({ ...p, maids: ['Kerr'] }, 'kerr'));
    assert.equal(ui.matches(p, '服务器'), false);
});
test('unknown progress is not fabricated as zero completed todos', () => {
    assert.equal(ui.progress({ ...remote('x'), progress: null }).known, false);
    assert.equal(ui.progress({ ...remote('x'), progress: { total: 2, done: 5 } }).known, false);
    assert.equal(ui.progress({ progress: { total: 0, done: 0 } }).percent, 0);
    assert.equal(ui.progress(remote('x')).percent, 50);
});
test('card escapes untrusted text and distinguishes cache acquisition from business update', () => {
    const p = remote('<img src=x onerror=boom()>', { stale: true });
    p.name = '<svg onload=boom()>';
    const dom = new JSDOM('<ul><li>' + ui.card(p, {
        deleteHtml: '<button class="project-delete-confirm">delete</button>',
    }) + '</li></ul>');
    try {
        const d = dom.window.document;
        assert.equal(d.querySelectorAll('svg,img,script,.project-delete-confirm').length, 0);
        assert.match(d.querySelector('.name').textContent, /<svg/);
        assert.match(d.querySelector('.pf-catalog-access').textContent, /只读 · 离线缓存/);
        assert.match(d.querySelector('.pf-catalog-tip').textContent, /代码历史未同步/);
        assert.match(d.querySelector('.pf-catalog-tip').textContent, /获取时间：2026-10-21/);
        assert.match(d.querySelector('.pf-catalog-time').getAttribute('aria-label'), /2026-10-15/);
        assert.doesNotMatch(d.querySelector('.pf-catalog-time').textContent, /10-21/);
        assert.equal(d.querySelector('.pf-catalog-access').tabIndex, 0);
    } finally { dom.window.close(); }
});
test('optional adapter filters sources and retains only existing local action controls', () => {
    const dom = new JSDOM('<section id="side-page-projects"><div class="sidebar-head"></div></section><ul id="project-list"></ul>');
    try {
        const d = dom.window.document;
        let changes = 0;
        ui.mount({ document: d, onChange: () => changes++ });
        const local = { id: 'p1', name: '本地', status: 'accepted', updated_at: null };
        const p = remote('company-forge-plans');
        const rows = [local, p];
        assert.equal(ui.filterProjects(rows, '').length, 2);
        const select = d.getElementById('pf-catalog-source-filter');
        select.value = 'source:company-forge-plans';
        select.dispatchEvent(new dom.window.Event('change'));
        assert.equal(changes, 1);
        assert.deepEqual(ui.filterProjects(rows, '').map(r => r.id), [p.id]);
        // Losing a source after permission revocation resets the filter.
        assert.deepEqual(ui.filterProjects([local], '').map(r => r.id), ['p1']);
        assert.equal(select.value, 'all');
        const ul = d.getElementById('project-list');
        ul.innerHTML = rows.map(r => `<li class="project-item" data-id="${r.id}"><div class="project-delete-wrap"><button class="project-delete-confirm" data-id="${r.id}">delete</button></div></li>`).join('');
        ui.enhanceList(ul, rows, () => '<span class="badge">已验收</span>');
        assert.equal(ul.querySelector('[data-id="p1"] .project-delete-confirm').dataset.id, 'p1');
        assert.equal(ul.querySelector('[data-id^="remote:"] .project-delete-confirm'), null);
        assert.equal(ul.querySelectorAll('.pf-catalog-card').length, 2);
    } finally { dom.window.close(); }
});
test('extension resources load before host; upstream rendering remains fallback', () => {
    const dir = path.resolve(__dirname, '..');
    const html = fs.readFileSync(path.join(dir, 'projectforge.html'), 'utf8');
    assert.ok(html.indexOf('src="projectforge-catalog-ui.js"') < html.indexOf('src="projectforge.js"'));
    assert.match(html, /href="projectforge-catalog-ui.css"/);
    const host = fs.readFileSync(path.join(dir, 'projectforge.js'), 'utf8');
    assert.match(host, /ProjectForgeCatalogUI\?\.enhanceList/);
    assert.match(host, /: state\.projects\.filter/);
});