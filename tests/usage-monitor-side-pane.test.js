'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createTrustedMainSender } = require('./helpers/trusted-main-sender.cjs');
const {
    deriveSnapshotUrl,
    createUsageMonitorSnapshotHandler
} = require('../modules/ipc/usageMonitorHandlers');

test('deriveSnapshotUrl pins path to /admin_api/usage-monitor/snapshot and rejects embedded credentials', () => {
    assert.equal(
        deriveSnapshotUrl('http://127.0.0.1:6005/v1/chat/completions', '7d'),
        'http://127.0.0.1:6005/admin_api/usage-monitor/snapshot?period=7d'
    );
    assert.equal(deriveSnapshotUrl('http://user:pass@127.0.0.1:6005/v1/chat/completions', 'today'), null);
    assert.equal(deriveSnapshotUrl('ftp://127.0.0.1:6005', 'today'), null);
});

test('usageMonitorHandlers enforces main window sender guard, fixed endpoint, and 401/404 status mapping', async () => {
    const main = createTrustedMainSender('main.html');
    const otherWindow = createTrustedMainSender('Forummodules/forum.html');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcpchat-usage-ipc-'));
    const userDataDir = path.join(tmpDir, 'UserData');
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(
        path.join(userDataDir, 'forum.config.json'),
        JSON.stringify({ username: 'admin', password: 'secret-password' }),
        'utf8'
    );

    let mockStatus = 200;
    let mockBody = {
        success: true,
        data: {
            schemaVersion: 1,
            generatedAt: '2026-10-22T09:00:00.000Z',
            period: { key: 'today', start: '', end: '', timeZone: 'Asia/Shanghai' },
            accounts: [],
            activity: { totals: { requests: 5 } }
        }
    };
    let capturedUrl = '';

    const handler = createUsageMonitorSnapshotHandler({
        settingsManager: {
            async readSettings() {
                return { vcpServerUrl: 'http://127.0.0.1:6005/v1/chat/completions' };
            }
        },
        appDataDir: tmpDir,
        getMainWindow: () => main.mainWindow,
        httpFetch: async (url) => {
            capturedUrl = url;
            return {
                status: mockStatus,
                ok: mockStatus >= 200 && mockStatus < 300,
                body: mockBody
            };
        }
    });

    // Reject non-main window
    const denied = await handler(otherWindow.event, 'today');
    assert.equal(denied.success, false);
    assert.equal(denied.errorCode, 'SENDER_DENIED');

    // Reject invalid period
    const badPeriod = await handler(main.event, 'yearly');
    assert.equal(badPeriod.success, false);
    assert.equal(badPeriod.errorCode, 'INVALID_PERIOD');

    // Valid call from main window
    const okRes = await handler(main.event, 'today');
    assert.equal(okRes.success, true);
    assert.equal(capturedUrl, 'http://127.0.0.1:6005/admin_api/usage-monitor/snapshot?period=today');
    assert.equal(okRes.data.activity.totals.requests, 5);

    // 404 mapping
    mockStatus = 404;
    const notFound = await handler(main.event, 'today');
    assert.equal(notFound.success, false);
    assert.equal(notFound.errorCode, 'BACKEND_NOT_UPDATED');

    // 401 mapping without leaking password
    mockStatus = 401;
    const unauth = await handler(main.event, 'today');
    assert.equal(unauth.success, false);
    assert.equal(unauth.errorCode, 'ADMIN_AUTH_FAILED');
    assert.equal(JSON.stringify(unauth).includes('secret-password'), false);
});

test('usageMonitorSideProvider helpers distinguish 0 vs null, XSS-safe DOM rendering, and unmount disposal', async () => {
    const mod = await import(
        pathToFileURL(path.join(__dirname, '..', 'modules/ui-system/side-pane/usageMonitorSideProvider.js')).href
    );

    assert.equal(mod.formatPercent(null), '—');
    assert.equal(mod.formatPercent(0), '0%');
    assert.equal(mod.formatPercent(99.5), '99.5%');
    assert.equal(mod.formatNullableCompact(null), '—');
    assert.equal(mod.formatNullableCompact(0), '0');
    assert.equal(mod.formatCurrency('CNY', 12.5), '¥12.50');
    assert.equal(mod.formatCurrency('USD', null), '—');

    // Minimal fake DOM to verify textContent rendering (no HTML injection) and late response discard after dispose
    function createFakeEl(tag) {
        return {
            tagName: tag,
            className: '',
            textContent: '',
            style: {},
            children: [],
            listeners: {},
            classList: {
                _set: new Set(),
                add(...names) { names.forEach(n => this._set.add(n)); },
                toggle(name, force) {
                    if (force) this._set.add(name);
                    else this._set.delete(name);
                }
            },
            append(...nodes) { this.children.push(...nodes); },
            appendChild(node) { this.children.push(node); return node; },
            replaceChildren(...nodes) { this.children = [...nodes]; },
            addEventListener(type, fn) { this.listeners[type] = fn; },
            removeEventListener(type) { delete this.listeners[type]; }
        };
    }

    const fakeDoc = {
        head: createFakeEl('head'),
        getElementById: () => null,
        createElement: (tag) => createFakeEl(tag)
    };

    let resolvePending;
    const provider = mod.createUsageMonitorSideProvider({
        document: fakeDoc,
        api: {
            loadUsageMonitorSnapshot: () => new Promise(resolve => {
                resolvePending = resolve;
            })
        }
    });

    const viewEl = createFakeEl('div');
    const mounted = await provider.mountTab({ id: 'usage-monitor:main' }, viewEl, {});
    await mounted.dispose();

    // Resolving after dispose must not mutate or populate rendered cards
    resolvePending({
        success: true,
        data: {
            schemaVersion: 1,
            generatedAt: '2026-10-22T09:00:00.000Z',
            period: { key: 'today', start: '', end: '', timeZone: 'Asia/Shanghai' },
            accounts: [
                {
                    id: 'xss',
                    provider: 'codex',
                    label: '<img src=x onerror=alert(1)>',
                    status: 'ok',
                    windows: [],
                    balances: [],
                    notice: 'ok'
                }
            ],
            activity: { totals: { requests: 1 } }
        }
    });
    await new Promise(r => setTimeout(r, 10));
    const bodyEl = viewEl.children[0].children[1];
    assert.equal(bodyEl.children.length, 1);
    assert.match(bodyEl.children[0].textContent, /正在读取/);
});