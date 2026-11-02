'use strict';
// electron scripts/test-forge-subagents-window.cjs <new absolute evidence directory>
// Actual page, synthetic bridge only. No production IPC, credentials or database.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const evidence = process.argv[2], root = path.resolve(__dirname, '..');
if (!evidence || !path.isAbsolute(evidence) || fs.existsSync(evidence)) throw Error('Provide a new absolute evidence directory');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(evidence, 'profile'));
app.setPath('sessionData', path.join(evidence, 'session'));
app.disableHardwareAcceleration();
let win, finished = false;
const errors = [], network = [], checks = [];
function fixturePreload() {
    const { contextBridge } = require('electron');
    let roleGone = false, offline = false, nextHeld = '', release;
    const counts = { list: 0, detail: 0, forbidden: 0 };
    const at = '2026-10-31T04:00:00Z';
    const project = id => ({
        id, name: id === 'p1' ? '本地委托工程' : id === 'p2' ? '普通工程' : '远端委托工程',
        status: 'active', workspace_alias: 'synthetic', created_by: 'Kerr',
        created_at: at, updated_at: at, root: 'synthetic-only',
        rootInfo: { root: 'synthetic-only', writable: false },
        stats: { nodeCount: 0, fileCount: 0 }, progress: { total: 6, done: 1, text: '1/6' },
        maids: [],
        ...(id.startsWith('remote:') ? { catalog: {
            remote: true, sourceId: 'server-fixture', localProjectId: 'p1',
            version: 3, observedAt: 1793419200000, stale: offline,
        } } : {}),
    });
    const todos = () => [
        { seq: 1, status: 'done', title: '报告完成但待核验', note: '执行分身=Memo;派工方=Kerr;session_id=s1;delegationId=d1;阶段=已完成报告，待核验;约定产物=src/a.js' },
        { seq: 2, status: 'blocked', title: '施工中遇到阻塞', note: '执行分身=Memo;派工方=Kerr;session_id=s2;delegationId=d2;阶段=施工中' },
        { seq: 3, status: 'doing', title: '已核验产物', note: '执行分身=Nova;session_id=s3;阶段=核验通过' },
        { seq: 4, status: 'doing', title: '核验被退回', note: '执行分身=Lucy;session_id=s4;阶段=已核验但不通过' },
        { seq: 5, status: 'pending', title: '备注被截断', note: '执行分身=折枝;session_id=s5;阶段=核验通', truncated: ['note'] },
        { seq: 6, status: 'pending', title: '普通任务', note: '<img src=x onerror=bad()><script>window.injected=true</script>' },
    ].filter(t => !roleGone || t.seq > 2).map(t => ({ ...t, updated_by: 'Kerr', updated_at: at }));
    const forbidden = async () => { counts.forbidden++; throw Error('TEST_FORBIDDEN_OPERATION'); };
    contextBridge.exposeInMainWorld('utilityAPI', {
        loadSettings: async () => ({ currentThemeMode: 'dark' }),
        loadForumConfig: async () => ({ replyUsername: 'Kerr' }),
        projectForgeListProjects: async () => {
            counts.list++;
            return { success: true, data: { projects: ['p1', 'p2', 'remote:fixture'].map(project),
                catalog: { phase: offline ? 'offline' : 'online', cached: offline } } };
        },
        projectForgeGetProject: async id => {
            counts.detail++;
            if (nextHeld === id) {
                nextHeld = '';
                await new Promise(resolve => { release = resolve; });
            }
            return { success: true, data: {
                project: project(id),
                todos: id === 'p2' ? [{ seq: 1, status: 'pending', title: '普通待办', note: '不声明执行人', updated_by: 'Kerr', updated_at: at }] : todos(),
                contributors: id.startsWith('remote:') ? [] : [{ maid: 'Kerr', batches: 1, added: 2, removed: 0, last_at: at }],
                files: [], timeline: [],
            } };
        },
        projectForgeSearchHistory: async () => { counts.history = (counts.history || 0) + 1; return { success: true, data: [] }; },
        projectForgeDeleteProject: forbidden, projectForgeRevertFile: forbidden,
        projectForgeGetNode: forbidden,
        windowReady() {},
    });
    contextBridge.exposeInMainWorld('subagentFixture', {
        counts: () => ({ ...counts }), removeMemo: () => { roleGone = true; },
        offline: () => { offline = true; },
        hold: id => { nextHeld = id; }, release: () => { if (release) { release(); release = null; } },
        pending: () => Boolean(release),
    });
}
const preload = path.join(evidence, 'fixture-preload.cjs');
fs.writeFileSync(preload, '(' + fixturePreload.toString() + ')();');
const evaluate = code => win.webContents.executeJavaScript(code);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(code) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
        if (await evaluate(code)) return;
        await sleep(30);
    }
    throw Error('Timed out: ' + code);
}
async function shot(name) {
    await evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
    await sleep(80);
    const image = await win.webContents.capturePage();
    assert.equal(image.isEmpty(), false);
    fs.writeFileSync(path.join(evidence, name + '.png'), image.toPNG());
}
async function finish(error) {
    if (finished) return;
    finished = true;
    clearTimeout(watchdog);
    if (error && win && !win.isDestroyed()) try { await shot('failure'); } catch {}
    let diagnostic = null;
    if (error && win && !win.isDestroyed()) try {
        diagnostic = await evaluate(`({
            focused: document.hasFocus(), activeTag: document.activeElement?.tagName,
            activeRole: document.activeElement?.dataset.pfRole,
            pressed: [...document.querySelectorAll('[data-pf-role][aria-pressed="true"]')].map(e => e.dataset.pfRole),
            visibleTodos: document.querySelectorAll('.pf-todo-list > li').length,
            scrollTop: document.querySelector('.tab-body')?.scrollTop,
            counts: subagentFixture.counts(), inputEvents: window.fixtureInputEvents || []
        })`);
    } catch {}
    let interaction = null;
    if (win && !win.isDestroyed()) try {
        interaction = await evaluate(`({
            counts: subagentFixture.counts(),
            nativeMemoClick: (window.fixtureInputEvents || []).some(e => e.type === 'click' && e.trusted && e.role === 'Memo'),
            nativeEnter: (window.fixtureInputEvents || []).some(e => e.type === 'keypress' && e.trusted && e.key === 'Enter')
        })`);
    } catch {}
    const result = { ok: !error, diagnostic, interaction, scope: 'actual Electron page with synthetic API; not production integration',
        checks, errors, network, error: error ? String(error.stack || error) : null,
        electron: process.versions.electron, completedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    if (win && !win.isDestroyed()) win.destroy();
    app.exit(error ? 1 : 0);
}
const watchdog = setTimeout(() => { void finish(Error('Window test timed out')); }, 60000);
app.whenReady().then(async () => {
    const isolated = session.fromPartition('forge-subagents-' + process.pid);
    isolated.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
        (details, callback) => { network.push(details.url); callback({ cancel: true }); });
    win = new BrowserWindow({ width: 1280, height: 900, show: false,
        webPreferences: { preload, contextIsolation: true, nodeIntegration: false,
            sandbox: true, session: isolated, backgroundThrottling: false } });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.on('preload-error', (_e, _p, error) => errors.push(String(error)));
    win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
    await win.loadFile(path.join(root, 'ProjectForgemodules/projectforge.html'));
    await until("document.querySelectorAll('.project-item').length === 3");
    win.show();
    win.focus();
    win.webContents.focus();
    await until('document.hasFocus()');
    await evaluate("document.querySelector('[data-id=\"p1\"]').click()");
    await until("document.querySelectorAll('.pf-delegation-card').length === 5");
    assert.equal(await evaluate("document.querySelectorAll('[data-pf-role=\"Memo\"]').length"), 1);
    assert.equal(await evaluate("document.querySelectorAll('.pf-todo-list > li').length"), 6);
    assert.equal(await evaluate("document.querySelector('.pf-todo-list > li .todo-state').textContent"), '完成');
    assert.equal(await evaluate("document.querySelector('.pf-todo-list > li .pf-delegation-phase').textContent"), '待核验');
    assert.equal(await evaluate("document.querySelectorAll('.pf-todo-list .pf-delegation-phase.rejected').length"), 1);
    assert.equal(await evaluate("document.querySelectorAll('#pane-overview img,#pane-overview script,#pane-overview a').length"), 0);
    assert.equal(await evaluate('Boolean(window.injected)'), false);
    checks.push('local actual page: separate delegation identity, honest status/verification, escaped content');
    await shot('local-dark');
    await evaluate(`window.fixtureInputEvents = [];
        for (const type of ['keydown', 'keypress', 'keyup', 'click']) document.addEventListener(type, e => {
            window.fixtureInputEvents.push({ type, key: e.key, code: e.code, trusted: e.isTrusted,
                role: e.target.dataset.pfRole, prevented: e.defaultPrevented });
        });
        document.querySelector('[data-pf-role="Memo"]').focus();`);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    await until("document.querySelectorAll('.pf-todo-list > li').length === 2");
    assert.equal(await evaluate("document.activeElement.dataset.pfRole"), 'Memo');
    assert.equal(await evaluate("document.activeElement.getAttribute('aria-pressed')"), 'true');
    assert.equal(await evaluate("window.fixtureInputEvents.some(e => e.type === 'click' && e.trusted && e.role === 'Memo')"), true);
    await evaluate("document.querySelector('.pf-todo-note summary').focus()");
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    await until("document.querySelector('.pf-todo-note').open");
    const beforeRefresh = await evaluate(`(() => {
        document.querySelector('.tab-body').scrollTop = 230;
        document.getElementById('refresh-btn').click();
        return true;
    })()`);
    assert.equal(beforeRefresh, true);
    await until("!document.getElementById('project-view').hidden && document.querySelectorAll('.pf-todo-list > li').length === 2");
    assert.equal(await evaluate("document.querySelector('.pf-todo-note').open"), true);
    assert.equal(await evaluate("document.activeElement.tagName"), 'SUMMARY');
    assert.equal(await evaluate("Math.abs(document.querySelector('.tab-body').scrollTop - 230) < 3"), true);
    checks.push('native Enter activates filters and notes; same-project refresh keeps selection, expansion, focus and real scroll');
    await evaluate("document.querySelector('[data-pf-role=\"\"]').click(); document.querySelector('.tab-body').scrollTop=0; document.body.classList.add('light-theme')");
    await shot('local-light');
    win.setSize(760, 850);
    await evaluate("document.body.classList.remove('light-theme')");
    await sleep(80);
    const layout = await evaluate(`({
        rootOverflow: document.documentElement.scrollWidth > innerWidth + 1,
        bodyOverflow: document.querySelector('.tab-body').scrollWidth > document.querySelector('.tab-body').clientWidth + 1,
        token: getComputedStyle(document.body).getPropertyValue('--pf-delegate').trim(),
        buttons: [...document.querySelectorAll('[data-pf-role]')].every(b => b.tagName === 'BUTTON' && b.type === 'button')
    })`);
    assert.equal(layout.rootOverflow, false);
    assert.equal(layout.bodyOverflow, false);
    assert.equal(layout.buttons, true);
    assert.ok(layout.token);
    await shot('local-narrow-dark');
    win.webContents.setBackgroundThrottling(false);
    await evaluate("document.body.classList.add('light-theme')");
    await shot('local-narrow-light');
    checks.push('dark/light and narrow 760px layout: themed controls, no overview horizontal overflow');
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    assert.equal(await evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches"), true);
    assert.equal(await evaluate(`[
        ...document.querySelectorAll('.pf-delegation-monitor *, .pf-todo-list *')
    ].every(el => {
        const style = getComputedStyle(el);
        return style.animationName === 'none' && style.transitionDuration.split(',').every(v => parseFloat(v) === 0);
    })`), true);
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
    win.webContents.debugger.detach();
    checks.push('actual reduced-motion media emulation disables animation and transitions on new components');
    win.setSize(1280, 900);
    await evaluate("document.querySelector('[data-id=\"remote:fixture\"]').click()");
    await until("document.getElementById('project-header').textContent.includes('远端委托工程')");
    assert.equal(await evaluate("document.querySelectorAll('.pf-delegation-card').length"), 5);
    assert.equal(await evaluate("document.querySelectorAll('#pane-overview [data-history-maid],#pane-overview [data-file],#pane-overview [data-node]').length"), 0);
    assert.equal(await evaluate("document.querySelector('[data-pf-role=\"\"]').getAttribute('aria-pressed')"), 'true');
    assert.equal(await evaluate("document.querySelector('.pf-todo-note').open"), false);
    await evaluate("subagentFixture.offline(); document.getElementById('refresh-btn').click()");
    await until("document.getElementById('project-header').textContent.includes('离线缓存')");
    assert.match(await evaluate("document.getElementById('project-header').textContent"), /版本 3/);
    await shot('remote-cached');
    checks.push('remote uses shared component; source/version/cache retained; source switch resets view; no local path hooks');
    await evaluate("subagentFixture.hold('p1'); document.querySelector('[data-id=\"p1\"]').click()");
    await until('subagentFixture.pending()');
    await evaluate("document.querySelector('[data-id=\"remote:fixture\"]').click()");
    await until("!document.getElementById('project-view').hidden && document.getElementById('project-header').textContent.includes('远端委托工程')");
    await evaluate('subagentFixture.release()');
    await sleep(100);
    assert.match(await evaluate("document.getElementById('project-header').textContent"), /远端委托工程/);
    checks.push('deferred old project response cannot overwrite newer remote selection');
    await evaluate("document.querySelector('[data-id=\"p1\"]').click()");
    await until("document.getElementById('project-header').textContent.includes('本地委托工程')");
    await evaluate("document.querySelector('[data-pf-role=\"Memo\"]').focus(); document.querySelector('[data-pf-role=\"Memo\"]').click(); subagentFixture.removeMemo(); document.getElementById('refresh-btn').click()");
    await until("!document.getElementById('project-view').hidden && !document.querySelector('[data-pf-role=\"Memo\"]')");
    assert.equal(await evaluate("document.querySelector('[data-pf-role=\"\"]').getAttribute('aria-pressed')"), 'true');
    assert.equal(await evaluate("document.activeElement.dataset.pfRole"), '');
    await evaluate("document.querySelector('[data-history-maid]').click()");
    await until("subagentFixture.counts().history === 1");
    checks.push('disappearing selected role falls back to all and restores focus; existing local history entry still works');
    await evaluate("document.querySelector('[data-id=\"p2\"]').click()");
    await until("document.getElementById('project-header').textContent.includes('普通工程')");
    assert.equal(await evaluate("document.querySelectorAll('.pf-delegation-monitor,[data-pf-role]').length"), 0);
    assert.match(await evaluate("document.getElementById('pane-overview').textContent"), /更新者 @Kerr/);
    await shot('ordinary-todo');
    const counts = await evaluate('subagentFixture.counts()');
    const detailCount = counts.detail;
    await sleep(400);
    assert.equal((await evaluate('subagentFixture.counts()')).detail, detailCount);
    assert.equal(counts.forbidden, 0);
    assert.deepEqual(network, []);
    assert.deepEqual(errors, []);
    checks.push('ordinary Todo has no delegation placeholders; zero mutation calls, external network or new timer polling');
    await finish();
}).catch(finish);