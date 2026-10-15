'use strict';
// Host adapters only. Every writable target and database is a synthetic temporary fixture.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const forge = require('../VCPDistributedServer/Plugin/ProjectForge/ProjectForgeService');
const { WorkspaceResolver } = require('../VCPDistributedServer/Plugin/ProjectForge/workspace');
const pluginRoot = path.resolve(__dirname, '../VCPDistributedServer/Plugin/ProjectForge');
const envKeys = ['PROJECTFORGE_WORKSPACES', 'PROJECTFORGE_ACTIVE_WORKSPACE', 'PROJECTFORGE_ALLOWED_DIRECTORIES'];
const oldEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
test.before(() => { for (const key of envKeys) delete process.env[key]; });
test.after(async () => {
    await forge.cleanup();
    for (const key of envKeys) {
        if (oldEnv[key] === undefined) delete process.env[key];
        else process.env[key] = oldEnv[key];
    }
});
async function fixture(t) {
    await forge.cleanup();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-host-'));
    t.after(async () => {
        await forge.cleanup();
        fs.rmSync(root, { recursive: true, force: true });
    });
    const ws = path.join(root, 'workspace');
    fs.mkdirSync(ws);
    const db = path.join(root, 'fixture.db');
    const logger = { log() {}, warn() {}, error() {} };
    return { root, ws, db, logger };
}
test('static text workspace resolves active alias and refuses sibling escape', async t => {
    const f = await fixture(t);
    const resolver = new WorkspaceResolver({
        staticWorkspaces: `demo|${f.ws}`, activeWorkspace: 'DEMO',
    });
    assert.equal(resolver.active().path, f.ws);
    assert.equal(resolver.resolveNewProjectRoot(null, 'child').root, path.join(f.ws, 'child'));
    assert.throws(() => resolver.resolveNewProjectRoot('demo', '../escape'), /越出/);
    assert.equal(resolver.isWritable(path.join(f.root, 'workspace-sibling')), false);
});
test('static JSON preserves disabled workspace as read-only', async t => {
    const f = await fixture(t);
    const resolver = new WorkspaceResolver({ staticWorkspaces: JSON.stringify([
        { id: 'disabled-id', alias: 'disabled', path: f.ws, enabled: false },
    ]) });
    assert.equal(resolver.enabled().length, 0);
    assert.equal(resolver.find('disabled'), null);
    const info = resolver.projectRoot({ workspace_id: 'disabled-id', root: f.ws, subpath: '' });
    assert.equal(info.writable, false);
});
test('host workspace has priority over same static alias', async t => {
    const f = await fixture(t);
    const resolver = new WorkspaceResolver({
        workspaceService: { list: () => [{ id: 'host-id', alias: 'Demo', path: f.ws, enabled: true }] },
        staticWorkspaces: `demo|${path.join(f.root, 'shadow')};other|${path.join(f.root, 'other')}`,
    });
    assert.equal(resolver.list().length, 2);
    assert.equal(resolver.find('demo').id, 'host-id');
    assert.equal(resolver.find('demo').path, f.ws);
});
test('static config survives unavailable dynamic host service', async t => {
    const f = await fixture(t);
    const resolver = new WorkspaceResolver({
        workspaceService: { list() { throw new Error('host unavailable'); } },
        staticWorkspaces: `demo=${f.ws}`, activeWorkspace: 'demo',
    });
    assert.equal(resolver.enabled().length, 1);
    assert.equal(resolver.active().path, f.ws);
});
test('frontend wrapped initialize uses injected services and fixture database', async t => {
    const f = await fixture(t);
    forge.initialize({
        dbPath: f.db, config: { AST_INDEX_ENABLED: false }, logger: f.logger,
        services: { workspaceService: {
            list: () => [{ id: 'frontend', alias: 'front', path: f.ws, enabled: true }],
            getActiveWorkspaceId: () => 'frontend',
        } },
    });
    const result = await forge.processToolCall({ command: 'CreateProject', name: 'frontend', dir: 'child' });
    assert.equal(result.details.project.root, path.join(f.ws, 'child'));
    assert.equal(forge._test.getRuntime().dbPath, f.db);
});
test('backend flat initialize reads config rather than nonexistent options.config', async t => {
    const f = await fixture(t);
    forge.initialize({
        PROJECTFORGE_DB_PATH: f.db, WORKSPACES: `back|${f.ws}`, ACTIVE_WORKSPACE: 'back',
        AST_INDEX_ENABLED: false, MAX_EDIT_FILE_SIZE: 1024,
    }, { vcpLogFunctions: f.logger });
    const result = await forge.processToolCall({ command: 'CreateProject', name: 'backend', dir: 'child' });
    assert.equal(result.details.project.root, path.join(f.ws, 'child'));
    assert.equal(forge._test.getRuntime().dbPath, f.db);
    assert.equal(forge._test.getRuntime().maxEditSize, 1024);
});
test('backend dependency workspaceService is honored without static configuration', async t => {
    const f = await fixture(t);
    forge.initialize({ PROJECTFORGE_DB_PATH: f.db, AST_INDEX_ENABLED: false }, {
        vcpLogFunctions: f.logger,
        workspaceService: {
            list: () => [{ id: 'backend', alias: 'back', path: f.ws, enabled: true }],
            getActiveWorkspaceId: () => 'backend',
        },
    });
    const result = await forge.processToolCall({ command: 'CreateProject', name: 'dependencies' });
    assert.equal(result.details.project.root, f.ws);
});
test('environment fallback stays local and explicit wrapped config takes priority', async t => {
    const f = await fixture(t);
    process.env.PROJECTFORGE_WORKSPACES = `environment|${path.join(f.root, 'environment')}`;
    process.env.PROJECTFORGE_ACTIVE_WORKSPACE = 'environment';
    t.after(() => { for (const key of envKeys) delete process.env[key]; });
    forge.initialize({ dbPath: f.db, config: { AST_INDEX_ENABLED: false }, logger: f.logger });
    assert.equal(forge._test.getRuntime().resolver.active().alias, 'environment');
    forge.initialize({
        dbPath: f.db,
        config: { WORKSPACES: `explicit|${f.ws}`, ACTIVE_WORKSPACE: 'explicit', AST_INDEX_ENABLED: false },
        logger: f.logger,
    });
    assert.equal(forge._test.getRuntime().resolver.active().alias, 'explicit');
});
test('plugin declares static config but does not expose internal takeover commands', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'plugin-manifest.json'), 'utf8'));
    assert.ok(manifest.configSchema.WORKSPACES);
    assert.ok(manifest.configSchema.ACTIVE_WORKSPACE);
    const commands = manifest.capabilities.invocationCommands.map(item => item.command);
    assert.ok(!commands.some(command => /takeover|importbundle|exportbundle/i.test(command)));
});
test('relocated backend resolves plugin-local fileKit without frontend tree', async t => {
    const f = await fixture(t);
    const relocated = path.join(f.root, 'standalone', 'Plugin', 'ProjectForge');
    fs.mkdirSync(relocated, { recursive: true });
    for (const entry of fs.readdirSync(pluginRoot)) {
        if (entry.endsWith('.js')) fs.copyFileSync(path.join(pluginRoot, entry), path.join(relocated, entry));
    }
    fs.cpSync(path.resolve(pluginRoot, '../../shared/fileKit'), path.join(relocated, 'fileKit'), { recursive: true });
    const script = `
        const fs = require('node:fs');
        const forge = require(${JSON.stringify(path.join(relocated, 'ProjectForgeService.js'))});
        const engine = require(${JSON.stringify(path.join(relocated, 'engine.js'))});
        (async () => {
            try {
                forge.initialize({PROJECTFORGE_DB_PATH:${JSON.stringify(f.db)},
                    WORKSPACES:${JSON.stringify('local|' + f.ws)},ACTIVE_WORKSPACE:'local',AST_INDEX_ENABLED:false},
                    {vcpLogFunctions:{log(){},warn(){},error(){}}});
                const p = await forge.processToolCall({command:'CreateProject',name:'relocated',dir:'child'});
                if(p.details.project.root !== ${JSON.stringify(path.join(f.ws, 'child'))}) throw Error('Wrong standalone root');
                const edit = engine.runEditString('old\\n',[{step:1,op:'target',target:'old',replace:'new'}]);
                if(edit.text !== 'new\\n') throw Error('Local fileKit edit failed');
                console.log('STANDALONE_OK');
            } finally { await forge.cleanup(); }
        })().catch(e=>{console.error(e.stack);process.exitCode=1;});
    `;
    const child = spawnSync(process.execPath, ['-e', script], {
        encoding: 'utf8', timeout: 20000, windowsHide: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1',
            NODE_PATH: path.resolve(__dirname, '../node_modules') },
    });
    assert.equal(child.error, undefined, child.error?.message);
    assert.equal(child.status, 0, child.stdout + child.stderr);
    assert.match(child.stdout, /STANDALONE_OK/);
});