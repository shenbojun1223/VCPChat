// Windows / installed Electron + Puppeteer. No model, live server or user profile.
// Run: node scripts/test-native-tool-display-electron.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidence = await fs.mkdtemp(path.join(root, '.evidence/native-display-electron-'));
const appData = await fs.mkdtemp(path.join(os.tmpdir(), 'vcp-native-display-'));
const agent = 'NativeDisplayFixture';
const topic = 'native-display-topic';
const answer = 'NATIVE_DISPLAY_SYNTHETIC_ANSWER';
const timeout = 30000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const bound = (promise, ms, label) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), ms);
    promise.then(value => { clearTimeout(timer); resolve(value); },
        error => { clearTimeout(timer); reject(error); });
});
const report = {
    passed: false, synthetic: true, officialModelRequests: 0, appData,
    requests: [], checks: {}, cleanup: {}, at: new Date().toISOString(),
};
let child, browser, page, closed = false, spawnError, stderr = '';
let held = null;
const openResponses = new Set();
const server = http.createServer((req, res) => {
    (async () => {
        if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
            res.writeHead(404); res.end(); return;
        }
        let raw = '';
        for await (const chunk of req) {
            raw += chunk;
            if (Buffer.byteLength(raw) > 1024 * 1024) throw new Error('fixture request limit');
        }
        const body = JSON.parse(raw);
        const n = report.requests.length + 1;
        report.requests.push({ ordinal: n, model: body.model, stream: body.stream });
        assert.equal(body.stream, true);
        assert.equal(body.model, 'native-display-synthetic');
        assert.ok(n <= 2, 'no replay or extra generation requests');
        const id = `chatcmpl-native-fixture-${n}`;
        const frame = value => res.write(`data: ${JSON.stringify(value)}\n\n`);
        const metadata = (status, revision, evidence = 'transport_reported') => ({
            id, object: 'chat.completion.chunk', model: body.model,
            choices: [{ index: 0, delta: { content: '' }, finish_reason: null }],
            vcp_native_tool: {
                schema: 1, source: 'agy-native', requestId: id, callId: 'step:2',
                revision, sequence: revision + 1, name: 'manage_task', status,
                evidence, detailsPolicy: 'withheld',
            },
        });
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        openResponses.add(res);
        res.once('close', () => openResponses.delete(res));
        frame({ id, object: 'chat.completion.chunk', model: body.model,
            choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] });
        // The first response remains held until Chromium proves the running card exists.
        frame(metadata('running', 0));
        held = { n, res, release() {
            assert.equal(held?.n, n);
            held = null;
            if (n === 1) {
                frame(metadata('failed', 1));
                frame({ id, object: 'chat.completion.chunk', model: body.model,
                    choices: [{ index: 0, delta: { content: answer }, finish_reason: null }] });
                frame({ id, object: 'chat.completion.chunk',
                    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
            } else {
                frame(metadata('unknown', 1, 'missing_terminal'));
                frame({ object: 'chat.completion.chunk',
                    choices: [{ index: 0, delta: { content: '' }, finish_reason: 'stop' }],
                    vcp_status: { code: 'UPSTREAM_STREAM_ERROR' } });
            }
            res.end('data: [DONE]\n\n');
        } };
    })().catch(error => {
        report.fixtureError = error.message;
        res.destroy();
    });
});
server.requestTimeout = 10000;
const historyFile = path.join(appData, 'UserData', agent, 'topics', topic, 'history.json');

async function wait(predicate, label, ms = timeout) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        if (spawnError) throw spawnError;
        if (closed) throw new Error(`Electron closed before ${label}`);
        const value = await predicate();
        if (value) return value;
        await sleep(50);
    }
    throw new Error(`Timed out: ${label}`);
}
async function selectFixture() {
    await page.waitForFunction(() => document.documentElement.dataset.vcpRendererReady === 'true', { timeout });
    await page.waitForSelector(`#agentList > [data-item-id="${agent}"]`, { timeout });
    await page.evaluate(id => document.querySelector(`#agentList > [data-item-id="${id}"]`).click(), agent);
    await page.waitForFunction((id, topicId) => {
        const s = window.VCPMainChatState?.snapshot?.();
        return s?.selectedItem?.id === id && s?.topicId === topicId;
    }, { timeout }, agent, topic);
}
async function send(n) {
    await page.waitForFunction(() => {
        const input = document.getElementById('messageInput');
        const button = document.getElementById('sendMessageBtn');
        return input && !input.disabled && button && !button.disabled &&
            button.dataset.mode === 'send';
    }, { timeout });
    await page.evaluate(number => {
        const input = document.getElementById('messageInput');
        input.value = `native-display-fixture-${number}`;
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }, n);
    report.checks[`beforeSend${n}`] = await page.evaluate(() => ({
        disabled: document.getElementById('sendMessageBtn').disabled,
        mode: document.getElementById('sendMessageBtn').dataset.mode,
        input: document.getElementById('messageInput').value,
        topicId: window.VCPMainChatState.snapshot().topicId,
    }));
    await page.click('#sendMessageBtn');
    await wait(() => held?.n === n, `request ${n}`);
}
async function panels() {
    return page.evaluate(() => [...document.querySelectorAll('[data-vcp-native-tools]')].map(panel => ({
        text: panel.textContent, statuses: [...panel.querySelectorAll('[data-native-status]')].map(x => x.dataset.nativeStatus),
        visible: panel.getBoundingClientRect().width > 0 && panel.getBoundingClientRect().height > 0,
        inert: panel.querySelector('button,script,iframe,input') === null,
        contentColumn: panel.parentElement.classList.contains('details-and-bubble-wrapper'),
        insideMarkdown: Boolean(panel.closest('.md-content')),
    })));
}
try {
    assert.equal(process.platform, 'win32');
    await fs.mkdir(path.dirname(historyFile), { recursive: true });
    await fs.writeFile(historyFile, '[]');
    const configDir = path.join(appData, 'Agents', agent);
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(path.join(configDir, 'config.json'), JSON.stringify({
        name: agent, model: 'native-display-synthetic', streamOutput: true,
        promptMode: 'original', originalSystemPrompt: 'Synthetic display fixture',
        systemPrompt: 'Synthetic display fixture', stripRegexes: [],
        topics: [{ id: topic, name: topic, createdAt: 1, locked: true }],
    }));
    await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
    report.fixturePort = server.address().port;
    await fs.writeFile(path.join(appData, 'settings.json'), JSON.stringify({
        uiMode: 'classic', enableDistributedServer: false, assistantEnabled: false,
        vcpServerUrl: `http://127.0.0.1:${report.fixturePort}/v1/chat/completions`,
        vcpApiKey: 'synthetic-native-display-key',
    }));
    const portServer = net.createServer();
    await new Promise((resolve, reject) => portServer.once('error', reject).listen(0, '127.0.0.1', resolve));
    const debugPort = portServer.address().port;
    await new Promise(resolve => portServer.close(resolve));
    report.debugPort = debugPort;
    await fs.writeFile(path.join(evidence, 'intent.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
    const env = { ...process.env, VCPCHAT_APP_DATA_DIR: appData, VCPCHAT_E2E_TEST: '1' };
    delete env.ELECTRON_RUN_AS_NODE;
    child = spawn(path.join(root, 'node_modules/electron/dist/electron.exe'),
        ['.', '--allow-multiple-instances', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${debugPort}`],
        { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    report.pid = child.pid;
    child.on('error', error => { spawnError = error; });
    child.on('close', (code, signal) => { closed = true; report.childExit = { code, signal }; });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-16000); });
    await wait(async () => {
        try { return (await fetch(`http://127.0.0.1:${debugPort}/json/version`, { signal: AbortSignal.timeout(1000) })).ok; }
        catch { return false; }
    }, 'devtools endpoint');
    browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${debugPort}`, protocolTimeout: timeout });
    page = await wait(async () => (await browser.pages()).find(p => p.url().includes('/main.html')), 'main renderer');
    page.setDefaultTimeout(timeout);
    report.rendererMessages = [];
    const record = (type, text) => {
        report.rendererMessages.push({ type, text: String(text).slice(0, 2000) });
        if (report.rendererMessages.length > 80) report.rendererMessages.shift();
    };
    page.on('console', message => record(message.type(), message.text()));
    page.on('pageerror', error => record('pageerror', error.message));
    await selectFixture();
    await send(1);
    await page.waitForSelector('[data-vcp-native-tools] [data-native-status="running"]');
    const live = await panels();
    assert.equal(live.length, 1);
    assert.equal(live[0].visible, true);
    assert.equal(live[0].inert, true);
    assert.match(live[0].text, /manage_task/);
    assert.match(live[0].text, /调用已发起/);
    assert.equal(await page.evaluate(text => document.getElementById('chatMessages')?.textContent.includes(text) || false, answer), false);
    report.checks.liveBeforeText = live;
    await page.screenshot({ path: path.join(evidence, 'live.png') });
    held.release();
    await wait(async () => {
        const history = JSON.parse(await fs.readFile(historyFile, 'utf8'));
        return history.some(m => m.content === answer && m.nativeToolEvents?.[0]?.status === 'failed');
    }, 'first durable history');
    await page.waitForSelector('[data-native-status="failed"]');
    report.checks.firstHistory = JSON.parse(await fs.readFile(historyFile, 'utf8'));
    assert.equal(report.checks.firstHistory.filter(m => m.role === 'assistant').length, 1);
    await send(2);
    await page.waitForSelector('[data-native-status="running"]');
    held.release();
    await wait(async () => {
        const history = JSON.parse(await fs.readFile(historyFile, 'utf8'));
        return history.some(m => m.finishReason === 'failed' && m.nativeToolEvents?.[0]?.status === 'unknown');
    }, 'empty failure durable history');
    const disk = await fs.readFile(historyFile);
    const history = JSON.parse(disk);
    const assistants = history.filter(m => m.role === 'assistant');
    assert.equal(assistants.length, 2);
    assert.equal(assistants[0].content, answer);
    assert.equal(assistants[1].content, '[系统错误] 上游响应返回错误');
    assert.equal(assistants[1].finishReason, 'failed');
    assert.equal(report.requests.length, 2);
    report.checks.disk = assistants;
    report.historySha256 = createHash('sha256').update(disk).digest('hex');
    await fs.writeFile(path.join(evidence, 'history.json'), disk, { flag: 'wx' });
    await page.reload({ waitUntil: 'domcontentloaded', timeout });
    await selectFixture();
    await page.waitForFunction(() => document.querySelectorAll('[data-vcp-native-tools]').length === 2, { timeout });
    report.checks.reloaded = await panels();
    assert.deepEqual(report.checks.reloaded.map(p => p.statuses), [['failed'], ['unknown']]);
    assert.ok(report.checks.reloaded.every(p => p.visible && p.inert && p.contentColumn && !p.insideMarkdown));
    report.checks.geometry = await page.evaluate(async () => {
        const rows = [];
        for (const panel of document.querySelectorAll('[data-vcp-native-tools]')) {
            panel.scrollIntoView({ block: 'center' });
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const rect = panel.getBoundingClientRect();
            const column = panel.parentElement.getBoundingClientRect();
            const text = panel.parentElement.querySelector('.md-content')?.getBoundingClientRect();
            rows.push({
                panelWidth: rect.width, columnWidth: column.width,
                textWidth: text?.width, belowText: Boolean(text && rect.top >= text.bottom - 1),
                fitsColumn: rect.left >= column.left - 1 && rect.right <= column.right + 1,
            });
        }
        return rows;
    });
    assert.equal(report.checks.geometry.length, 2);
    assert.ok(report.checks.geometry.every(g => g.panelWidth > 200 && g.textWidth > 120 && g.belowText && g.fitsColumn),
        JSON.stringify(report.checks.geometry));
    assert.equal(createHash('sha256').update(await fs.readFile(historyFile)).digest('hex'), report.historySha256);
    assert.equal(report.requests.length, 2);
    await page.screenshot({ path: path.join(evidence, 'reloaded.png') });
    report.checks.passed = true;
} catch (error) {
    report.error = { message: error.message, stack: error.stack };
    if (page) {
        try {
            report.domOnFailure = await panels();
            report.sendOnFailure = await page.evaluate(() => ({
                disabled: document.getElementById('sendMessageBtn')?.disabled,
                mode: document.getElementById('sendMessageBtn')?.dataset.mode,
                input: document.getElementById('messageInput')?.value,
                topicId: window.VCPMainChatState?.snapshot?.().topicId,
                history: window.VCPMainChatState?.snapshot?.().history,
            }));
            await page.screenshot({ path: path.join(evidence, 'failed.png') });
        }
        catch (captureError) { report.captureError = captureError.message; }
    }
} finally {
    if (browser) {
        try { await bound(browser.close(), 5000, 'fixture browser close'); }
        catch { browser.disconnect(); }
    }
    if (child?.pid && !closed) {
        try { await bound(new Promise(resolve => child.once('close', resolve)), 3000, 'fixture exit'); }
        catch {
            if (!closed) {
                report.cleanup.forced = true;
                await bound(new Promise((resolve, reject) => {
                    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'],
                        { windowsHide: true, stdio: 'ignore' });
                    killer.once('error', reject);
                    killer.once('close', code => code === 0 ? resolve() : reject(new Error(`taskkill ${code}`)));
                }), 5000, 'fixture tree termination').catch(error => { report.cleanup.error = error.message; });
                if (!closed) await bound(new Promise(resolve => child.once('close', resolve)), 5000, 'fixture close receipt')
                    .catch(error => { report.cleanup.error = error.message; });
            }
        }
    }
    for (const res of openResponses) res.destroy();
    if (server.listening) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    report.cleanup.listenerClosed = !server.listening;
    report.cleanup.childClosed = !child || closed;
    report.passed = report.checks.passed === true && report.cleanup.childClosed && !report.cleanup.error;
    report.finishedAt = new Date().toISOString();
    await fs.writeFile(path.join(evidence, 'stderr.log'), stderr);
    await fs.writeFile(path.join(evidence, 'result.json'), JSON.stringify(report, null, 2));
    // Retain isolated profile as evidence for diagnosis, never remove a live profile.
    console.log(JSON.stringify({ evidence, passed: report.passed, requests: report.requests.length,
        cleanup: report.cleanup, error: report.error?.message, appData }, null, 2));
    process.exitCode = report.passed ? 0 : 1;
}