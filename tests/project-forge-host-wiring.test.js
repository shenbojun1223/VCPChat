'use strict';
// Synthetic config files; VM executes the actual bridge/quit function without loading Electron main.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const vm = require('node:vm'), { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..'), plugin = path.join(root, 'VCPDistributedServer/Plugin/ProjectForge');
const { loadAutoResumeConfig } = require(path.join(plugin, 'autoResumeConfig'));
const invalid = error => error.code === 'AUTO_CONFIG_INVALID' && error.message === 'AUTO_CONFIG_INVALID' && !error.cause;
function configFixture(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-host-config-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const filename = path.join(dir, 'auto.json'), tokenFile = path.join(dir, 'token');
    const secret = crypto.randomBytes(32).toString('base64url');
    fs.writeFileSync(tokenFile, secret);
    const value = { version: 1, endpoint: 'https://127.0.0.1', hubId: 'hub-' + crypto.randomUUID(),
        deviceId: 'fixture-device', tokenFile, journalPath: path.join(dir, 'journal.db'),
        mappingPath: path.join(dir, 'mapping.db'), localProjectId: 'p-fixture', pathPrefix: '/forge-sync' };
    const write = v => fs.writeFileSync(filename, JSON.stringify(v));
    write(value); return { dir, filename, value, tokenFile, secret, write };
}
test('absent explicit config is disabled without reading any file', () => {
    const original = fs.lstatSync;
    fs.lstatSync = () => { throw Error('Unexpected filesystem access'); };
    try { for (const value of [undefined, null, '']) assert.equal(loadAutoResumeConfig(value), null); }
    finally { fs.lstatSync = original; }
});
test('valid config constructs private-token client without opening DBs or contacting Hub', t => {
    const f = configFixture(t), result = loadAutoResumeConfig(f.filename);
    assert.equal(result.localProjectId, 'p-fixture');
    assert.equal(result.client.deviceId, 'fixture-device');
    assert.equal(result.journalPath, f.value.journalPath);
    assert.equal(fs.existsSync(f.value.journalPath), false);
    assert.equal(fs.existsSync(f.value.mappingPath), false);
    assert.equal(JSON.stringify(result).includes(f.secret), false);
    assert.equal(Object.hasOwn(result, 'token'), false);
});
test('receiver config accepts only explicit global identity and target', t => {
    const f = configFixture(t), value = { ...f.value };
    delete value.localProjectId; value.globalProjectId = 'g_' + crypto.randomUUID();
    value.target = { root: path.join(f.dir, 'workspace', 'new'), workspaceAlias: 'fixture', subpath: 'new' };
    f.write(value);
    assert.equal(loadAutoResumeConfig(f.filename).globalProjectId, value.globalProjectId);
    assert.equal(fs.existsSync(value.target.root), false);
});
test('strict fields, identity exclusivity, absolute paths and timing reject before activation', t => {
    const f = configFixture(t);
    const variants = [
        { ...f.value, version: 2 }, { ...f.value, token: f.secret },
        { ...f.value, globalProjectId: null }, { ...f.value, localProjectId: null },
        { ...f.value, localProjectId: 123 }, { ...f.value, target: {} },
        { ...f.value, tokenFile: 'relative-token' }, { ...f.value, journalPath: 'relative.db' },
        { ...f.value, mappingPath: f.value.journalPath }, { ...f.value, ttlMs: 999 },
        { ...f.value, pollMs: 60000 }, { ...f.value, safetyMs: -1 },
        { ...f.value, drainMs: 0 }, { ...f.value, pathPrefix: '/a/../b' },
    ];
    for (const value of variants) { f.write(value); assert.throws(() => loadAutoResumeConfig(f.filename), invalid); }
});
test('missing, directory, oversized and invalid UTF8 config/token files return static safe error', t => {
    const f = configFixture(t);
    assert.throws(() => loadAutoResumeConfig(path.join(f.dir, 'private-missing.json')), invalid);
    assert.throws(() => loadAutoResumeConfig(f.dir), invalid);
    fs.writeFileSync(f.filename, Buffer.from([0xff, 0xfe]));
    assert.throws(() => loadAutoResumeConfig(f.filename), invalid);
    fs.writeFileSync(f.filename, ' '.repeat(65537));
    assert.throws(() => loadAutoResumeConfig(f.filename), invalid);
    f.write(f.value); fs.writeFileSync(f.tokenFile, 'x'.repeat(4097));
    assert.throws(() => loadAutoResumeConfig(f.filename), invalid);
    fs.writeFileSync(f.tokenFile, f.secret); f.write({ ...f.value, caFile: f.dir });
    assert.throws(() => loadAutoResumeConfig(f.filename), invalid);
});
test('invalid JSON never reflects token text or private filename in public error', t => {
    const f = configFixture(t); fs.writeFileSync(f.filename, '{"token":"' + f.secret);
    assert.throws(() => loadAutoResumeConfig(f.filename), error => invalid(error) &&
        !error.message.includes(f.secret) && !error.message.includes(f.dir));
});
function bridgeFixture(config) {
    const file = path.join(root, 'modules/ipc/projectForgeHandlers.js'), actualRequire = createRequire(file);
    const events = [], handlers = new Map(), ready = Promise.resolve({ writable: true });
    const forge = { ensureRuntime: () => events.push('ensure'), whenAutoResumeReady: () => ready,
        whenConfiguredReady: () => { events.push('configured-ready'); return ready; },
        cleanup: async () => events.push('cleanup'), gui: { listProjects: () => [] } };
    const module = { exports: {} };
    const context = {
        module, exports: module.exports, __dirname: path.dirname(file),
        console: { warn: message => events.push(message) },
        require(name) {
            if (name === 'electron') return { ipcMain: {
                removeHandler: key => handlers.delete(key), handle: (key, fn) => handlers.set(key, fn),
            } };
            if (name === 'fs') return { readFileSync() {
                if (config instanceof Error) throw config;
                return Buffer.from(config);
            } };
            if (name.endsWith('ProjectForgeService.js')) { events.push('require-forge'); return forge; }
            return actualRequire(name);
        },
    };
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
    module.exports.initialize(); return { bridge: module.exports, events, handlers, ready };
}
test('GUI-only host remains lazy when file missing or auto config not enabled', async () => {
    for (const config of [Object.assign(Error('missing private path'), { code: 'ENOENT' }), 'WORKSPACES=demo|fixture']) {
        const f = bridgeFixture(config);
        assert.equal(f.bridge.startConfigured(), null);
        await f.bridge.shutdown();
        assert.deepEqual(f.events, []);
    }
});
test('GUI-only enabled bridge starts same Forge module and shutdown invokes cleanup', async () => {
    const f = bridgeFixture('AUTORESUME_CONFIG_PATH=C:\\fixture\\auto.json');
    assert.equal(f.bridge.startConfigured(), f.ready);
    await f.ready; await f.bridge.shutdown();
    assert.deepEqual(f.events, ['require-forge', 'ensure', 'cleanup']);
});
test('bridge config access failure rejects instead of silently disabling and IPC reports static error', async () => {
    const f = bridgeFixture(Object.assign(Error('private path and secret'), { code: 'EACCES' }));
    assert.throws(() => f.bridge.startConfigured(), /FORGE_CONFIG_READ_FAILED/);
    const result = await f.handlers.get('project-forge:list-projects')({});
    assert.equal(result.success, false); assert.equal(result.error, 'FORGE_CONFIG_READ_FAILED');
    assert.ok(!f.events.some(value => value.includes('private path')));
});
function quitFixture({ distributed = true, distributedError = null, forgeError = null } = {}) {
    const file = path.join(root, 'main.js'), source = fs.readFileSync(file, 'utf8');
    const start = source.indexOf('async function performQuitCleanup() {');
    const end = source.indexOf('// --- Main Window Creation ---', start);
    assert.ok(start >= 0 && end > start);
    const events = [], action = name => async () => { events.push(name); };
    const context = {
        appQuitCleanupPromise: null, console: { log() {}, warn() {} },
        historyWatcherLeases: { dispose: action('history-watchers') },
        localSttHandlers: { shutdown() { events.push('stt'); } },
        voiceHandlers: { shutdownVoiceInputEngine: action('voice') },
        distributedServer: distributed ? { stop: async () => {
            events.push('distributed'); if (distributedError) throw distributedError;
        } } : null,
        projectForgeHandlers: { shutdown: async () => { events.push('forge'); if (forgeError) throw forgeError; } },
        desktopSyncService: { stop() { events.push('desktop'); } }, desktopSyncRendererBridge: {},
        chatDataService: { stop: action('chat-data') }, loomManager: { shutdown: action('loom') },
        workspaceHandlers: { dispose() { events.push('workspace'); } },
        historyMutationQueue: { dispose: action('history-queue') }, pluginAgentOperationService: {},
        chartService: {}, chartHandlers: { shutdown: action('charts') }, stopAudioEngine: action('audio'),
    };
    vm.createContext(context); vm.runInContext(source.slice(start, end), context, { filename: file });
    return { context, events };
}
for (const distributed of [false, true]) {
    test('actual quit function cleans GUI Forge and remaining resources once; distributed=' + distributed, async () => {
        const f = quitFixture({ distributed });
        await Promise.all([f.context.performQuitCleanup(), f.context.performQuitCleanup()]);
        assert.equal(f.events.filter(v => v === 'forge').length, 1);
        assert.equal(f.events.at(-1), 'audio');
        assert.ok(f.events.indexOf('forge') < f.events.indexOf('desktop'));
        assert.equal(f.context.chatDataService, null);
    });
}
test('actual quit function defers Forge handoff failure until other cleanup finishes; no false success', async () => {
    const failure = Error('handoff failed'), f = quitFixture({ forgeError: failure });
    await assert.rejects(f.context.performQuitCleanup(), error => error === failure);
    assert.equal(f.events.at(-1), 'audio');
    assert.equal(f.context.chatDataService, null); assert.equal(f.context.loomManager, null);
    await assert.rejects(f.context.performQuitCleanup(), error => error === failure);
    assert.equal(f.events.filter(v => v === 'forge').length, 1);
});
test('actual quit function still cleans Forge and other resources when distributed stop rejects', async () => {
    const failure = Error('distributed failed'), f = quitFixture({ distributedError: failure, forgeError: Error('also failed') });
    await assert.rejects(f.context.performQuitCleanup(), error => error === failure);
    assert.ok(f.events.includes('forge')); assert.equal(f.events.at(-1), 'audio');
    assert.equal(f.context.distributedServer, null);
});
test('main startup and both plugin manifest contracts declare explicit opt-in host wiring', () => {
    const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
    assert.match(main, /projectForgeHandlers\.initialize[\s\S]*?projectForgeHandlers\.startConfigured\(\)/);
    assert.match(main, /await projectForgeHandlers\.shutdown\(\)/);
    const manifest = JSON.parse(fs.readFileSync(path.join(plugin, 'plugin-manifest.json'), 'utf8'));
    assert.equal(manifest.configSchema.AUTORESUME_CONFIG_PATH.default, '');
    assert.ok(!manifest.capabilities.invocationCommands.some(c => /auto.*config|set.*token/i.test(c.command)));
});
test('remote catalog IDs cannot enter local history, node, revert or delete IPC', async () => {
    const f = bridgeFixture('WORKSPACES=demo|fixture');
    const id = 'remote:' + 'a'.repeat(64);
    for (const [channel, args] of [
        ['project-forge:search-history', [{ projectId: id }]],
        ['project-forge:get-batch', [id, 1]],
        ['project-forge:get-node', [id, 1]],
        ['project-forge:revert-file', [{ projectId: id, nodeId: 1, signature: 'Kerr' }]],
        ['project-forge:delete-project', [id, 'Kerr']],
    ]) {
        const result = await f.handlers.get(channel)({}, ...args);
        assert.equal(result.success, false);
        assert.equal(result.error, 'REMOTE_PROJECT_READ_ONLY');
    }
    assert.deepEqual(f.events, []);
});
test('GUI-only catalog and combined configurations use configured readiness', async () => {
    for (const config of [
        'CATALOG_CONFIG_PATH=C:\\fixture\\catalog.json',
        'CATALOG_CONFIG_PATH=C:\\fixture\\catalog.json\nAUTORESUME_CONFIG_PATH=C:\\fixture\\auto.json',
    ]) {
        const f = bridgeFixture(config);
        assert.equal(f.bridge.startConfigured(), f.ready);
        await f.ready;
        await f.bridge.shutdown();
        assert.deepEqual(f.events, ['require-forge', 'ensure', 'configured-ready', 'cleanup']);
    }
});