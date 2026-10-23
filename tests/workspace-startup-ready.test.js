'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function deferred() {
    let resolve, reject;
    const promise = new Promise((a, b) => { resolve = a; reject = b; });
    return { promise, resolve, reject };
}
function fixture() {
    const file = path.resolve(__dirname, '../modules/ipc/workspaceHandlers.js');
    const actualRequire = createRequire(file);
    const module = { exports: {} };
    class Index {
        constructor() { this.rows = []; }
        configure(rows) { this.rows = rows; }
        list() { return this.rows; }
        dispose() { this.rows = []; }
    }
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
        module, exports: module.exports,
        require(name) {
            if (name === 'electron') return {
                ipcMain: { removeHandler() {}, handle() {} }, dialog: {}, BrowserWindow: {}
            };
            if (name === '../fileManager') return { setWorkspaceReferenceResolver() {} };
            if (name === '../services/workspaceIndex') return {
                WorkspaceIndex: Index, normalizeWorkspaceList: rows => rows || [],
                sanitizeAlias: value => value
            };
            return actualRequire(name);
        },
    }, { filename: file });
    const api = module.exports;
    function initialize(read) {
        return api.initialize({
            settingsManager: { readSettings: () => read.promise, on() {}, off() {} },
            logger: { warn() {} },
        });
    }
    return { api, initialize };
}
test('workspace initialization waits for settings, not background indexing', async () => {
    const f = fixture(), read = deferred();
    const ready = f.initialize(read);
    assert.equal(typeof ready?.then, 'function', 'initialize must expose settings readiness');
    let started = false;
    const dependent = ready.then(() => {
        assert.equal(f.api.workspaceService.list()[0].alias, 'company');
        started = true;
    });
    await Promise.resolve();
    assert.equal(started, false);
    read.resolve({ workspaces: [{ id: 'company', alias: 'company', path: 'fixture', enabled: true }] });
    await dependent;
    assert.equal(started, true);
    f.api.dispose();
});
test('settings read failure rejects readiness instead of starting with empty authorization', async () => {
    const f = fixture(), read = deferred();
    const ready = f.initialize(read);
    assert.equal(typeof ready?.then, 'function');
    const rejected = assert.rejects(ready);
    read.reject(Error('synthetic read failure'));
    await rejected;
    assert.equal(f.api.workspaceService.list().length, 0);
    f.api.dispose();
});
test('superseded settings read cannot overwrite a newer workspace instance', async () => {
    const f = fixture(), old = deferred(), next = deferred();
    const oldReady = f.initialize(old);
    assert.equal(typeof oldReady?.then, 'function');
    const rejected = assert.rejects(oldReady);
    const nextReady = f.initialize(next);
    next.resolve({ workspaces: [{ id: 'new', alias: 'new', path: 'fixture', enabled: true }] });
    await nextReady;
    old.resolve({ workspaces: [{ id: 'old', alias: 'old', path: 'fixture', enabled: true }] });
    await rejected;
    assert.equal(f.api.workspaceService.list()[0].id, 'new');
    f.api.dispose();
});
test('dispose invalidates an unfinished settings read', async () => {
    const f = fixture(), read = deferred();
    const ready = f.initialize(read);
    assert.equal(typeof ready?.then, 'function');
    const rejected = assert.rejects(ready);
    f.api.dispose();
    read.resolve({ workspaces: [] });
    await rejected;
    assert.equal(f.api.workspaceService.list().length, 0);
});