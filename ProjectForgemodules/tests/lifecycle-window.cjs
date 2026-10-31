'use strict';
// electron ProjectForgemodules/tests/lifecycle-window.cjs <new absolute evidence directory>
// Real renderer and timers; synthetic IPC and visibility, never production or OS clipboard.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..'), evidence = process.argv[2];
if (!evidence || !path.isAbsolute(evidence) || fs.existsSync(evidence)) throw Error('Provide a new absolute evidence directory');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(evidence, 'profile'));
app.setPath('sessionData', path.join(evidence, 'session'));
app.disableHardwareAcceleration();
const checks = [], errors = [], network = [];
let win, finished = false;
function fixturePreload() {
    const { contextBridge } = require('electron');
    let version = 1, status = 'running', lists = 0, details = 0, forbidden = 0;
    const project = () => ({
        id: 'remote:fixture', name: 'Lifecycle fixture', status: 'active', workspace_alias: 'fixture',
        rootInfo: { writable: false }, progress: { total: 1, done: 0, text: '0/1' }, stats: {}, maids: [],
        catalog: { remote: true, sourceId: 'fixture-source', localProjectId: 'ptest',
            version, digest: String(version).repeat(64), stale: false, observedAt: Date.now() },
    });
    const todo = () => {
        const data = { version: 1, projectId: 'ptest', todoId: 7, todoSeq: 1,
            delegationId: 'aa-delegation-1793459141509-557448cf', role: 'Worker#live',
            assignedBy: 'Kerr', sessionId: 'fixture-only', runtimeStatus: status,
            stage: status === 'completed' ? 'review' : 'working', sequence: version,
            updatedAt: '2026-10-31T15:00:00.000Z' };
        return { seq: 1, title: 'Readonly lifecycle fixture', status: 'pending',
            note: '[[ForgeDelegation::v1]]\n' + JSON.stringify(data) + '\n[[/ForgeDelegation]]\n'
                + '保留原始备注\n'.repeat(50), updated_by: 'AgentAssistant', updated_at: data.updatedAt };
    };
    const deny = async () => { forbidden++; throw Error('FORBIDDEN'); };
    contextBridge.exposeInMainWorld('utilityAPI', {
        loadSettings: async () => ({ currentThemeMode: 'dark' }),
        loadForumConfig: async () => ({ replyUsername: 'Kerr' }),
        projectForgeListProjects: async () => { lists++; return { success: true,
            data: { projects: [project()], catalog: { phase: 'online', cached: false } } }; },
        projectForgeGetProject: async () => { details++; return { success: true,
            data: { project: project(), todos: [todo()], contributors: [], timeline: [], files: [] } }; },
        projectForgeDeleteProject: deny, projectForgeRevertFile: deny,
        windowReady() {},
    });
    contextBridge.exposeInMainWorld('lifecycleFixture', {
        advance: next => { if (!['waiting', 'completed'].includes(next)) throw Error('BAD_FIXTURE'); status = next; version++; },
        counts: () => ({ lists, details, forbidden }),
    });
}
const preload = path.join(evidence, 'preload.cjs');
fs.writeFileSync(preload, '(' + fixturePreload.toString() + ')();');
const evaluate = code => win.webContents.executeJavaScript(code);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(code) {
    const end = Date.now() + 8500;
    while (Date.now() < end) {
        if (await evaluate(code)) return;
        await sleep(40);
    }
    throw Error('Timed out: ' + code);
}
async function finish(error) {
    if (finished) return;
    finished = true; clearTimeout(watchdog);
    let counts = null;
    if (win && !win.isDestroyed()) try {
        counts = await evaluate('lifecycleFixture.counts()');
        fs.writeFileSync(path.join(evidence, error ? 'failure.png' : 'final.png'),
            (await win.webContents.capturePage()).toPNG());
    } catch {}
    const result = { ok: !error, scope: 'hidden actual renderer and real timers; synthetic IPC and visibility; not live AA',
        checks, counts, errors, network, error: error ? String(error.stack || error) : null,
        electron: process.versions.electron, completedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    if (win && !win.isDestroyed()) win.destroy();
    app.exit(error ? 1 : 0);
}
const watchdog = setTimeout(() => { void finish(Error('Lifecycle window timed out')); }, 45000);
app.whenReady().then(async () => {
    const isolated = session.fromPartition('forge-lifecycle-' + process.pid);
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    isolated.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
        (request, callback) => { network.push(request.url); callback({ cancel: true }); });
    win = new BrowserWindow({ width: 1100, height: 800, show: false, webPreferences: {
        preload, session: isolated, sandbox: true, contextIsolation: true,
        nodeIntegration: false, backgroundThrottling: false,
    } });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.on('preload-error', (_event, _file, error) => errors.push(String(error)));
    win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
    await win.loadFile(path.join(root, 'ProjectForgemodules/projectforge.html'));
    await until("document.querySelector('.project-item')");
    await evaluate(`window.fixtureVisible = true;
        Object.defineProperty(document, 'visibilityState', { configurable: true,
            get: () => window.fixtureVisible ? 'visible' : 'hidden' });
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
            readText: () => { throw Error('CLIPBOARD_FORBIDDEN'); },
            writeText: () => { throw Error('CLIPBOARD_FORBIDDEN'); }
        } });
        window.manualRefreshClicks = 0;
        document.getElementById('refresh-btn').addEventListener('click', () => window.manualRefreshClicks++);
        document.querySelector('.project-item').click();`);
    await until("document.querySelector('.pf-delegation-phase')?.textContent === '施工中'");
    await evaluate(`document.querySelector('[data-pf-role="Worker#live"]').click();
        document.querySelector('details').open = true; document.querySelector('summary').focus();
        document.querySelector('.tab-body').scrollTop = 140;`);
    const savedTop = await evaluate("document.querySelector('.tab-body').scrollTop");
    const initial = await evaluate('lifecycleFixture.counts()');
    await sleep(5500);
    const unchanged = await evaluate('lifecycleFixture.counts()');
    assert.ok(unchanged.lists > initial.lists);
    assert.equal(unchanged.details, initial.details);
    checks.push('real 5-second timer reads remote index without manual refresh; unchanged version does not redraw detail');
    for (const [next, label] of [['waiting', '等待续跑'], ['completed', '待核验']]) {
        await evaluate(`lifecycleFixture.advance(${JSON.stringify(next)})`);
        await until(`document.querySelector('.pf-delegation-phase')?.textContent === ${JSON.stringify(label)}`);
        assert.equal(await evaluate("document.querySelector('details').open"), true);
        assert.equal(await evaluate('document.activeElement.tagName'), 'SUMMARY');
        assert.equal(await evaluate("document.querySelector('[data-pf-role][aria-pressed=\"true\"]').dataset.pfRole"), 'Worker#live');
        assert.ok(Math.abs(await evaluate("document.querySelector('.tab-body').scrollTop") - savedTop) < 2);
    }
    assert.equal(await evaluate("document.querySelectorAll('.phase-verified').length"), 0);
    assert.equal(await evaluate("document.querySelector('.todo-state').textContent"), '待办');
    checks.push('automatic running → waiting → review snapshots preserve filter, expanded note, focus and actual scroll; no business done or verified');
    await evaluate('window.fixtureVisible = false');
    const hidden = await evaluate('lifecycleFixture.counts()');
    await sleep(5500);
    assert.deepEqual(await evaluate('lifecycleFixture.counts()'), hidden);
    await evaluate("window.dispatchEvent(new Event('pagehide')); window.fixtureVisible = true");
    const stopped = await evaluate('lifecycleFixture.counts()');
    await sleep(5500);
    assert.deepEqual(await evaluate('lifecycleFixture.counts()'), stopped);
    checks.push('synthetic hidden visibility pauses remote reads; pagehide cancels future timer reads');
    assert.equal(await evaluate('window.manualRefreshClicks'), 0);
    assert.equal(await evaluate('lifecycleFixture.counts().forbidden'), 0);
    assert.equal(win.isVisible(), false);
    assert.deepEqual(errors, []); assert.deepEqual(network, []);
    checks.push('zero refresh clicks, forbidden mutations, clipboard use, external requests or console errors; window never shown');
    await finish();
}).catch(finish);