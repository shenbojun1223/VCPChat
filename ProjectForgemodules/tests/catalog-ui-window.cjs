'use strict';
// Run from repository root:
// electron ProjectForgemodules/tests/catalog-ui-window.cjs <new evidence directory>
// Reuse the existing isolated fixture and cleanup. Pinned anchors fail closed
// if upstream changes; no on-disk rewrite of the original runner.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const runner = path.resolve(__dirname, '../../scripts/test-forge-catalog-window.cjs');
let source = fs.readFileSync(runner, 'utf8');
function replaceOnce(target, replacement) {
    if (source.split(target).length !== 2) throw Error('Window runner anchor changed');
    source = source.replace(target, replacement);
}
async function presentationChecks(state, renderProjectList) {
    // Runs in the real renderer; API stays synthetic. No production state.
    const local = state.projects.find(p => !p.catalog?.remote);
    const example = state.projects.find(p => p.catalog?.remote);
    const clone = p => JSON.parse(JSON.stringify(p));
    const additions = ['home-forge-plans', 'company-forge-plans', 'server-forge-plans'].map((sourceId, i) => {
        const p = clone(example);
        p.id = 'remote:ui-' + i;
        p.name = ['家中绘图工具', '公司模型选择修复与超长标题布局回归验证', '服务器插件维护'][i];
        p.catalog.sourceId = sourceId;
        p.catalog.kind = 'source';
        p.catalog.stale = i === 2;
        p.updated_at = '2026-10-15T00:00:00Z';
        return p;
    });
    const global = clone(example);
    global.id = 'remote:ui-global';
    global.name = '跨端接续工程';
    global.catalog.kind = 'global';
    global.catalog.stale = false;
    global.progress = null;
    state.projects = [local, ...additions, global, example];
    state.currentId = null;
    renderProjectList();
    return state.projects.length;
}
replaceOnce('    await finish();', `
    win.show();
    win.focus();
    win.webContents.focus();
    await until("document.hasFocus()");
    // Await a new list request; its sequence invalidates any earlier focus refresh.
    await evaluate("loadProjects()");
    assert.equal(await evaluate(${JSON.stringify('(' + presentationChecks.toString() + ')(state, renderProjectList)')}), 6);
    const labels = await evaluate("[...document.querySelectorAll('.pf-catalog-origin')].map(e=>e.textContent)");
    assert.deepEqual(labels, ['本机', '家中', '公司', '服务器', '接续工程', 'server-fixture']);
    await evaluate("document.getElementById('pf-catalog-source-filter').value='source:company-forge-plans'; document.getElementById('pf-catalog-source-filter').dispatchEvent(new Event('change'))");
    assert.equal(await evaluate("document.querySelectorAll('.project-item').length"), 1);
    assert.equal(await evaluate("document.querySelector('.pf-catalog-origin').textContent"), '公司');
    assert.equal(await evaluate("document.querySelectorAll('.project-delete-confirm').length"), 0);
    await screenshot('company-filter');
    await evaluate("document.getElementById('pf-catalog-source-filter').value='all'; document.getElementById('pf-catalog-source-filter').dispatchEvent(new Event('change'))");
    assert.equal(await evaluate("document.querySelectorAll('.project-item').length"), 6);
    await evaluate("document.getElementById('project-search').value='服务器'; renderProjectList()");
    assert.equal(await evaluate("document.querySelectorAll('.project-item').length"), 2);
    await evaluate("document.getElementById('project-search').value=''; renderProjectList()");
    // Test default and narrower sidebar using real layout metrics.
    for (const width of [300, 260]) {
        await evaluate("document.querySelector('.layout').style.gridTemplateColumns='" + width + "px minmax(0, 1fr)'");
        const geometry = await evaluate(\`[...document.querySelectorAll('.pf-catalog-card')].map(card => {
            const bounds = card.getBoundingClientRect();
            const pieces = [...card.querySelectorAll('.pf-catalog-title, .pf-catalog-meta, .pf-catalog-footer, .pf-catalog-access')];
            return { origin: card.dataset.origin, height: bounds.height,
                rows: [...card.children].map(e => ({
                    className: e.className, height: e.getBoundingClientRect().height,
                    lineHeight: getComputedStyle(e).lineHeight
                })), overflow: pieces.some(e => {
                const r=e.getBoundingClientRect();
                return r.left < bounds.left || r.right > bounds.right + 1 ||
                    e.scrollWidth > e.clientWidth + 1;
            }) };
        })\`);
        assert.ok(geometry.every(g => !g.overflow), JSON.stringify({width,geometry}));
        assert.ok(Math.max(...geometry.map(g=>g.height))-Math.min(...geometry.map(g=>g.height)) < 2,
            JSON.stringify({width,geometry}));
    }
    checks.push('six source labels, Chinese search, source filter, readonly controls, 300/260px card bounds and equal heights');
    await screenshot('multi-source-dark');
    await evaluate("[...document.querySelectorAll('.pf-catalog-card')].find(e => e.dataset.origin === 'source:server-forge-plans').querySelector('.pf-catalog-access').focus()");
    await until("document.activeElement.matches('.pf-catalog-access:focus')");
    const tip = await evaluate(\`(() => {
        const el=document.activeElement;
        const t=el.querySelector('[role="tooltip"]');
        return { visible:getComputedStyle(t).display!=='none', text:t.textContent,
          described:el.getAttribute('aria-describedby')===t.id,
          activeClass:el.className, focusMatches:el.matches(':focus'),
          documentFocused:document.hasFocus(), display:getComputedStyle(t).display,
          describedBy:el.getAttribute('aria-describedby'), tooltipId:t.id };
    })()\`);
    assert.ok(tip.visible && tip.described, JSON.stringify(tip));
    assert.match(tip.text, /代码历史未同步/);
    assert.match(tip.text, /可能已过期/);
    await screenshot('keyboard-tooltip');
    await evaluate("document.activeElement.blur(); applyTheme('light')");
    await screenshot('multi-source-light');
    checks.push('keyboard-focus tooltip retains cache warning and history limitation; light theme rendered');
    assert.deepEqual(errors, []);
    assert.deepEqual(blockedNetwork, []);
    await finish();`);
const compiled = new Module(runner, module);
compiled.filename = runner;
compiled.paths = Module._nodeModulePaths(path.dirname(runner));
compiled._compile(source, runner);