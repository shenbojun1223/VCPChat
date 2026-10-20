'use strict';
const { check, identifier, fields } = require('./hubNetworkProtocol');
const { catalogIdentity } = require('./catalogProjection');
const { canonicalRecords } = require('./catalogInventory');
const Writer = require('./projectWriteGate');

// Trusted host capability only. authorize(project) must synchronously return
// true for EVERY ordinary project in this source. A denied/unavailable row
// aborts the complete inventory; it is never silently omitted as a deletion.
// Does not construct a ProjectStore, migrate schemas, open mappings or touch files.
function collectCatalog(store, { sourceId, authorize } = {}) {
    identifier(sourceId);
    check(typeof authorize === 'function');
    const db = store?.db;
    check(db?.open && !db.inTransaction, 'INVALID_ARGUMENT');
    return db.transaction(() => {
        check(!db.prepare("SELECT 1 FROM meta WHERE key GLOB 'project_update:*' LIMIT 1").get(),
            'BUSY');
        check(!db.prepare("SELECT 1 FROM projects WHERE availability!='ready' LIMIT 1").get(),
            'BUSY');
        const projects = db.prepare('SELECT * FROM projects ORDER BY id LIMIT 8193').all();
        check(projects.length <= 8192, 'LIMIT_EXCEEDED');
        const hasReceipts = Boolean(db.prepare(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='project_import_receipts'"
        ).get());
        const records = [], delegated = [];
        let totalTodos = 0;
        for (const project of projects) {
            const binding = Writer.binding(store, project.id);
            if (binding) {
                fields(binding, ['localProjectId', 'hubId', 'globalProjectId', 'mappingId', 'root']);
                check(binding.localProjectId === project.id && binding.root === require('node:path').resolve(project.root),
                    'CONTENT_BINDING');
                check(typeof binding.hubId === 'string' && /^hub-[0-9a-f-]{36}$/.test(binding.hubId),
                    'CONTENT_BINDING');
                identifier(binding.mappingId);
                // A null global ID means registration has not finished.
                check(binding.globalProjectId !== null, 'BUSY');
                catalogIdentity({ sourceId, localProjectId: project.id,
                    globalProjectId: binding.globalProjectId });
                delegated.push({ localProjectId: project.id, hubId: binding.hubId,
                    globalProjectId: binding.globalProjectId });
                continue;
            }
            // An imported replica without a writer binding must not be
            // accidentally published under a fresh ordinary identity.
            if (hasReceipts) {
                check(!db.prepare('SELECT 1 FROM project_import_receipts WHERE project_id=? LIMIT 1')
                    .get(project.id), 'CONTENT_BINDING');
            }
            check(authorize({ ...project }) === true, 'FORBIDDEN');
            const count = db.prepare('SELECT count(*) AS n FROM todos WHERE project_id=?')
                .get(project.id).n;
            totalTodos += count;
            check(totalTodos <= 50000, 'LIMIT_EXCEEDED');
            const todos = db.prepare(`SELECT project_id,seq,title,status,note,updated_by,updated_at
                FROM todos WHERE project_id=? ORDER BY seq,id`).all(project.id);
            records.push({
                identity: { sourceId, localProjectId: project.id },
                project, todos,
            });
        }
        const normalized = canonicalRecords(sourceId, records);
        return { sourceId, records: JSON.parse(normalized.payload), digest: normalized.digest, delegated };
    }).deferred();
}
module.exports = { collectCatalog };