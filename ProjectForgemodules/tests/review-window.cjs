'use strict';
// electron ProjectForgemodules/tests/review-window.cjs <new absolute evidence directory>
// Actual page, synthetic IPC. Hidden, no OS clipboard, no production data or external network.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const evidence = process.argv[2], root = path.resolve(__dirname, '../..');
if (!evidence || !path.isAbsolute(evidence) || fs.existsSync(evidence)) throw Error('Provide a new absolute evidence directory');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(evidence, 'profile'));
app.setPath('sessionData', path.join(evidence, 'session'));
app.disableHardwareAcceleration();
const checks = [], errors = [], network = [], layouts = [];
let win, finished = false;
function fixturePreload() {
    const { contextBridge } = require('electron');
    let requests = 0, forbidden = 0;
    const at = '2026-10-31T13:00:00Z';
    const projects = ['p1', 'remote:review'].map(id => ({
        id, name: id === 'p1' ? 'Review local fixture' : 'Review remote fixture', status: 'review',
        workspace_alias: 'fixture', root: 'fixture-only', rootInfo: { writable: false }, maids: [], stats: {},
        progress: { total: 6, done: 5, text: '5/6' },
        ...(id.startsWith('remote:') ? { catalog: {
            remote: true, sourceId: 'review-source', localProjectId: 'p1',
            version: 1, observedAt: 1000, stale: false,
        } } : {}),
    }));
    const todos = [
        { seq: 6, title: '【鲸鱼娘#聊天审查】限定文件复测', note: '复测按限定文件边界与审查交付接受，验收=@Kerr。执行分身=@鲸鱼娘#边界复测；session_id=boundary-session；delegationId=boundary-id。未测开放终端。' },
        { seq: 7, title: '【鲸鱼娘#记忆审查】审查交付', note: '执行分身=@鲸鱼娘#记忆审查；派工方/验收=@Kerr；session_id=memory-session；delegationId=memory-id。状态=审查交付已独立核验并接受。证据：DebugLog/review-memory.md，b89/n89；未测试跨任务召回。' },
        { seq: 9, title: '【鲸鱼娘#知识沉淀】联合执行', note: '执行分身=@鲸鱼娘#知识沉淀、@鲸鱼娘#独立记忆读取；派工/验收=@Kerr；均temporary_contact一次性通讯，无异步delegationId。状态=限定范围验收通过：共享库一次create、同篇一次update、无旧历史/答案的新会话一次DailyNoteSearcher检索并答对。原始日志依次fixture-1、fixture-2；聊天版自动注入另验。' },
        { seq: 10, title: '否定不能变绿', note: '执行分身=Memo;阶段=核验通过;delegationId=deny-id。核验结果=不通过' },
        { seq: 11, title: '阻塞不等于核验失败', status: 'blocked', note: '执行分身=Memo;状态=施工中;session_id=working-session' },
        { seq: 12, title: '普通 Todo', note: '普通原始备注 <img src=x onerror=bad()>' },
    ].map(t => ({ status: 'done', updated_by: 'Kerr', updated_at: at, ...t }));
    const deny = async () => { forbidden++; throw Error('FIXTURE_FORBIDDEN'); };
    contextBridge.exposeInMainWorld('utilityAPI', {
        loadSettings: async () => ({ currentThemeMode: 'dark' }),
        loadForumConfig: async () => ({ replyUsername: 'Kerr' }),
        projectForgeListProjects: async () => ({ success: true, data: { projects, catalog: { phase: 'online' } } }),
        projectForgeGetProject: async id => {
            requests++;
            return { success: true, data: { project: projects.find(p => p.id === id), todos, contributors: [], timeline: [], files: [] } };
        },
        projectForgeDeleteProject: deny, projectForgeRevertFile: deny, projectForgeGetNode: deny,
        windowReady() {},
    });
    contextBridge.exposeInMainWorld('reviewFixture', { counts: () => ({ requests, forbidden }) });
}
const preload = path.join(evidence, 'preload.cjs');
fs.writeFileSync(preload, '(' + fixturePreload.toString() + ')();');
const evaluate = code => win.webContents.executeJavaScript(code);
async function until(code) {
    const deadline = Date.now() + 7000;
    while (Date.now() < deadline) {
        if (await evaluate(code)) return;
        await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw Error('Timed out: ' + code);
}
async function frame() {
    await evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
}
async function finish(error) {
    if (finished) return;
    finished = true; clearTimeout(watchdog);
    if (error && win && !win.isDestroyed()) try {
        fs.writeFileSync(path.join(evidence, 'failure.png'), (await win.webContents.capturePage()).toPNG());
    } catch {}
    const result = { ok: !error, scope: 'hidden real page, synthetic IPC; not production or OS clipboard acceptance',
        checks, layouts, errors, network, error: error ? String(error.stack || error) : null,
        electron: process.versions.electron, completedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    if (win && !win.isDestroyed()) win.destroy();
    app.exit(error ? 1 : 0);
}
const watchdog = setTimeout(() => { void finish(Error('Review window test timed out')); }, 35000);
app.whenReady().then(async () => {
    const isolated = session.fromPartition('forge-review-' + process.pid);
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    isolated.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
        (details, callback) => { network.push(details.url); callback({ cancel: true }); });
    win = new BrowserWindow({ width: 1280, height: 900, show: false, webPreferences: {
        preload, session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
    } });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.on('preload-error', (_event, _file, error) => errors.push(String(error)));
    win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
    await win.loadFile(path.join(root, 'ProjectForgemodules/projectforge.html'));
    await until("document.querySelectorAll('.project-item').length === 2");
    await evaluate(`Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        writeText: () => { throw Error('OS_CLIPBOARD_FORBIDDEN'); },
        readText: () => { throw Error('OS_CLIPBOARD_FORBIDDEN'); }
    } }); document.querySelector('.project-item[data-id="p1"]').click()`);
    await until("document.querySelectorAll('.pf-delegation-card').length === 5");
    const projection = await evaluate(`(() => {
        const rows = [...document.querySelectorAll('[data-pf-todo]')];
        return rows.map(el => ({ title: el.querySelector('[data-pf-title]').textContent,
            phase: el.querySelector('.pf-delegation-phase')?.textContent || '',
            scope: el.querySelector('.pf-delegation-detail')?.textContent || '' }));
    })()`);
    assert.equal(projection[0].phase, '未知');
    assert.equal(projection[1].phase, '审查交付已接受');
    assert.equal(projection[2].phase, '限定范围验收通过');
    assert.match(projection[2].scope, /DailyNoteSearcher/);
    assert.match(projection[3].phase, /核验退回/);
    assert.equal(projection[4].phase, '施工中');
    assert.equal(projection[5].phase, '');
    assert.equal(await evaluate(`(() => {
        const card = document.querySelector('.pf-delegation-card.is-rejected');
        return getComputedStyle(card.querySelector('.pf-delegation-steps .rejected')).color
            === getComputedStyle(card.querySelector('.pf-delegation-phase.rejected')).color;
    })()`), true, 'rejection step must use the same danger color as the rejection badge');
    checks.push('real page shows honest phases and independent blocking; rejection step and badge share danger color');
    for (const light of [false, true]) for (const width of [1280, 760]) {
        win.setSize(width, 900);
        await evaluate(`document.body.classList.toggle('light-theme', ${light}); document.querySelector('.tab-body').scrollTop = 0`);
        await frame();
        const geometry = await evaluate(`(() => {
            const pane = document.querySelector('.tab-body');
            return { overflow: pane.scrollWidth - pane.clientWidth,
                cards: [...document.querySelectorAll('.pf-delegation-card')].map(el => {
                    const card = el.getBoundingClientRect(), badge = el.querySelector('.pf-delegation-phase').getBoundingClientRect();
                    const head = el.querySelector('.pf-delegation-card-head').getBoundingClientRect();
                    const style = getComputedStyle(el);
                    return { display: style.display, direction: style.flexDirection, background: style.backgroundColor,
                        badgeContained: badge.right <= card.right && badge.left >= card.left && Math.abs(badge.top - head.top) < 2,
                        overflow: el.scrollWidth - el.clientWidth };
                }),
                statusWidth: document.querySelector('.todo-state').getBoundingClientRect().width };
        })()`);
        assert.ok(geometry.overflow <= 1);
        assert.ok(geometry.statusWidth < 56);
        assert.ok(geometry.cards.every(c => c.display === 'flex' && c.direction === 'column' && c.badgeContained && c.overflow <= 1));
        layouts.push({ light, width, ...geometry });
        fs.writeFileSync(path.join(evidence, `${light ? 'light' : 'dark'}-${width}.png`), (await win.webContents.capturePage()).toPNG());
    }
    checks.push('dark/light 1280/760 layouts: no pane/card overflow, top-aligned phase, flex cards and compact status');
    await evaluate("document.querySelector('.project-item[data-id=\"remote:review\"]').click()");
    await until("document.getElementById('project-header').textContent.includes('remote')");
    for (const role of ['@鲸鱼娘#知识沉淀', '@鲸鱼娘#独立记忆读取']) {
        await evaluate(`(() => {
            const b = [...document.querySelectorAll('[data-pf-role]')].find(el => el.dataset.pfRole === ${JSON.stringify(role)});
            b.focus(); b.click();
        })()`);
        assert.equal(await evaluate("document.querySelectorAll('.pf-delegation-card').length"), 1);
        assert.equal(await evaluate("document.querySelectorAll('[data-pf-todo]').length"), 1);
        assert.equal(await evaluate("document.activeElement.dataset.pfRole"), role);
        await evaluate("document.querySelector('[data-pf-locate]').click()");
        assert.match(await evaluate("document.activeElement.textContent"), /#9/);
        assert.equal(await evaluate("document.querySelectorAll('[data-pf-copy]').length"), 0);
        await evaluate("document.querySelector('details').open = true; document.querySelector('summary').focus()");
        const top = await evaluate("document.querySelector('.tab-body').scrollTop");
        const count = await evaluate('reviewFixture.counts().requests');
        await evaluate("document.getElementById('refresh-btn').click()");
        await until(`reviewFixture.counts().requests > ${count} && !document.getElementById('project-view').hidden && document.querySelector('details[open]')`);
        assert.equal(await evaluate("document.querySelector('[data-pf-role][aria-pressed=\"true\"]').dataset.pfRole"), role);
        assert.equal(await evaluate("document.activeElement.tagName"), 'SUMMARY');
        assert.ok(Math.abs(await evaluate("document.querySelector('.tab-body').scrollTop") - top) < 2);
    }
    checks.push('each joint role filters one record; locate and readonly refresh preserve role/expansion/focus/scroll, no invented IDs');
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    assert.equal(await evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches"), true);
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.pf-delegation-card')).animationName"), 'none');
    assert.equal(await evaluate('reviewFixture.counts().forbidden'), 0);
    assert.equal(await evaluate("document.querySelectorAll('#pane-overview img, #pane-overview script, #pane-overview [data-file], #pane-overview [data-node]').length"), 0);
    assert.equal(win.isVisible(), false);
    assert.deepEqual(errors, []); assert.deepEqual(network, []);
    checks.push('real reduced-motion media; zero forbidden writes/network/errors; window hidden throughout');
    await finish();
}).catch(finish);