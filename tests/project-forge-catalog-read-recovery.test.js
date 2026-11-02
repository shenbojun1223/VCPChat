'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { CatalogBrowser } = require('../VCPDistributedServer/Plugin/ProjectForge/catalogBrowser');
const { CatalogHost } = require('../VCPDistributedServer/Plugin/ProjectForge/catalogHost');
const { CatalogSnapshot } = require('../VCPDistributedServer/Plugin/ProjectForge/catalogSnapshot');
function fixture() {
    const time = '2026-10-31T00:00:00.000Z', sourceId = 'fixture';
    const snap = new CatalogSnapshot([{ identity: { sourceId, localProjectId: 'p1' },
        project: { id: 'p1', name: 'Fixture', availability: 'ready', status: 'active',
            created_at: time, updated_at: time, deleted_at: null },
        todos: [{ project_id: 'p1', seq: 1, title: 'one', status: 'pending',
            note: null, updated_by: null, updated_at: time }] }]);
    const client = {
        hubId: 'hub-11111111-2222-4333-8444-555555555555',
        async listCatalogSources() { return { items: [{ sourceId, version: 1, digest: 'a'.repeat(64) }], next: null }; },
        async getCatalogSource(id, options) {
            return { sourceId, version: 1, digest: 'a'.repeat(64), page: options.key
                ? snap.todos(options.key, options) : snap.list(options) };
        },
        async listCatalogProjects() { return { items: [], next: null }; },
    };
    return { client, browser: new CatalogBrowser(client) };
}
test('snapshot conflict retries the entire readonly index once with a fresh pin', async () => {
    const { client, browser } = fixture();
    let calls = 0;
    const original = client.getCatalogSource;
    client.getCatalogSource = async (...args) => {
        if (++calls === 1) throw Object.assign(Error('replaced snapshot'), { code: 'REQUEST_CONFLICT' });
        return original(...args);
    };
    assert.equal((await browser.refresh()).length, 1);
    assert.equal(calls, 2);
    browser.close();
});
test('persistent snapshot conflict stops after two attempts; no partial list is committed', async () => {
    const { client, browser } = fixture();
    const initial = await browser.refresh();
    let calls = 0;
    client.getCatalogSource = async () => {
        calls++; throw Object.assign(Error('changed again'), { code: 'REQUEST_CONFLICT' });
    };
    await assert.rejects(browser.refresh(), { code: 'REQUEST_CONFLICT' });
    assert.equal(calls, 2);
    assert.deepEqual([...browser.entries.values()], initial);
    browser.close();
});
test('host keeps last good snapshot on bounded conflicts without exposing private error text', async () => {
    const { client } = fixture();
    const host = new CatalogHost({ config: { read: true, publish: null, client } });
    try {
        const first = await host.listRemote();
        client.getCatalogSource = async () => { throw Object.assign(Error('SECRET_TOKEN_RAW_PATH'), { code: 'REQUEST_CONFLICT' }); };
        const result = await host.listRemote();
        assert.equal(result.status.phase, 'offline');
        assert.equal(result.status.error, 'REQUEST_CONFLICT');
        assert.equal(result.status.cached, true);
        assert.equal(result.projects.length, first.projects.length);
        assert.ok(result.projects.every(p => p.catalog.stale));
        assert.ok(!JSON.stringify(result).includes('SECRET'));
    } finally { await host.stop(); }
});
test('authentication denial is never retried or served from stale cache', async () => {
    const { client } = fixture();
    const host = new CatalogHost({ config: { read: true, publish: null, client } });
    try {
        await host.listRemote();
        let calls = 0;
        client.listCatalogSources = async () => { calls++; throw Object.assign(Error('private auth data'), { code: 'UNAUTHENTICATED' }); };
        await assert.rejects(host.listRemote(), { code: 'UNAUTHENTICATED' });
        assert.equal(calls, 1);
        assert.equal(host.browser.entries.size, 0);
        assert.equal(host.details.size, 0);
    } finally { await host.stop(); }
});
test('unknown errors are sanitized and still clear all cache', async () => {
    const { client } = fixture();
    const host = new CatalogHost({ config: { read: true, publish: null, client } });
    try {
        await host.listRemote();
        client.listCatalogSources = async () => { throw Error('private secret'); };
        await assert.rejects(host.listRemote(), { code: 'CATALOG_READ_FAILED' });
        assert.equal(host.browser.entries.size, 0);
    } finally { await host.stop(); }
});