'use strict';
const crypto = require('node:crypto');
const { check } = require('./hubNetworkProtocol');
const clone = value => JSON.parse(JSON.stringify(value));
const MAX_ITEMS = 8192;
const MAX_BYTES = 16 * 1024 * 1024;
const remoteId = (hubId, key) => 'remote:' +
    crypto.createHash('sha256').update(JSON.stringify([hubId, key])).digest('hex');

// Read-only transport adapter. No lease acquisition, worktree import or DB.
// Results commit only after every page succeeds. Cache policy belongs to host.
class CatalogBrowser {
    constructor(client) {
        check(client && typeof client.hubId === 'string');
        this.client = client;
        this.entries = new Map();
        this.generation = {};
        this.busy = null;
        this.closed = false;
    }

    _assertGeneration(generation) {
        check(!this.closed, 'CLOSED');
        check(this.generation === generation, 'REQUEST_CONFLICT');
    }

    _budget(generation) {
        const deadline = Date.now() + 60000;
        let requests = 0, bytes = 0;
        return async operation => {
            this._assertGeneration(generation);
            check(Date.now() < deadline && ++requests <= 1024, 'LIMIT_EXCEEDED');
            const value = await operation();
            this._assertGeneration(generation);
            check(Date.now() < deadline, 'REQUEST_TIMEOUT');
            bytes += Buffer.byteLength(JSON.stringify(value), 'utf8');
            check(bytes <= MAX_BYTES, 'LIMIT_EXCEEDED');
            return value;
        };
    }

    refresh() {
        if (this.busy) return this.busy;
        this.busy = this._refresh().finally(() => { this.busy = null; });
        return this.busy;
    }

    async _refresh() {
        const generation = this.generation;
        const request = this._budget(generation), next = new Map();
        const add = (key, value) => {
            const id = remoteId(this.client.hubId, key);
            check(!next.has(id), 'CONTENT_BINDING');
            check(next.size < MAX_ITEMS, 'LIMIT_EXCEEDED');
            next.set(id, { ...value, id });
        };
        let after = '';
        const seenSources = new Set();
        do {
            const page = await request(() => this.client.listCatalogSources({ after }));
            for (const source of page.items) {
                check(!seenSources.has(source.sourceId), 'CONTENT_BINDING');
                seenSources.add(source.sourceId);
                check(seenSources.size <= 128, 'LIMIT_EXCEEDED');
                let cursor = null, snapshot = null, total = null, count = 0, lastKey = '';
                do {
                    const result = await request(() => this.client.getCatalogSource(source.sourceId, {
                        version: source.version, digest: source.digest, cursor, limit: 200,
                    }));
                    if (snapshot === null) { snapshot = result.page.snapshot; total = result.page.total; }
                    check(result.page.snapshot === snapshot && result.page.total === total, 'REQUEST_CONFLICT');
                    for (const summary of result.page.items) {
                        check(summary.key > lastKey, 'INVALID_RESPONSE');
                        lastKey = summary.key; count++;
                        add(summary.key, { kind: 'source', summary,
                            pin: { sourceId: source.sourceId, version: source.version, digest: source.digest },
                            observedAt: Date.now() });
                    }
                    cursor = result.page.next;
                } while (cursor !== null);
                check(count === total, 'INVALID_RESPONSE');
            }
            if (page.next !== null) check(page.next > after, 'INVALID_RESPONSE');
            after = page.next;
        } while (after !== null);
        after = '';
        do {
            const page = await request(() => this.client.listCatalogProjects({ after }));
            for (const project of page.items) {
                const key = JSON.stringify(['global', project.id]);
                add(key, { kind: 'global', global: project, key, observedAt: Date.now() });
            }
            if (page.next !== null) check(page.next > after, 'INVALID_RESPONSE');
            after = page.next;
        } while (after !== null);
        this._assertGeneration(generation);
        this.entries = next;
        // Invalidate details started against the previous index even when
        // content and observedAt happen to be identical.
        this.generation = {};
        return clone([...next.values()]);
    }

    async detail(id) {
        check(typeof id === 'string' && this.entries.has(id), 'NOT_FOUND');
        const generation = this.generation;
        const entry = clone(this.entries.get(id));
        const request = this._budget(generation);
        let cursor = null, summary = entry.summary || null, snapshot = null, total = null;
        let publication = null, previous = 0;
        const todos = [];
        do {
            const result = entry.kind === 'source'
                ? await request(() => this.client.getCatalogSource(entry.pin.sourceId, {
                    version: entry.pin.version, digest: entry.pin.digest,
                    key: entry.summary.key, cursor, limit: 200,
                }))
                : await request(() => this.client.getCatalogPlan(entry.global.id, { cursor, limit: 200 }));
            const page = entry.kind === 'source' ? result.page : result.todos;
            if (entry.kind === 'global') {
                check(result.publication.revision === entry.global.revision &&
                    result.publication.bundleHash === entry.global.bundleHash, 'REQUEST_CONFLICT');
                if (summary !== null) check(JSON.stringify(summary) === JSON.stringify(result.summary), 'REQUEST_CONFLICT');
                summary = result.summary;
                publication = result.publication;
            }
            if (snapshot === null) { snapshot = page.snapshot; total = page.total; }
            check(page.snapshot === snapshot && page.total === total, 'REQUEST_CONFLICT');
            for (const todo of page.items) {
                check(todo.seq > previous && todos.length < 50000, 'INVALID_RESPONSE');
                previous = todo.seq; todos.push(todo);
            }
            cursor = page.next;
        } while (cursor !== null);
        check(summary && todos.length === total && total === summary.progress.total, 'INVALID_RESPONSE');
        for (const state of ['pending', 'doing', 'done', 'blocked']) {
            check(todos.filter(t => t.status === state).length === summary.progress[state], 'INVALID_RESPONSE');
        }
        // A concurrent refresh may revoke or replace this entry while loading.
        this._assertGeneration(generation);
        check(JSON.stringify(this.entries.get(id)) === JSON.stringify(entry), 'REQUEST_CONFLICT');
        return clone({ id, summary, todos, publication, observedAt: Date.now() });
    }

    clear() { this.generation = {}; this.entries.clear(); }
    close() { this.closed = true; this.clear(); }
}
module.exports = { CatalogBrowser };