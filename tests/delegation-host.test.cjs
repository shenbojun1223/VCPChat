'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {
    loadIdentity, signRequest, authorizeScope, hostId, scopeId,
} = require('../modules/services/delegationIdentity.cjs');
const { DelegationInbox, assertRecord } = require('../modules/services/delegationInbox.cjs');
const { createDelegationHost, boundedJson, resumePrompt } = require('../modules/services/delegationHost.cjs');
const { AgentConfigManager } = (() => {
    const mod = require('../modules/utils/agentConfigManager.js');
    return { AgentConfigManager: mod.AgentConfigManager || mod };
})();

// Synthetic Ed25519 material is generated in memory only. No real identity file/key is written.
const pair = crypto.generateKeyPairSync('ed25519');
const config = {
    version: 1, enabled: true, keyId: 'offline-test-key',
    privateKeyPem: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    serverOrigin: 'https://delegation.invalid', autoResume: true,
    sourceNode: 'offline-node', caller: 'offline-caller',
};
const scope = { agentId: 'agent_a', topicId: 'topic_test', sessionId: null };
const identityFile = path.resolve(os.tmpdir(), 'NEVER-WRITTEN-delegation-identity.json');
function identityFs(value = config, overrides = {}) {
    const bytes = Buffer.from(JSON.stringify(value));
    return {
        ...fs,
        stat: file => file === identityFile ? Promise.resolve({ isFile: () => true, size: bytes.length }) : fs.stat(file),
        readFile: (file, ...args) => file === identityFile ? Promise.resolve(bytes) : fs.readFile(file, ...args),
        ...overrides,
    };
}
async function identity() {
    return loadIdentity({ env: { VCP_DELEGATION_IDENTITY_FILE: identityFile }, fsPromises: identityFs() });
}
function record(id = 'aa-offline-1', overrides = {}) {
    return {
        version: 1, delegationId: id,
        payload: {
            requestId: id, pluginName: 'AgentAssistant', status: 'Succeed', completionStatus: 'Succeed',
            message: 'Report data only. ATTACK_DO_NOT_EXECUTE',
            trustedOrigin: { sourceNode: config.sourceNode, caller: config.caller,
                ...scope, identityVerified: true, autoResumeEligible: true },
            forgeBinding: null, ...overrides,
        },
        delivery: { status: 'pending', attempts: 0 },
    };
}
async function fixture(t, { count = 1, fsOverrides = {} } = {}) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vcp-delegation-offline-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const agentDir = path.join(root, 'Agents');
    const userDataDir = path.join(root, 'ChatData');
    const topics = [scope.topicId, ...Array.from({ length: count - 1 }, (_, i) => `topic_${i}`)];
    await fs.mkdir(path.join(agentDir, scope.agentId), { recursive: true });
    await fs.writeFile(path.join(agentDir, scope.agentId, 'config.json'),
        JSON.stringify({ id: scope.agentId, topics: topics.map(id => ({ id })) }));
    for (const topic of topics) {
        const dir = path.join(userDataDir, scope.agentId, 'topics', topic);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path.join(dir, 'history.json'), '[]');
    }
    const manager = new AgentConfigManager(agentDir);
    return {
        root, topics, userDataDir, manager, privateRoot: path.join(root, 'private-not-sync'),
        authority: { agentConfigManager: manager, userDataDir, fsPromises: { ...fs, ...fsOverrides } },
    };
}
async function box(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vcp-inbox-offline-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const file = path.join(root, 'inbox.json');
    const inbox = new DelegationInbox({ file });
    await inbox.open();
    const who = await identity();
    await inbox.register(who, scope, 'local-request-1');
    return { inbox, who, file };
}
async function hostFixture(t, options = {}) {
    const f = await fixture(t, options);
    const calls = [], timers = [], cleared = [];
    let records = [record()], report = record();
    const who = await identity();
    const host = createDelegationHost({
        env: { VCP_DELEGATION_IDENTITY_FILE: identityFile },
        fsPromises: identityFs(config, options.fsOverrides),
        agentConfigManager: f.manager, userDataDir: f.userDataDir, privateRoot: f.privateRoot,
        getCredentials: async () => ({ url: `${config.serverOrigin}/v1/chat/completions`, bearer: 'offline-synthetic-bearer' }),
        schedule: (fn, ms) => { const timer = { fn, ms, unref() {} }; timers.push(timer); return timer; },
        unschedule: timer => cleared.push(timer),
        fetchFn: async (url, init) => {
            calls.push({ url, init });
            if (options.fetchFn) return options.fetchFn(url, init);
            const body = url.endsWith('/report')
                ? { success: true, autoResumeEligible: true, record: report }
                : { success: true, autoResumeEligible: true, records };
            return new Response(JSON.stringify(body), { status: 200 });
        },
    });
    t.after(() => host.close());
    await host.ready;
    async function prepare(topic = scope.topicId, url = `${config.serverOrigin}/v1/chat/completions`) {
        return host.prepareChat({
            url, serializedBody: JSON.stringify({ messages: [], requestId: `request-${topic}` }),
            context: { ...scope, topicId: topic, itemType: 'agent' }, requestId: `request-${topic}`,
        });
    }
    return { ...f, host, who, calls, timers, cleared, prepare,
        setRecords: value => { records = value; }, setReport: value => { report = value; } };
}

test('absent identity: no filesystem/network/timer/credentials/journal effects', async () => {
    let effects = 0;
    const bomb = () => { effects++; throw new Error('unexpected side effect'); };
    const host = createDelegationHost({
        env: {}, fsPromises: new Proxy({}, { get: () => bomb }),
        fetchFn: bomb, schedule: bomb, getCredentials: bomb,
    });
    assert.deepEqual(await host.prepareChat({}), {});
    assert.deepEqual(await host.poll(), { skipped: true });
    assert.deepEqual(await host.consumeOne(scope, {}), { skipped: true });
    assert.equal(await host.snapshot(), null);
    await host.close();
    assert.equal(effects, 0);
});
test('disabled identity file does not parse keys, schedule or create private directory', async () => {
    assert.equal(await loadIdentity({
        env: { VCP_DELEGATION_IDENTITY_FILE: identityFile }, fsPromises: identityFs({ enabled: false }),
    }), null);
});
test('signature has exact ordered claims, UTF8 body digest, TTL, nonce and Ed25519 proof on both chat routes', async () => {
    const who = await identity();
    const body = JSON.stringify({ messages: [{ role: 'user', content: '离线签名 ✓' }] });
    for (const endpoint of ['/v1/chat/completions', '/v1/chatvcp/completions']) {
        const proof = signRequest(who, scope, `${config.serverOrigin}${endpoint}`, body,
            { now: () => 1000, randomBytes: size => Buffer.alloc(size, 7) });
        const { claims, signature } = JSON.parse(Buffer.from(proof, 'base64url'));
        assert.deepEqual(Object.keys(claims), [
            'version', 'keyId', 'nonce', 'issuedAt', 'expiresAt', 'method', 'path', 'bodyHash',
            'agentId', 'topicId', 'sessionId', 'autoResumeEligible',
        ]);
        assert.equal(claims.nonce, '07'.repeat(16));
        assert.equal(claims.issuedAt, 1000);
        assert.equal(claims.expiresAt, 61000);
        assert.equal(claims.method, 'POST');
        assert.equal(claims.path, endpoint);
        assert.equal(claims.sessionId, null);
        assert.equal(claims.autoResumeEligible, true);
        assert.equal(claims.bodyHash, crypto.createHash('sha256').update(body).digest('hex'));
        assert.equal(crypto.verify(null, Buffer.from(JSON.stringify(claims)), pair.publicKey,
            Buffer.from(signature, 'base64url')), true);
        assert.equal('sourceNode' in claims || 'caller' in claims, false);
        assert.equal(crypto.verify(null, Buffer.from(JSON.stringify({ ...claims, topicId: 'wrong' })), pair.publicKey,
            Buffer.from(signature, 'base64url')), false);
    }
});
test('wrong origin, query, credentials, unsupported route and non-Ed25519 key are denied', async () => {
    const who = await identity();
    for (const url of [
        'https://elsewhere.invalid/v1/chat/completions',
        `${config.serverOrigin}/v1/chat/completions?forward=1`,
        'https://user:pass@delegation.invalid/v1/chat/completions',
        `${config.serverOrigin}/v1/models`,
    ]) assert.throws(() => signRequest(who, scope, url, '{}'), /DENIED/);
    await assert.rejects(loadIdentity({
        env: { VCP_DELEGATION_IDENTITY_FILE: identityFile },
        fsPromises: identityFs({ ...config, serverOrigin: 'https://delegation.invalid/path' }),
    }), /DENIED/);
    const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey;
    await assert.rejects(loadIdentity({
        env: { VCP_DELEGATION_IDENTITY_FILE: identityFile },
        fsPromises: identityFs({ ...config, privateKeyPem: rsa.export({ type: 'pkcs8', format: 'pem' }) }),
    }), /DENIED/);
});
test('strict scope uses real AgentConfigManager + existing config/history and rejects non-single/anonymous/path traversal', async t => {
    const f = await fixture(t);
    assert.deepEqual(await authorizeScope(scope, f.authority), scope);
    for (const wrong of [
        {}, { ...scope, agentId: '../agent_a' }, { ...scope, topicId: '..' },
        { ...scope, agentId: 'missing' }, { ...scope, topicId: 'missing' },
        { ...scope, isGroupMessage: true }, { ...scope, groupId: 'group_1' },
        { ...scope, itemType: 'group' }, { ...scope, ownerType: 'group' },
        { ...scope, topicId: 'assistant_chat_1' }, { ...scope, topicId: 'sidechat_1' },
        { ...scope, topicId: 'voicechat_1' }, { ...scope, sessionId: 'not-null' },
    ]) await assert.rejects(authorizeScope(wrong, f.authority));
});
test('cached config cannot authorize removed/corrupt current owner or history', async t => {
    const f = await fixture(t);
    await f.manager.readAgentConfig(scope.agentId);
    const file = path.join(f.manager.agentDir, scope.agentId, 'config.json');
    await fs.writeFile(file, JSON.stringify({ id: scope.agentId, topics: [] }));
    await assert.rejects(authorizeScope(scope, f.authority));
    await fs.writeFile(file, '{corrupt');
    await assert.rejects(authorizeScope(scope, f.authority));
    await fs.unlink(file);
    await assert.rejects(authorizeScope(scope, f.authority));
});
test('history/config realpath borrowing another owner is rejected', async t => {
    const f = await fixture(t);
    const history = path.join(f.userDataDir, scope.agentId, 'topics', scope.topicId, 'history.json');
    const authority = { ...f.authority, fsPromises: { ...fs,
        realpath: file => file === history
            ? Promise.resolve(path.join(f.userDataDir, 'other_owner', 'topics', scope.topicId, 'history.json'))
            : fs.realpath(file) } };
    await assert.rejects(authorizeScope(scope, authority), /DENIED/);
});
test('permission revoked in disk topic prevents consumption authorization', async t => {
    const f = await fixture(t);
    await fs.writeFile(path.join(f.manager.agentDir, scope.agentId, 'config.json'),
        JSON.stringify({ topics: [{ id: scope.topicId, delegationAutoResume: false }] }));
    await assert.rejects(authorizeScope(scope, f.authority), /DENIED/);
});
test('enabled without autoResume signs ineligible claims', async () => {
    const who = await loadIdentity({
        env: { VCP_DELEGATION_IDENTITY_FILE: identityFile }, fsPromises: identityFs({ ...config, autoResume: false }),
    });
    const proof = signRequest(who, scope, `${config.serverOrigin}/v1/chat/completions`, '{}');
    assert.equal(JSON.parse(Buffer.from(proof, 'base64url')).claims.autoResumeEligible, false);
});
test('unknown scope never grants inbox ownership', async t => {
    const { inbox, who } = await box(t);
    const other = { ...scope, topicId: 'other' };
    await assert.rejects(inbox.ingest(who, other, record()), /UNKNOWN_SCOPE/);
    assert.equal(Object.keys(inbox.snapshot().entries).length, 0);
});
test('record requires exact verified source/caller/agent/topic/null-session and eligible', async t => {
    const { inbox, who } = await box(t);
    for (const patch of [
        null, { sourceNode: 'other' }, { caller: 'other' }, { agentId: 'other' }, { topicId: 'other' },
        { sessionId: 'other' }, { sessionId: undefined }, { identityVerified: false }, { autoResumeEligible: false },
    ]) {
        const r = record();
        r.payload.trustedOrigin = patch === null ? null : { ...r.payload.trustedOrigin, ...patch };
        await assert.rejects(inbox.ingest(who, scope, r), /DENIED/);
    }
    assert.equal(inbox.pending(who, scope).length, 0);
});
test('Cancelled and Stopped persist tombstones, never pending or claimable', async t => {
    const { inbox, who } = await box(t);
    for (const status of ['Cancelled', 'Stopped']) {
        const r = record(`aa-${status}`, { status, completionStatus: status });
        const got = await inbox.ingest(who, scope, r);
        assert.equal(got.state, 'cancelled');
        assert.equal(await inbox.claim(got.id), null);
    }
    assert.equal(inbox.pending(who, scope).length, 0);
});
test('duplicate notifications concurrently create one immutable pending entry', async t => {
    const { inbox, who } = await box(t);
    const got = await Promise.all(Array.from({ length: 30 }, () => inbox.ingest(who, scope, record())));
    assert.equal(new Set(got.map(e => e.id)).size, 1);
    assert.equal(got.filter(e => !e.duplicate).length, 1);
    assert.equal(inbox.pending(who, scope).length, 1);
});
test('payload conflict quarantines pending AND dispatching, late completion cannot green it', async t => {
    const { inbox, who } = await box(t);
    for (const dispatch of [false, true]) {
        const r = record(`aa-conflict-${dispatch}`);
        const e = await inbox.ingest(who, scope, r);
        const claimed = dispatch ? await inbox.claim(e.id) : null;
        await assert.rejects(inbox.ingest(who, scope, { ...r, payload: { ...r.payload, message: 'different' } }), /CONFLICT/);
        assert.equal(inbox.snapshot().entries[e.id].state, 'conflict');
        if (claimed) assert.equal(await inbox.settle(e.id, claimed.token, { type: 'completed', persisted: true }), false);
    }
});
test('registration and claim save failure do not advance committed cache or permit dispatch', async t => {
    const { inbox, who } = await box(t);
    const e = await inbox.ingest(who, scope, record());
    const save = inbox.save;
    inbox.save = async () => { throw new Error('offline injected disk failure'); };
    await assert.rejects(inbox.claim(e.id), /disk failure/);
    assert.equal(inbox.snapshot().entries[e.id].state, 'pending');
    const other = { ...scope, topicId: 'other' };
    await assert.rejects(inbox.register(who, other, 'r2'), /disk failure/);
    assert.equal(inbox.scopes(who).length, 1);
    inbox.save = save;
});
test('dispatching is durable before send; restart becomes uncertain and never automatically reclaims', async t => {
    const { inbox, who, file } = await box(t);
    const e = await inbox.ingest(who, scope, record());
    const claimed = await inbox.claim(e.id);
    assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).entries[e.id].state, 'dispatching');
    const recovered = new DelegationInbox({ file });
    await recovered.open();
    assert.equal(recovered.snapshot().entries[e.id].state, 'uncertain');
    assert.equal(recovered.pending(who, scope).length, 0);
    assert.equal(await recovered.claim(e.id), null);
    assert.equal(await recovered.settle(e.id, claimed.token, { type: 'completed', persisted: true }), false);
});
test('cancellation tombstone survives duplicates and late successful terminal', async t => {
    const { inbox, who } = await box(t);
    const e = await inbox.ingest(who, scope, record());
    const claimed = await inbox.claim(e.id);
    await inbox.cancel(e.id);
    assert.equal(await inbox.settle(e.id, claimed.token, { type: 'completed', persisted: true }), false);
    assert.equal((await inbox.ingest(who, scope, record())).state, 'cancelled');
});
test('cancelled authoritative record wins over pending report conflict', async t => {
    const { inbox, who } = await box(t);
    const e = await inbox.ingest(who, scope, record());
    const claimed = await inbox.claim(e.id);
    await assert.rejects(inbox.ingest(who, scope, record('aa-offline-1',
        { status: 'Cancelled', completionStatus: 'Cancelled' })), /CONFLICT/);
    assert.equal(inbox.snapshot().entries[e.id].state, 'cancelled');
    assert.equal(await inbox.settle(e.id, claimed.token, { type: 'completed', persisted: true }), false);
});
test('only committed terminal is completed; failed/cancelled/unknown outcomes are never retried', async t => {
    const { inbox, who } = await box(t);
    const cases = [
        [{ type: 'completed', persisted: true }, 'completed'],
        [{ type: 'completed', persisted: false }, 'uncertain'],
        [{ type: 'failed', persisted: true }, 'failed'],
        [{ type: 'failed', persisted: false }, 'uncertain'],
        [{ type: 'cancelled' }, 'cancelled'],
    ];
    for (let i = 0; i < cases.length; i++) {
        const e = await inbox.ingest(who, scope, record(`aa-outcome-${i}`));
        const claimed = await inbox.claim(e.id);
        assert.equal(await inbox.settle(e.id, 'stale-token', cases[i][0]), false);
        await inbox.settle(e.id, claimed.token, cases[i][0]);
        assert.equal(inbox.snapshot().entries[e.id].state, cases[i][1]);
        assert.equal(await inbox.claim(e.id), null);
    }
});
test('terminal ACK save failure leaves durable dispatching; recovery is uncertain, not resend', async t => {
    const { inbox, who, file } = await box(t);
    const e = await inbox.ingest(who, scope, record());
    const claimed = await inbox.claim(e.id);
    inbox.save = async () => { throw new Error('ack write failure'); };
    await assert.rejects(inbox.settle(e.id, claimed.token, { type: 'completed', persisted: true }), /ack write/);
    assert.equal(inbox.snapshot().entries[e.id].state, 'dispatching');
    const recovered = new DelegationInbox({ file });
    await recovered.open();
    assert.equal(recovered.snapshot().entries[e.id].state, 'uncertain');
});
test('journal corruption is fail closed, not silently erased', async t => {
    const { inbox, file } = await box(t);
    await fs.writeFile(file, '{"version":1,"scopes":{},"entries":{"bad":{}}}');
    const reopened = new DelegationInbox({ file });
    await assert.rejects(reopened.open(), /CORRUPT/);
    assert.match(await fs.readFile(file, 'utf8'), /bad/);
    assert.equal(inbox.loaded, true);
});
test('prepare registers scope/requestId before returning header; polling signs bearer requests and queues only', async t => {
    const f = await hostFixture(t);
    const prepared = await f.prepare();
    assert.equal(prepared.redirect, 'error');
    assert.equal(Object.keys((await f.host.snapshot()).scopes).length, 1);
    assert.equal(f.calls.length, 0);
    const result = await f.host.poll();
    assert.deepEqual(result, { scanned: 1, accepted: 1, errors: 0 });
    const call = f.calls[0];
    assert.equal(call.url, `${config.serverOrigin}/v1/delegations/inbox`);
    assert.equal(call.init.redirect, 'error');
    assert.equal(call.init.headers.Authorization, 'Bearer offline-synthetic-bearer');
    assert.deepEqual(JSON.parse(call.init.body), { agentId: scope.agentId, topicId: scope.topicId });
    const proof = JSON.parse(Buffer.from(call.init.headers['x-vcp-delegation-origin'], 'base64url'));
    assert.equal(proof.claims.path, '/v1/delegations/inbox');
    assert.equal(crypto.verify(null, Buffer.from(JSON.stringify(proof.claims)), pair.publicKey,
        Buffer.from(proof.signature, 'base64url')), true);
    const state = await f.host.snapshot();
    assert.equal(Object.values(state.entries)[0].state, 'pending'); // NO automatic send.
    assert.equal(JSON.stringify(state).includes('PRIVATE KEY'), false);
    assert.equal(JSON.stringify(state).includes('offline-synthetic-bearer'), false);
    assert.equal(JSON.stringify(state).includes('signature'), false);
    assert.equal(f.timers[0].ms, 30000);
    await f.host.close();
    assert.equal(f.cleared.length, 1);
});
test('wrong-origin prepare never writes a scope', async t => {
    const f = await hostFixture(t);
    await assert.rejects(f.prepare(scope.topicId, 'https://evil.invalid/v1/chat/completions'), /DENIED/);
    assert.equal(Object.keys((await f.host.snapshot()).scopes).length, 0);
    assert.equal(f.calls.length, 0);
});
test('poll is serial, non-overlapping and bounded to eight locally registered scopes', async t => {
    let active = 0, maxActive = 0;
    const f = await hostFixture(t, { count: 10, fetchFn: async () => {
        active++; maxActive = Math.max(maxActive, active);
        await new Promise(resolve => setImmediate(resolve));
        active--;
        return new Response(JSON.stringify({ success: true, autoResumeEligible: true, records: [] }));
    } });
    for (const topic of f.topics) await f.prepare(topic);
    const results = await Promise.all([f.host.poll(), f.host.poll()]);
    assert.equal(results.filter(value => value.skipped).length, 1);
    assert.equal(f.calls.length, 8);
    assert.equal(maxActive, 1);
    assert.equal((await f.host.poll()).scanned, 8);
});
test('bad/anonymous/foreign poll records cannot enter inbox', async t => {
    const f = await hostFixture(t);
    await f.prepare();
    const foreign = record();
    foreign.payload.trustedOrigin.caller = 'unknown';
    f.setRecords([foreign, record('anonymous', { trustedOrigin: null })]);
    assert.equal((await f.host.poll()).errors, 2);
    assert.equal(Object.keys((await f.host.snapshot()).entries).length, 0);
});
test('adapter contract: busy/draft/other selection preserve pending; idle consumes once without draft writes/topic switches', async t => {
    const f = await hostFixture(t);
    await f.prepare(); await f.host.poll();
    let busy = true, draft = '', selected = scope.topicId, held = false, sends = 0, releases = 0;
    const adapter = {
        tryAcquire: target => {
            if (busy || draft || selected !== target.topicId || held) return null;
            held = true;
            return { valid: () => held && !busy && !draft && selected === scope.topicId,
                release: () => { held = false; releases++; } };
        },
        send: async request => {
            sends++;
            assert.equal(held, true);
            assert.deepEqual(request.attachments, []);
            assert.equal(request.content.includes('ATTACK_DO_NOT_EXECUTE'), false);
            assert.equal(JSON.parse(await fs.readFile(path.join(f.privateRoot, hostId(f.who), 'inbox.json'), 'utf8'))
                .entries[Object.keys((await f.host.snapshot()).entries)[0]].state, 'dispatching');
            return { type: 'completed', persisted: true };
        },
    };
    assert.equal((await f.host.consumeOne(scope, adapter)).skipped, true);
    busy = false; draft = 'user draft';
    assert.equal((await f.host.consumeOne(scope, adapter)).skipped, true);
    assert.equal(draft, 'user draft');
    draft = ''; selected = 'another-topic';
    assert.equal((await f.host.consumeOne(scope, adapter)).skipped, true);
    assert.equal(selected, 'another-topic');
    selected = scope.topicId;
    const results = await Promise.all([f.host.consumeOne(scope, adapter), f.host.consumeOne(scope, adapter)]);
    assert.equal(results.filter(r => r.state === 'completed').length, 1);
    assert.equal(sends, 1);
    assert.equal(releases, 1);
    assert.equal((await f.host.consumeOne(scope, adapter)).skipped, true);
    assert.equal(f.calls.filter(call => call.url.endsWith('/report')).length, 5);
});
test('adapter contract: lease revoked while claim awaits never sends and remains uncertain', async t => {
    const f = await hostFixture(t);
    await f.prepare(); await f.host.poll();
    let sent = false, released = false;
    const result = await f.host.consumeOne(scope, {
        tryAcquire: () => ({ valid: () => false, release: () => { released = true; } }),
        send: () => { sent = true; },
    });
    assert.equal(result.uncertain, true);
    assert.equal(sent, false);
    assert.equal(released, true);
    assert.equal(Object.values((await f.host.snapshot()).entries)[0].state, 'uncertain');
});
test('fresh report fetch is authoritative: conflicting payload blocks send', async t => {
    const f = await hostFixture(t);
    await f.prepare(); await f.host.poll();
    f.setReport(record('aa-offline-1', { message: 'changed-report' }));
    let acquired = false;
    await assert.rejects(f.host.consumeOne(scope, {
        tryAcquire: () => { acquired = true; },
    }), /CONFLICT/);
    assert.equal(acquired, false);
    assert.equal(Object.values((await f.host.snapshot()).entries)[0].state, 'conflict');
});
test('scope deleted after intake blocks fresh authorization without recreating topic/history', async t => {
    const f = await hostFixture(t);
    await f.prepare(); await f.host.poll();
    const history = path.join(f.userDataDir, scope.agentId, 'topics', scope.topicId, 'history.json');
    await fs.unlink(history);
    await assert.rejects(f.host.consumeOne(scope, { tryAcquire: () => { throw new Error('must not acquire'); } }));
    assert.equal(await fs.stat(history).then(() => true, () => false), false);
    assert.equal(Object.values((await f.host.snapshot()).entries)[0].state, 'pending');
});
test('bounded response rejects over-limit body and invalid JSON without model/network', async () => {
    await assert.rejects(boundedJson(new Response('x'.repeat(2 * 1024 * 1024 + 1))), /LIMIT/);
    await assert.rejects(boundedJson(new Response('{broken')));
    await assert.rejects(boundedJson(new Response('{}', { status: 403 })), /HTTP_DENIED/);
});
test('fixed review prompt contains ID/hash/status, never the untrusted report message', () => {
    const entry = { record: record(), payloadHash: 'a'.repeat(64) };
    const prompt = resumePrompt(entry);
    assert.match(prompt, /不要重新派工/);
    assert.match(prompt, /aa-offline-1/);
    assert.equal(prompt.includes('ATTACK_DO_NOT_EXECUTE'), false);
    assert.doesNotThrow(() => assertRecord({ ...config, privateKey: pair.privateKey }, scope, record()));
});
test('production wiring signs only main-frame requests and dispatches through the dedicated bridge, never Flowlock', async () => {
    const file = await fs.readFile(path.join(__dirname, '..', 'modules', 'ipc', 'chatHandlers.js'), 'utf8');
    assert.ok(file.includes('await delegationHost.prepareChat('));
    assert.ok(file.includes('...delegationTransport.headers'));
    assert.ok(file.includes("redirect: delegationTransport.redirect"));
    assert.ok(file.includes('delegationDispatch.trusted(event)'));
    assert.ok(file.includes("ipcMain.handle('delegation-consume'"));
    assert.ok(file.includes('delegationDispatch?.consume(event, request)'));
    assert.equal(file.includes('delegationHost.flowlock'), false);
    const where = file.indexOf('await delegationHost.prepareChat(');
    assert.ok(where < file.indexOf('await fetch(finalVcpUrl', where));
    assert.ok(scopeId({ ...config, privateKey: pair.privateKey }, scope));
});

test('identity disabled after intake fails closed before dispatch and does not send', async t => {
    let enabled = true;
    const f = await hostFixture(t, { fsOverrides: {
        readFile: (file, ...args) => file === identityFile
            ? Promise.resolve(Buffer.from(JSON.stringify({ ...config, enabled }))) : fs.readFile(file, ...args),
    } });
    await f.prepare(); await f.host.poll();
    enabled = false;
    let sent = 0;
    await assert.rejects(f.host.consumeOne(scope, {
        tryAcquire: () => ({ valid: () => true, release() {} }),
        send: () => { sent++; },
    }), /REVOKED/);
    assert.equal(sent, 0);
    assert.equal(Object.values((await f.host.snapshot()).entries)[0].state, 'pending');
});

test('request registration history rotates at 256 without erasing consumption tombstones', async t => {
    const { inbox, who } = await box(t);
    const entry = await inbox.ingest(who, scope, record());
    await inbox.cancel(entry.id);
    for (let i = 0; i < 260; i++) await inbox.register(who, scope, `request-${i}`);
    const saved = inbox.scopes(who)[0];
    assert.equal(saved.requestIds.length, 256);
    assert.equal(saved.requestIds.at(-1), 'request-259');
    assert.equal(inbox.snapshot().entries[entry.id].state, 'cancelled');
    assert.equal((await inbox.ingest(who, scope, record())).state, 'cancelled');
});

for (const permit of [false, undefined, 'true']) test(`current server permission ${String(permit)} blocks intake and pending dispatch`,async t=>{
    let eligible = true;
    const f=await hostFixture(t,{fetchFn:async url=>new Response(JSON.stringify({
        success:true, autoResumeEligible:eligible,
        ...(url.endsWith('/report')?{record:record()}:{records:[record()]}),
    }))});
    await f.prepare();
    eligible=permit;
    const rejected=await f.host.poll();
    assert.equal(rejected.accepted,0);
    assert.equal(Object.keys((await f.host.snapshot()).entries).length,0);
    eligible=true;await f.host.poll();
    eligible=permit;
    let acquired=0,sent=0;
    await assert.rejects(f.host.consumeOne(scope,{
        tryAcquire:()=>{acquired++;return{valid:()=>true,release(){}};},
        send:()=>{sent++;},
    }),/REPORT_RESPONSE_DENIED/);
    assert.equal(acquired,0);assert.equal(sent,0);
    assert.equal(Object.values((await f.host.snapshot()).entries)[0].state,'pending');
});

test('Failed reports are notification-only, including protocol halt, never dispatch a model',async t=>{
    const f=await hostFixture(t);
    await f.prepare();
    const failed=record('aa-failed-halt',{status:'Failed',completionStatus:'Failed',
        message:'VCP_MODEL_PROTOCOL_HALT: no automatic model retry'});
    f.setRecords([failed]); f.setReport(failed);
    await f.host.poll();
    assert.equal(Object.values((await f.host.snapshot()).entries)[0].state,'failed');
    const result=await f.host.consumeOne(scope,{
        tryAcquire:()=>{throw Error('failed report must never acquire');},
        send:()=>{throw Error('failed report must never send');},
    });
    assert.deepEqual(result,{skipped:true});
});
test('legacy pending Failed report is sealed on restart without replaying dispatch',async t=>{
    const {inbox,who,file}=await box(t);
    const e=await inbox.ingest(who,scope,record('aa-failed',{status:'Failed',completionStatus:'Failed'}));
    const saved=inbox.snapshot();
    saved.entries[e.id].state='pending';
    await fs.writeFile(file,JSON.stringify(saved));
    const recovered=new DelegationInbox({file});await recovered.open();
    assert.equal(recovered.snapshot().entries[e.id].state,'failed');
    assert.equal(await recovered.claim(e.id),null);
    assert.equal(recovered.pending(who,scope).length,0);
});

for (const duringRegister of [false,true]) test(`automatic prepare fails closed when autoResume revoked (duringRegister=${duringRegister})`,async t=>{
    let autoResume=true, armed=false;
    const f=await hostFixture(t,{fsOverrides:{
        readFile:(file,...args)=>file===identityFile
            ? Promise.resolve(Buffer.from(JSON.stringify({...config,autoResume}))) : fs.readFile(file,...args),
        rename:async(...args)=>{await fs.rename(...args);if(armed && duringRegister)autoResume=false;},
    }});
    await f.prepare();
    armed=true;
    if(!duringRegister)autoResume=false;
    await assert.rejects(f.host.prepareChat({
        url:config.serverOrigin+'/v1/chat/completions',serializedBody:'{}',context:scope,
        requestId:'automatic-revoke-test',requireAutoResume:true,
    }),/REVOKED/);
    const ordinary=await f.prepare();
    assert.equal(JSON.parse(Buffer.from(ordinary.headers['x-vcp-delegation-origin'],'base64url')).claims.autoResumeEligible,false);
});