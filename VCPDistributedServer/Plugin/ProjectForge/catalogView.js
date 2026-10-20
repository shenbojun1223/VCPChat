'use strict';
const { check } = require('./hubNetworkProtocol');
const isRemoteId = id => typeof id === 'string' && id.startsWith('remote:');

function remoteSummary(entry, { stale = false, error = null } = {}) {
    check(entry && isRemoteId(entry.id), 'INVALID_ARGUMENT');
    const s = entry.summary;
    const g = entry.global;
    check(s || g, 'INVALID_ARGUMENT');
    const progress = s ? { ...s.progress, text: `${s.progress.done}/${s.progress.total}` } : null;
    return {
        id: entry.id,
        name: s ? s.name : g.name,
        status: s ? s.status : 'unknown',
        created_at: s ? s.createdAt : new Date(g.createdAt).toISOString(),
        updated_at: s ? s.updatedAt : new Date(g.updatedAt).toISOString(),
        deleted_at: s ? s.deletedAt : null,
        created_by: null,
        workspace_alias: s ? s.sourceId : g.originId,
        root: null,
        rootInfo: { root: null, writable: false, workspaceAlias: s ? s.sourceId : g.originId,
            blockedReason: '远端计划只读；未导入源码或取得施工写权' },
        progress, stats: null, maids: [], hasReport: false,
        catalog: {
            remote: true, kind: entry.kind,
            sourceId: s ? s.sourceId : g.originId,
            localProjectId: s ? s.localProjectId : g.localProjectId,
            globalProjectId: s ? s.globalProjectId : g.id,
            version: entry.kind === 'source' ? entry.pin.version : g.revision,
            observedAt: entry.observedAt, stale, error,
            historyAvailable: false,
        },
    };
}

function remoteDetail(entry, detail, options) {
    check(detail.id === entry.id, 'CONTENT_BINDING');
    const project = remoteSummary({ ...entry, summary: detail.summary,
        observedAt: detail.observedAt }, options);
    return {
        project: { ...project, report: null },
        todos: detail.todos.map(t => ({
            seq: t.seq, title: t.title, status: t.status, note: t.note,
            updated_by: t.updatedBy, updated_at: t.updatedAt,
            truncated: [...t.truncated],
        })),
        contributors: [], files: [], timeline: [],
    };
}

// localSourceId is supplied only by this host's trusted publish configuration.
// mappings are from local writer bindings, never renderer arguments.
function mergeCatalog(local, remote, { hubId, localSourceId = null, mappings = [],
    includeDeleted = false, query = '' } = {}) {
    const localIds = new Set(local.map(p => p.id));
    const globals = new Map();
    for (const binding of mappings) {
        if (binding.hubId === hubId && binding.globalProjectId) {
            globals.set(binding.globalProjectId, binding.localProjectId);
        }
    }
    const hiddenLocal = new Set();
    const visibleRemote = remote.filter(row => {
        const c = row.catalog;
        if (c.kind === 'source' && c.sourceId === localSourceId && localIds.has(c.localProjectId)) return false;
        const localId = c.globalProjectId && globals.get(c.globalProjectId);
        if (localId && localIds.has(localId)) hiddenLocal.add(localId);
        return true;
    });
    const term = String(query || '').trim().toLowerCase();
    return [...local.filter(p => !hiddenLocal.has(p.id)), ...visibleRemote]
        .filter(p => (includeDeleted || !p.deleted_at) && (!term ||
            String(p.name).toLowerCase().includes(term) ||
            p.id.toLowerCase().includes(term) ||
            String(p.catalog?.localProjectId || '').toLowerCase().includes(term) ||
            String(p.catalog?.sourceId || '').toLowerCase().includes(term)));
}
module.exports = { isRemoteId, remoteSummary, remoteDetail, mergeCatalog };