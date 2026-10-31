'use strict';
// electron ProjectForgemodules/tests/todo-actions-window.cjs <new absolute evidence directory>
// Hidden real page, synthetic IPC and renderer clipboard double. Never touches OS clipboard.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const evidence = process.argv[2], root = path.resolve(__dirname, '../..');
if (!evidence || !path.isAbsolute(evidence) || fs.existsSync(evidence)) throw Error('Provide a new absolute evidence directory');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(evidence, 'profile'));
app.setPath('sessionData', path.join(evidence, 'session'));
app.disableHardwareAcceleration();
const checks = [], errors = [], network = [];
let win, finished = false;
function fixturePreload() {
    const { contextBridge } = require('electron');
    const at = '2026-10-31T08:40:00Z';
    const projects = ['p1', 'remote:fixture'].map(id => ({
        id, name: id === 'p1' ? 'Local fixture' : 'Remote fixture', status: 'active',
        workspace_alias: 'fixture', root: 'fixture-only', rootInfo: { writable: false },
        progress: { total: 2, done: 0, text: '0/2' }, stats: {}, maids: [],
        ...(id.startsWith('remote:') ? { catalog: {
            remote: true, sourceId: 'fixture-source', localProjectId: 'p1',
            version: 1, observedAt: 1000, stale: false,
        } } : {}),
    }));
    const todos = [1, 2].map(seq => ({
        seq, title: `Task ${seq}`, status: 'doing', updated_by: 'Kerr', updated_at: at,
        note: `执行分身=Memo;session_id=s${seq};delegationId=d${seq};阶段=施工中`,
    }));
    contextBridge.exposeInMainWorld('utilityAPI', {
        loadSettings: async () => ({ currentThemeMode: 'dark' }),
        loadForumConfig: async () => ({ replyUsername: 'Kerr' }),
        projectForgeListProjects: async () => ({ success: true, data: { projects, catalog: { phase: 'online' } } }),
        projectForgeGetProject: async id => ({ success: true, data: {
            project: projects.find(p => p.id === id), todos, contributors: [], timeline: [], files: [],
        } }),
        windowReady() {},
    });
}
const preload = path.join(evidence, 'preload.cjs');
fs.writeFileSync(preload, '(' + fixturePreload.toString() + ')();');
const evaluate = code => win.webContents.executeJavaScript(code);
async function until(code) {
    const end = Date.now() + 7000;
    while (Date.now() < end) {
        if (await evaluate(code)) return;
        await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw Error('Timed out: ' + code);
}
async function finish(error) {
    if (finished) return;
    finished = true;
    clearTimeout(watchdog);
    const result = { ok: !error, scope: 'hidden actual page; synthetic IPC and clipboard; not OS clipboard or production integration',
        checks, errors, network, error: error ? String(error.stack || error) : null, electron: process.versions.electron };
    fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    if (win && !win.isDestroyed()) win.destroy();
    app.exit(error ? 1 : 0);
}
const watchdog = setTimeout(() => { void finish(Error('Hidden smoke timed out')); }, 25000);
app.whenReady().then(async () => {
    const isolated = session.fromPartition('forge-actions-' + process.pid);
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    isolated.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
        (details, callback) => { network.push(details.url); callback({ cancel: true }); });
    win = new BrowserWindow({ width: 1100, height: 750, show: false, webPreferences: {
        preload, session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
    } });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.on('preload-error', (_event, _file, error) => errors.push(String(error)));
    win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
    await win.loadFile(path.join(root, 'ProjectForgemodules/projectforge.html'));
    await until("document.querySelectorAll('.project-item').length === 2");
    // Replace before any copy action. No call to native clipboard APIs is made.
    await evaluate(`window.copyCalls = []; window.rejectCopy = false;
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
            writeText: value => {
                window.copyCalls.push(value);
                return window.rejectCopy ? Promise.reject(Error('fixture denial')) : Promise.resolve();
            },
            readText: () => { throw Error('CLIPBOARD_READ_FORBIDDEN'); }
        } });
        document.querySelector('.project-item[data-id="p1"]').click();`);
    await until("document.querySelectorAll('[data-pf-locate]').length === 2");
    await evaluate("document.querySelectorAll('[data-pf-locate]')[1].click()");
    const located = await evaluate(`(() => {
        const row = document.querySelector('.is-located'), pane = document.querySelector('.tab-body');
        const top = row.getBoundingClientRect().top - pane.getBoundingClientRect().top;
        return { title: row.querySelector('[data-pf-title]').textContent,
            focused: document.activeElement === row.querySelector('[data-pf-title]'),
            scrollTop: pane.scrollTop, visible: top >= -1 && top < pane.clientHeight };
    })()`);
    assert.match(located.title, /Task 2/);
    assert.equal(located.focused, true);
    assert.ok(located.scrollTop > 0 && located.visible);
    checks.push('actual Chromium scroll and focus locate second same-role Todo without changing filter');
    await evaluate(`document.querySelectorAll('[data-pf-copy="delegationId"]')[0].click()`);
    await until("document.getElementById('toast').textContent === '委托 ID 已复制'");
    assert.deepEqual(await evaluate('window.copyCalls'), ['d1']);
    await evaluate(`window.rejectCopy = true; document.querySelector('[data-pf-copy="sessionId"]').click()`);
    await until("document.getElementById('toast').classList.contains('error')");
    assert.match(await evaluate("document.getElementById('toast').textContent"), /复制未确认/);
    checks.push('real host event delegation calls browser clipboard branch and displays success/rejection toast');
    await evaluate("window.rejectCopy = false; document.querySelector('.project-item[data-id=\"remote:fixture\"]').click()");
    await until("document.getElementById('project-header').textContent.includes('Remote fixture')");
    await evaluate("document.querySelectorAll('[data-pf-locate]')[1].click()");
    const savedScroll = await evaluate("document.querySelector('.tab-body').scrollTop");
    assert.equal(await evaluate("document.querySelectorAll('.is-located').length"), 1);
    await evaluate("document.getElementById('refresh-btn').click()");
    await until("!document.getElementById('project-view').hidden && document.querySelector('.is-located')");
    assert.equal(await evaluate("document.activeElement.hasAttribute('data-pf-title')"), true);
    assert.ok(Math.abs(await evaluate("document.querySelector('.tab-body').scrollTop") - savedScroll) < 2);
    await evaluate("document.querySelector('.pf-delegation-detail [data-pf-copy=\"sessionId\"]').click()");
    await until("document.getElementById('toast').textContent === '会话 ID 已复制'");
    assert.equal((await evaluate('window.copyCalls')).at(-1), 's1');
    assert.equal(await evaluate("document.querySelectorAll('#pane-overview [data-file],#pane-overview [data-node],#pane-overview [data-history-maid]').length"), 0);
    checks.push('remote readonly actions and same-project refresh retain located title, focus and actual scroll');
    win.setSize(760, 750);
    await evaluate("document.body.classList.add('light-theme'); document.querySelector('.tab-body').scrollTop = 0");
    assert.equal(await evaluate(`(() => { const p = document.querySelector('.tab-body'); return p.scrollWidth <= p.clientWidth + 1; })()`), true);
    assert.equal(win.isVisible(), false);
    assert.deepEqual(errors, []);
    assert.deepEqual(network, []);
    checks.push('new controls fit narrow light page; window never shown; no external requests or console errors');
    await finish();
}).catch(finish);