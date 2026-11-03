'use strict';
// electron .../delegation-review-window.cjs <new evidence directory>
// Hidden actual page + synthetic IPC. No production DB, model requests or OS clipboard.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..'), evidence = process.argv[2];
if (!evidence || !path.isAbsolute(evidence) || fs.existsSync(evidence)) throw Error('New absolute evidence directory required');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(evidence, 'profile'));
app.setPath('sessionData', path.join(evidence, 'session'));
app.disableHardwareAcceleration();
const C = require('../../VCPDistributedServer/Plugin/ProjectForge/delegationReviewRecord');
const host = { version: 1, projectId: 'ptest', todoId: 7, todoSeq: 1,
    delegationId: 'aa-delegation-1793459141509-557448cf', role: 'Worker#fixture',
    assignedBy: 'Kerr', sessionId: 'review-page-only', runtimeStatus: 'completed',
    stage: 'review', sequence: 4, updatedAt: '2026-11-01T11:53:05.614Z' };
function hostNote(d) { return '[[ForgeDelegation::v1]]\n' + JSON.stringify(d) + '\n[[/ForgeDelegation]]\n'; }
function record(d, verdict) {
    return { version: 1, projectId: d.projectId, todoId: d.todoId, todoSeq: d.todoSeq,
        delegationId: d.delegationId, runtimeSequence: d.sequence, runtimeUpdatedAt: d.updatedAt,
        revision: 1, requestId: 'page-' + d.todoSeq, verdict, reviewedBy: 'Kerr',
        reviewedAt: '2026-11-03T06:35:50.000Z', scope: '仅后端场景 <img src=x>',
        reason: verdict === 'passed' ? '限定结果已独立核对，不代表动态页面通过' : '计划两轮仅一轮',
        evidence: { ref: 'evidence/<script>.json', sha256: 'a'.repeat(64) } };
}
const todos = [1, 2, 3, 4].map((seq, index) => {
    const d = { ...host, todoId: 6 + seq, todoSeq: seq,
        delegationId: 'aa-delegation-1793459141509-' + String(seq).repeat(8) };
    const raw = hostNote(d), r = record(d, seq === 2 ? 'rejected' : 'passed');
    let note = seq < 3 ? C.compose(raw, r) : raw;
    if (seq === 4) note = raw + C.START + JSON.stringify({ ...r, runtimeSequence: 3 }) + C.END;
    return { id: d.todoId, seq, title: ['Accepted', 'Rejected', 'Not reviewed', 'Stale review'][index],
        status: 'pending', note, updated_by: 'AgentAssistant', updated_at: d.updatedAt };
});
const firstRuntime = C.readRuntime(todos[0].note).data;
const replacement = { ...record(firstRuntime, 'rejected'), revision: 2, requestId: 'page-correction' };
const payload = { todos, corrected: C.compose(hostNote(firstRuntime), replacement) };
function fixturePreload(data) {
    const { contextBridge } = require('electron');
    let version = 1, details = 0, lists = 0, forbidden = 0;
    const project = () => ({
        id: 'remote:review', name: 'Independent review fixture', status: 'review',
        rootInfo: { writable: false }, workspace_alias: 'fixture', stats: {}, maids: [],
        progress: { total: 4, done: 0, text: '0/4' },
        catalog: { remote: true, sourceId: 'review-source', localProjectId: 'ptest',
            version, digest: String(version).repeat(64), observedAt: Date.now(), stale: false },
    });
    const deny = async () => { forbidden++; throw Error('FORBIDDEN'); };
    contextBridge.exposeInMainWorld('utilityAPI', {
        loadSettings: async () => ({ currentThemeMode: 'dark' }),
        loadForumConfig: async () => ({ replyUsername: 'Kerr' }),
        projectForgeListProjects: async () => { lists++; return { success: true,
            data: { projects: [project()], catalog: { phase: 'online' } } }; },
        projectForgeGetProject: async () => { details++; return { success: true,
            data: { project: project(), todos: data.todos, contributors: [], timeline: [], files: [] } }; },
        projectForgeDeleteProject: deny, projectForgeRevertFile: deny,
        projectForgeAcceptProject: deny, windowReady() {},
    });
    contextBridge.exposeInMainWorld('reviewFixture', {
        counts: () => ({ version, details, lists, forbidden }),
        correct: () => { data.todos[0].note = data.corrected; version++; },
    });
}
const preload = path.join(evidence, 'preload.cjs');
fs.writeFileSync(preload, '(' + fixturePreload.toString() + ')(' + JSON.stringify(payload) + ');');
const checks = [], errors = [], network = [], layouts = [];
let win, finished = false;
const evaluate = s => win.webContents.executeJavaScript(s);
async function until(code, timeout = 8500) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
        if (await evaluate(code)) return;
        await new Promise(r => setTimeout(r, 40));
    }
    throw Error('Timeout: ' + code);
}
async function finish(error) {
    if (finished) return;
    finished = true; clearTimeout(watchdog);
    if (error && win && !win.isDestroyed()) try {
        fs.writeFileSync(path.join(evidence, 'failure.png'), (await win.webContents.capturePage()).toPNG());
    } catch {}
    const result = { ok: !error, scope: 'hidden actual page; synthetic IPC and catalog version; not live production acceptance',
        checks, layouts, errors, network, error: error ? String(error.stack || error) : null, electron: process.versions.electron };
    fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    win?.destroy(); app.exit(error ? 1 : 0);
}
const watchdog = setTimeout(() => { void finish(Error('Review page timeout')); }, 45000);
app.whenReady().then(async () => {
    const isolated = session.fromPartition('delegation-review-' + process.pid);
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    isolated.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
        (request, callback) => { network.push(request.url); callback({ cancel: true }); });
    win = new BrowserWindow({ width: 1280, height: 900, show: false, webPreferences: {
        preload, session: isolated, sandbox: true, contextIsolation: true,
        nodeIntegration: false, backgroundThrottling: false,
    } });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.on('preload-error', (_event, _file, e) => errors.push(String(e)));
    win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
    await win.loadFile(path.join(root, 'ProjectForgemodules/projectforge.html'));
    await until("document.querySelector('.project-item')");
    await evaluate(`Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
            writeText() { throw Error('OS_CLIPBOARD_FORBIDDEN'); }, readText() { throw Error('OS_CLIPBOARD_FORBIDDEN'); }
        } }); document.querySelector('.project-item').click();`);
    await until("document.querySelectorAll('.pf-delegation-card').length === 4");
    const labels = await evaluate(`Array.from(document.querySelectorAll('.pf-delegation-card')).map(c => ({
        execution: c.querySelector('.pf-delegation-phase').textContent,
        verdict: c.querySelector('.pf-review-badge')?.textContent || '',
        text: c.textContent, steps: c.querySelector('.pf-delegation-steps').className,
    }))`);
    assert.equal(labels[0].execution, '执行已结束'); assert.equal(labels[0].verdict, '限定核验通过');
    assert.match(labels[0].text, /不代表动态页面通过/);
    assert.equal(labels[1].execution, '执行已结束'); assert.equal(labels[1].verdict, '核验未通过');
    assert.doesNotMatch(labels[1].text, /限定核验通过/);
    assert.equal(labels[2].execution, '待核验'); assert.equal(labels[2].verdict, '');
    assert.equal(labels[3].execution, '待核验'); assert.equal(labels[3].verdict, '');
    assert.equal(await evaluate("document.querySelectorAll('#pane-overview img, #pane-overview script').length"), 0);
    assert.equal(await evaluate("Array.from(document.querySelectorAll('.todo-state')).every(e => e.textContent === '待办')"), true);
    checks.push('passed/rejected/missing/stale reviews remain distinct from completed execution and business pending; escaped evidence never creates elements');
    for (const light of [false, true]) for (const width of [1280, 760]) {
        win.setSize(width, 900);
        await evaluate(`document.body.classList.toggle('light-theme', ${light})`);
        await evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
        const geometry = await evaluate(`(() => {
            const pane = document.querySelector('.tab-body');
            const cards = [...document.querySelectorAll('.pf-delegation-card')];
            const rejected = cards[1];
            return { overflow: pane.scrollWidth - pane.clientWidth,
                cards: cards.map(c => ({ overflow: c.scrollWidth - c.clientWidth })),
                dangerMatches: getComputedStyle(rejected.querySelector('.pf-review-badge')).color
                    === getComputedStyle(rejected.querySelector('.pf-delegation-steps .rejected')).color,
                greenMatches: getComputedStyle(cards[0].querySelector('.pf-review-badge')).color
                    === getComputedStyle(cards[0].querySelector('.pf-delegation-steps .current')).color };
        })()`);
        assert.ok(geometry.overflow <= 1 && geometry.cards.every(c => c.overflow <= 1));
        assert.equal(geometry.dangerMatches, true); assert.equal(geometry.greenMatches, true);
        layouts.push({ light, width, ...geometry });
        fs.writeFileSync(path.join(evidence, `${light ? 'light' : 'dark'}-${width}.png`),
            (await win.webContents.capturePage()).toPNG());
    }
    checks.push('dark/light narrow/wide actual Chromium layouts have no card or pane overflow; verdict and step colors agree');
    await evaluate(`document.querySelector('[data-pf-role="Worker#fixture"]').click();
        document.querySelector('details').open = true; document.querySelector('summary').focus();
        document.querySelector('.tab-body').scrollTop = 120; window.manualRefreshes = 0;
        document.getElementById('refresh-btn').addEventListener('click', () => window.manualRefreshes++);`);
    const top = await evaluate("document.querySelector('.tab-body').scrollTop");
    await evaluate('reviewFixture.correct()');
    await until(`document.querySelector('.pf-delegation-card .pf-review-badge')?.textContent === '核验未通过'`);
    assert.equal(await evaluate('window.manualRefreshes'), 0);
    assert.equal(await evaluate("document.querySelector('[data-pf-role][aria-pressed=\"true\"]').dataset.pfRole"), 'Worker#fixture');
    assert.equal(await evaluate("document.querySelector('details').open"), true);
    assert.equal(await evaluate('document.activeElement.tagName'), 'SUMMARY');
    assert.ok(Math.abs(await evaluate("document.querySelector('.tab-body').scrollTop") - top) < 2);
    assert.equal(await evaluate('reviewFixture.counts().forbidden'), 0);
    assert.equal(win.isVisible(), false);
    assert.deepEqual(errors, []); assert.deepEqual(network, []);
    checks.push('automatic catalog revision changes only independent verdict; filter/note/focus/scroll preserved; no manual refresh or forbidden writes, network, clipboard');
    await finish();
}).catch(finish);