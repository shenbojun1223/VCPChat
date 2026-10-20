'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { remoteSummary, remoteDetail, mergeCatalog } =
    require('../VCPDistributedServer/Plugin/ProjectForge/catalogView');
const time = '2026-10-21T00:00:00.000Z';
function entry(sourceId = 'server') {
    return {
        id: 'remote:' + sourceId, kind: 'source', pin: { version: 3 },
        observedAt: 1000,
        summary: { sourceId, localProjectId: 'p1', globalProjectId: null,
            name: '同名计划', status: 'accepted', createdAt: time, updatedAt: time,
            deletedAt: null, progress: { total: 1, done: 1, pending: 0, doing: 0, blocked: 0 } },
    };
}
const local = () => ({ id: 'p1', name: '同名计划', status: 'active', deleted_at: null });
test('remote view has no root, write capability or fabricated history stats', () => {
    const row = remoteSummary(entry(), { stale: true, error: 'NETWORK_ERROR' });
    assert.equal(row.root, null);
    assert.equal(row.rootInfo.writable, false);
    assert.equal(row.stats, null);
    assert.equal(row.catalog.historyAvailable, false);
    assert.equal(row.catalog.stale, true);
    assert.equal(row.catalog.observedAt, 1000);
    assert.equal(row.progress.text, '1/1');
    assert.notEqual(row.id, row.catalog.localProjectId);
});
test('same name and short local ID from another source remain separate', () => {
    const rows = mergeCatalog([local()], [remoteSummary(entry())], {
        hubId: 'hub-A', localSourceId: 'home',
    });
    assert.equal(rows.length, 2);
});
test('own ordinary source deduplicates against local but never another source', () => {
    const rows = mergeCatalog([local()], [remoteSummary(entry('home')), remoteSummary(entry())], {
        hubId: 'hub-A', localSourceId: 'home',
    });
    assert.deepEqual(rows.map(r => r.id), ['p1', 'remote:server']);
});
test('global binding suppresses only its local replica on the matching Hub', () => {
    const e = { id: 'remote:global', kind: 'global', observedAt: 1000,
        global: { id: 'global-A', localProjectId: 'origin-id', originId: 'source',
            name: '全局计划', revision: 4, createdAt: 0, updatedAt: 1000 } };
    const row = remoteSummary(e);
    assert.equal(row.progress, null);
    assert.equal(row.status, 'unknown');
    const mappings = [{ localProjectId: 'p1', globalProjectId: 'global-A', hubId: 'hub-A' }];
    assert.equal(mergeCatalog([local()], [row], { mappings, hubId: 'hub-B' }).length, 2);
    assert.deepEqual(mergeCatalog([local()], [row], { mappings, hubId: 'hub-A' }).map(r => r.id),
        ['remote:global']);
});
test('detail contains only readonly plan data and explicit truncation flags', () => {
    const e = entry();
    const view = remoteDetail(e, { id: e.id, summary: e.summary, observedAt: 2000,
        todos: [{ seq: 1, title: '任务', status: 'done', note: '预览',
            updatedBy: 'Kerr', updatedAt: time, truncated: ['note'] }] });
    assert.deepEqual(view.todos[0].truncated, ['note']);
    assert.deepEqual(view.files, []);
    assert.deepEqual(view.timeline, []);
    assert.equal(view.project.report, null);
    assert.equal(view.project.catalog.observedAt, 2000);
});