'use strict';

// Single Electron-main writer. Atomic rename covers process crashes, not power loss.
// This private journal is not history, a sync object or a business acceptance record.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { hostId, scopeId } = require('./delegationIdentity.cjs');
const clone = value => JSON.parse(JSON.stringify(value));
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
const states = new Set(['pending', 'dispatching', 'uncertain', 'completed', 'failed', 'cancelled', 'conflict']);
const terminal = new Set(['Succeed', 'Failed', 'Cancelled', 'Stopped']);
const cap = 10000;

async function atomicSave(file, data, fsp = fs) {
    await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    let handle;
    try {
        handle = await fsp.open(temp, 'wx', 0o600);
        await handle.writeFile(JSON.stringify(data), 'utf8');
        await handle.sync();
        await handle.close();
        handle = null;
        await fsp.rename(temp, file);
    } finally {
        await handle?.close().catch(() => {});
        await fsp.unlink(temp).catch(() => {});
    }
}
function assertRecord(identity, scope, record) {
    const p = record?.payload;
    const o = p?.trustedOrigin;
    if (record?.version !== 1 || typeof record.delegationId !== 'string'
        || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(record.delegationId)
        || p?.requestId !== record.delegationId || p?.pluginName !== 'AgentAssistant'
        || p.status !== p.completionStatus || !terminal.has(p.completionStatus)
        || typeof p.message !== 'string' || Buffer.byteLength(p.message, 'utf8') > 1024 * 1024
        || !o || o.identityVerified !== true || o.autoResumeEligible !== true
        || o.sourceNode !== identity.sourceNode || o.caller !== identity.caller
        || o.agentId !== scope.agentId || o.topicId !== scope.topicId || o.sessionId !== null
        || identity.autoResume !== true || identity.enabled !== true) {
        throw new Error('DELEGATION_RECORD_DENIED');
    }
    return p;
}
class DelegationInbox {
    constructor({ file, fsPromises = fs, save = data => atomicSave(file, data, fsPromises) }) {
        this.file = file;
        this.fsp = fsPromises;
        this.save = save;
        this.state = { version: 1, scopes: {}, entries: {} };
        this.queue = Promise.resolve();
        this.loaded = false;
    }
    serial(fn) {
        const work = this.queue.catch(() => {}).then(fn);
        this.queue = work;
        return work;
    }
    async commit(next) {
        if (Buffer.byteLength(JSON.stringify(next), 'utf8') > 32 * 1024 * 1024) {
            throw new Error('DELEGATION_JOURNAL_LIMIT');
        }
        await this.save(clone(next));
        this.state = next; // disk first; failed saves never advance the cache.
    }
    open() {
        return this.serial(async () => {
            if (this.loaded) return;
            let data;
            try {
                const stat = await this.fsp.stat(this.file);
                if (stat.size > 32 * 1024 * 1024) throw new Error('DELEGATION_JOURNAL_LIMIT');
                data = JSON.parse(await this.fsp.readFile(this.file, 'utf8'));
            } catch (error) { if (error.code !== 'ENOENT') throw error; }
            if (data) {
                if (data.version !== 1 || !data.scopes || !data.entries
                    || Array.isArray(data.scopes) || Array.isArray(data.entries)
                    || Object.keys(data.scopes).length > 256 || Object.keys(data.entries).length > cap
                    || Object.entries(data.scopes).some(([id, s]) => !/^[a-f0-9]{64}$/.test(id)
                        || typeof s?.host !== 'string' || !Array.isArray(s.requestIds)
                        || !s.requestIds.length || s.requestIds.length > 256)
                    || Object.entries(data.entries).some(([id, e]) => !/^[a-f0-9]{64}$/.test(id)
                        || !states.has(e?.state) || !data.scopes[e.scopeId]
                        || typeof e.payloadHash !== 'string' || hash(e.record?.payload) !== e.payloadHash)) {
                    throw new Error('DELEGATION_JOURNAL_CORRUPT');
                }
                this.state = data;
                const next = clone(data);
                let changed = false;
                for (const entry of Object.values(next.entries)) {
                    if (entry.state === 'pending' && entry.record?.payload?.completionStatus === 'Failed') {
                        entry.state = 'failed';
                        entry.reason = 'terminal_failure_is_notification_only';
                        changed = true;
                    }
                    if (entry.state === 'dispatching') {
                        entry.state = 'uncertain';
                        entry.reason = 'process_restart_requires_manual_reconciliation';
                        changed = true;
                    }
                }
                if (changed) await this.commit(next);
            }
            this.loaded = true;
        });
    }
    register(identity, scope, requestId) {
        return this.serial(async () => {
            if (!this.loaded) throw new Error('DELEGATION_NOT_OPEN');
            if (typeof requestId !== 'string' || !requestId || requestId.length > 200) {
                throw new Error('DELEGATION_REQUEST_ID_REQUIRED');
            }
            const id = scopeId(identity, scope);
            const next = clone(this.state);
            if (!Object.hasOwn(next.scopes, id)) {
                if (Object.keys(next.scopes).length >= 256) throw new Error('DELEGATION_SCOPE_LIMIT');
                next.scopes[id] = {
                    host: hostId(identity), keyId: identity.keyId, serverOrigin: identity.serverOrigin,
                    agentId: scope.agentId, topicId: scope.topicId, sessionId: null, requestIds: [],
                };
            }
            const requests = next.scopes[id].requestIds;
            if (!requests.includes(requestId)) {
                // This is diagnostic registration history, NOT the consumption dedupe ledger.
                // Bound it without eventually disabling ordinary chat on a long-lived topic.
                if (requests.length >= 256) requests.splice(0, requests.length - 255);
                requests.push(requestId);
                await this.commit(next);
            }
            return id;
        });
    }
    scopes(identity) {
        return Object.entries(this.state.scopes).filter(([, s]) => s.host === hostId(identity)
            && s.keyId === identity.keyId && s.serverOrigin === identity.serverOrigin)
            .map(([id, value]) => ({ id, ...clone(value) }));
    }
    ingest(identity, scope, record) {
        return this.serial(async () => {
            const sid = scopeId(identity, scope);
            if (!Object.hasOwn(this.state.scopes, sid)) throw new Error('DELEGATION_UNKNOWN_SCOPE');
            const payload = assertRecord(identity, scope, record);
            const id = hash([hostId(identity), record.delegationId, sid]);
            const payloadHash = hash(payload);
            const previous = this.state.entries[id];
            if (previous && previous.payloadHash !== payloadHash) {
                const next = clone(this.state);
                next.entries[id].state = previous.state === 'cancelled'
                    || ['Cancelled', 'Stopped'].includes(payload.completionStatus) ? 'cancelled' : 'conflict';
                next.entries[id].conflictingHash = payloadHash;
                await this.commit(next);
                throw new Error('DELEGATION_PAYLOAD_CONFLICT');
            }
            if (previous) return { id, ...clone(previous), duplicate: true };
            if (Object.keys(this.state.entries).length >= cap) throw new Error('DELEGATION_INBOX_LIMIT');
            const next = clone(this.state);
            next.entries[id] = {
                scopeId: sid, payloadHash, record: clone(record),
                state: ['Cancelled', 'Stopped'].includes(payload.completionStatus) ? 'cancelled'
                    : payload.completionStatus === 'Failed' ? 'failed' : 'pending',
                token: null,
            };
            await this.commit(next);
            return { id, ...clone(next.entries[id]) };
        });
    }
    pending(identity, scope) {
        const sid = scopeId(identity, scope);
        return Object.entries(this.state.entries).filter(([, e]) => e.scopeId === sid && e.state === 'pending')
            .map(([id, value]) => ({ id, ...clone(value) }));
    }
    claim(id) {
        return this.serial(async () => {
            if (this.state.entries[id]?.state !== 'pending') return null;
            const next = clone(this.state);
            const entry = next.entries[id];
            entry.state = 'dispatching';
            entry.token = crypto.randomBytes(16).toString('hex');
            await this.commit(next);
            return { id, ...clone(entry) };
        });
    }
    settle(id, token, outcome) {
        return this.serial(async () => {
            const prior = this.state.entries[id];
            if (!prior || prior.state !== 'dispatching' || prior.token !== token) return false;
            const next = clone(this.state);
            next.entries[id].state = outcome?.type === 'completed' && outcome.persisted === true ? 'completed'
                : outcome?.type === 'cancelled' ? 'cancelled'
                    : outcome?.type === 'failed' && outcome.persisted === true ? 'failed' : 'uncertain';
            await this.commit(next);
            return true;
        });
    }
    cancel(id) {
        return this.serial(async () => {
            if (!Object.hasOwn(this.state.entries, id)) return false;
            const next = clone(this.state);
            next.entries[id].state = 'cancelled'; // permanent tombstone, including late terminal replies.
            await this.commit(next);
            return true;
        });
    }
    snapshot() { return clone(this.state); }
}
module.exports = { DelegationInbox, atomicSave, assertRecord };