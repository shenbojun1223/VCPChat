'use strict';
// Run: electron scripts/test-forge-catalog-window.cjs <new absolute evidence directory>
// Actual HTML/CSS/scripts, synthetic API. No production IPC, credentials or DB.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const evidence = process.argv[2];
if (!evidence || !path.isAbsolute(evidence) || fs.existsSync(evidence)) {
    throw Error('Provide a new absolute evidence directory');
}
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(evidence, 'profile'));
app.setPath('sessionData', path.join(evidence, 'session'));
app.disableHardwareAcceleration();
const root = path.resolve(__dirname, '..');
const errors = [], blockedNetwork = [], checks = [];
let win, finished = false;
function fixturePreload() {
    const { contextBridge } = require('electron');
    let offline = false;
    const counts = { list: 0, detail: 0, forbidden: 0 };
    const time = '2026-10-21T00:00:00.000Z';
    const progress = { total: 2, done: 1, pending: 1, doing: 0, blocked: 0, text: '1/2' };
    const local = {
        id: 'p1', name: '本地计划 · 可继续施工', status: 'accepted', deleted_at: null,
        created_at: time, updated_at: time, created_by: 'Kerr',
        workspace_alias: 'fixture', root: 'synthetic-only',
        rootInfo: { root: 'synthetic-only', writable: true, workspaceAlias: 'fixture' },
        progress, stats: { nodeCount: 0, fileCount: 0 }, maids: [],
    };
    const remote = () => ({
        id: 'remote:' + 'a'.repeat(64),
        name: '服务器计划 <img src=x onerror=alert(1)>',
        status: 'accepted', deleted_at: null, updated_at: time, created_at: time,
        workspace_alias: 'server-fixture', progress, stats: null, maids: [],
        rootInfo: { root: null, writable: false },
        catalog: { remote: true, sourceId: 'server-fixture', localProjectId: 'p1',
            version: 3, observedAt: 1792512000000, stale: offline },
    });
    const todos = [
        { seq: 1, status: 'done', title: '目录发布', note: '<script>window.injected=true</script>',
            updated_by: 'Kerr', updated_at: time, truncated: ['note'] },
        { seq: 2, status: 'pending', title: '真实窗口验收', note: '等待检查',
            updated_by: 'Kerr', updated_at: time, truncated: [] },
    ];
    const forbidden = async () => {
        counts.forbidden++;
        return { success: false, error: 'TEST_FORBIDDEN_OPERATION' };
    };
    contextBridge.exposeInMainWorld('utilityAPI', {
        loadSettings: async () => ({ currentThemeMode: 'dark' }),
        loadForumConfig: async () => ({ replyUsername: 'Kerr' }),
        projectForgeListProjects: async options => {
            counts.list++;
            if (options.includeCatalog !== true) throw Error('Unified flag missing');
            return { success: true, data: { projects: [local, remote()],
                catalog: { phase: offline ? 'offline' : 'online', cached: offline } } };
        },
        projectForgeGetProject: async id => {
            counts.detail++;
            if (id !== local.id && id !== remote().id) throw Error('Unknown fixture ID');
            return { success: true, data: {
                project: id === local.id ? local : remote(), todos,
                contributors: [], timeline: [], files: [],
            } };
        },
        projectForgeDeleteProject: forbidden,
        projectForgeGetNode: forbidden,
        projectForgeSearchHistory: forbidden,
        projectForgeRevertFile: forbidden,
        windowReady() {},
    });
    contextBridge.exposeInMainWorld('catalogWindowTest', {
        offline: value => { offline = Boolean(value); },
        counts: () => ({ ...counts }),
    });
}
const preload = path.join(evidence, 'fixture-preload.cjs');
fs.writeFileSync(preload, '(' + fixturePreload.toString() + ')();', 'utf8');
const evaluate = code => win.webContents.executeJavaScript(code);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(code) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
        if (await evaluate(code)) return;
        await sleep(30);
    }
    throw Error('DOM condition timed out: ' + code);
}
async function screenshot(name) {
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await sleep(200);
    const image = await win.webContents.capturePage();
    assert.equal(image.isEmpty(), false, 'Empty screenshot');
    fs.writeFileSync(path.join(evidence, name + '.png'), image.toPNG());
}
async function finish(error) {
    if (finished) return;
    finished = true;
    clearTimeout(watchdog);
    if (error && win && !win.isDestroyed()) {
        try { await screenshot('failure'); } catch {}
    }
    const result = {
        ok: !error, scope: 'actual Electron page with synthetic APIs, not production integration',
        checks, errors, blockedNetwork, error: error ? String(error.stack || error) : null,
        electron: process.versions.electron, completedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    if (win && !win.isDestroyed()) win.destroy();
    app.exit(error ? 1 : 0);
}
const watchdog = setTimeout(() => { void finish(Error('Window test timed out')); }, 45000);
app.whenReady().then(async () => {
    const isolated = session.fromPartition('forge-catalog-window-' + process.pid);
    isolated.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
        (details, callback) => { blockedNetwork.push(details.url); callback({ cancel: true }); });
    win = new BrowserWindow({
        width: 1280, height: 900, show: false,
        webPreferences: { preload, contextIsolation: true, nodeIntegration: false,
            sandbox: true, session: isolated, backgroundThrottling: false },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.on('preload-error', (_event, _file, error) => errors.push(String(error)));
    win.webContents.on('console-message', event => {
        if (event.level === 'error') errors.push(event.message);
    });
    win.webContents.on('render-process-gone', (_event, details) => {
        if (!finished) void finish(Error('Renderer exited: ' + details.reason));
    });
    await win.loadFile(path.join(root, 'ProjectForgemodules', 'projectforge.html'));
    await until("document.querySelectorAll('.project-item').length === 2");
    win.showInactive();
    const initial = await evaluate(`({
        gitHidden: getComputedStyle(document.getElementById('side-tab-git')).display === 'none',
        sourceHidden: getComputedStyle(document.getElementById('side-tab-source')).display === 'none',
        banner: document.getElementById('catalog-status').textContent
    })`);
    assert.ok(initial.gitHidden && initial.sourceHidden);
    assert.match(initial.banner, /已连接/);
    assert.equal(await evaluate("typeof CodeMirror.defineSimpleMode === 'function' && Boolean(CodeMirror.modes.rust)"), true);
    checks.push('actual page loaded; Rust mode dependency present; absent Git/source APIs disable scans');
    await evaluate("document.querySelector('.project-item[data-id^=\"remote:\"]').click()");
    await until("document.getElementById('project-header').textContent.includes('服务器计划')");
    const remote = await evaluate(`({
        tabs: [...document.querySelectorAll('.tab')].filter(e => e.getBoundingClientRect().width > 0).map(e => e.dataset.tab),
        deleteCount: document.querySelector('.project-item[data-id^="remote:"]').querySelectorAll('.project-delete-confirm').length,
        injected: Boolean(window.injected),
        unsafeNodes: document.querySelectorAll('#project-header img, #pane-overview script').length,
        overview: document.getElementById('pane-overview').textContent,
        header: document.getElementById('project-header').textContent,
        overflow: document.documentElement.scrollWidth > innerWidth + 1
    })`);
    assert.deepEqual(remote.tabs, ['overview']);
    assert.equal(remote.deleteCount, 0);
    assert.equal(remote.injected, false);
    assert.equal(remote.unsafeNodes, 0);
    assert.match(remote.overview, /截断预览/);
    assert.match(remote.header, /远端计划只读/);
    assert.equal(remote.overflow, false);
    checks.push('remote view: computed tab visibility, no deletion, escaped text, truncation, viewport bounds');
    await screenshot('remote-online');
    await evaluate("catalogWindowTest.offline(true); document.getElementById('refresh-btn').click()");
    await until("document.getElementById('project-header').textContent.includes('离线缓存')");
    assert.match(await evaluate("document.getElementById('catalog-status').textContent"), /可能已过期/);
    checks.push('refresh shows explicit offline cache state');
    await screenshot('remote-offline');
    await evaluate("document.querySelector('.project-item[data-id=\"p1\"]').click()");
    await until("document.getElementById('project-header').textContent.includes('本地计划')");
    const local = await evaluate(`({
        tabs: [...document.querySelectorAll('.tab')].filter(e => e.getBoundingClientRect().width > 0).length,
        deleteCount: document.querySelector('.project-item[data-id="p1"]').querySelectorAll('.project-delete-confirm').length,
        counts: catalogWindowTest.counts()
    })`);
    assert.ok(local.tabs > 1);
    assert.equal(local.deleteCount, 1);
    assert.equal(local.counts.forbidden, 0);
    checks.push('return to local restores tabs and local controls; no mutation/history APIs called');
    await screenshot('local-return');
    assert.deepEqual(errors, []);
    assert.deepEqual(blockedNetwork, []);
    await finish();
}).catch(finish);