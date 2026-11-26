'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs-extra');
const os = require('node:os');
const path = require('node:path');
const { createTopicMessageAdmissionStore } = require('../modules/services/topicMessageAdmissionStore');

async function makeJournalFixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vcp-admission-'));
    t.after(() => fs.remove(root));
    return path.join(root, 'journal.json');
}

test('journal missing, roundtrip, replacement and corrupt data', async t => {
    const file = await makeJournalFixture(t);
    const root = path.dirname(file);
    const store = createTopicMessageAdmissionStore(file);
    assert.deepEqual(await store.load(), []);
    const entries = [{ entryId: 'one', message: { content: '中文\n消息' } }];
    await store.save(entries);
    assert.deepEqual(await store.load(), entries);
    await store.save([]);
    assert.deepEqual(await store.load(), []);
    assert.deepEqual(await fs.readdir(root), ['journal.json']);
    await fs.writeFile(file, '{broken');
    await assert.rejects(store.load());
    await fs.writeJson(file, { version: 3, entries: [] });
    await assert.rejects(store.load(), /corrupt/);
    await fs.writeJson(file, { version: 2, entries: [] });
    await assert.rejects(store.loadState(), /lease journal/);
});

test('journal refuses relative path', () => {
    assert.throws(() => createTopicMessageAdmissionStore('journal.json'), /absolute/);
});

test('v2 atomically preserves frozen messages and standalone leases; v1 migrates on write', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vcp-admission-v2-'));
    t.after(() => fs.remove(root));
    const file = path.join(root, 'journal.json');
    const store = createTopicMessageAdmissionStore(file);
    const entries = [{ entryId: 'one', message: { content: 'original' } }];
    await fs.outputJson(file, { version: 1, entries });
    assert.deepEqual(await store.loadState(), { entries, standaloneLeases: [] });
    const leases = [{
        scope: { itemType: 'group', itemId: 'g', topicId: 't' },
        token: 'exact-lease',
    }];
    const expected = structuredClone({ entries, standaloneLeases: leases });
    const saving = store.save(entries, leases);
    entries[0].message.content = 'mutated';
    leases[0].token = 'mutated';
    await saving;
    assert.deepEqual(await store.loadState(), expected);
    assert.equal((await fs.readJson(file)).version, 2);
    await assert.rejects(store.save([], [...expected.standaloneLeases, ...expected.standaloneLeases]),
        /duplicate/);
    await assert.rejects(store.save([], [{ scope: { itemId: '../bad', topicId: 't' }, token: 'x' }]),
        /identifier/);
    assert.deepEqual(await store.loadState(), expected);
    assert.deepEqual(await fs.readdir(root), ['journal.json']);
});

test('disk restart clears interrupted ownership and staging without history replay', async t => {
    const { TopicMessageAdmission } = require('../modules/services/topicMessageAdmission');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vcp-lease-recover-'));
    t.after(() => fs.remove(root));
    const store = createTopicMessageAdmissionStore(path.join(root, 'journal.json'));
    const scope = { itemType: 'agent', itemId: 'a', topicId: 't' };
    const other = { ...scope, topicId: 'other' };
    const create = () => new TopicMessageAdmission({
        store, validate: async () => {},
        commit: async () => assert.fail('recovery must not append messages'),
        advance: async () => assert.fail('recovery must not generate'),
    });
    const first = create();
    await first.initialize();
    await first.acquire(scope, 'interrupted');
    await first.submit({ scope, message: { id: 'pending', role: 'user' } });
    await first.dispose();
    const disk = await store.loadState();
    assert.equal(disk.standaloneLeases[0].token, 'interrupted');
    await store.save([...disk.entries, {
        entryId: 'other-entry', scope: other, message: { id: 'other-message', role: 'user' },
        state: 'queued',
    }], disk.standaloneLeases);
    const recovered = create();
    t.after(() => recovered.dispose());
    await recovered.initialize();
    assert.deepEqual(recovered.snapshot(scope), []);
    assert.equal(recovered.snapshot(other)[0].state, 'recovered');
    assert.equal(recovered.leases.size, 0);
    const cleaned = await store.loadState();
    assert.deepEqual(cleaned.standaloneLeases, []);
    assert.equal(cleaned.entries.length, 1);
    assert.equal(cleaned.entries[0].scope.topicId, 'other');
    assert.equal((await recovered.acquire(scope, 'retry')).success, true);
});
const receiptScope = { itemType: 'agent', itemId: 'fixture-a', topicId: 'fixture-t' };
const makeReceipts = () => ['a', 'b'].map((key, i) => ({
    key: key.repeat(64), fingerprint: String(i + 1).repeat(64),
    entryId: 'entry-' + i, messageId: 'msg-' + i, scope: { ...receiptScope },
    extension: { nested: ['keep', i] },
}));

test('legacy cold save and subsequent saves preserve opaque v3 receipts', async t => {
    const file = await makeJournalFixture(t), expected = makeReceipts();
    await fs.writeJson(file, { version: 3, entries: [], standaloneLeases: [], dispatchReceipts: expected });
    const store = createTopicMessageAdmissionStore(file);
    await store.save([], []);
    const loaded = await store.loadState();
    assert.deepEqual(loaded.dispatchReceipts, expected);
    loaded.dispatchReceipts[0].extension.nested[0] = 'caller edit';
    loaded.dispatchReceipts.pop();
    await store.save([], []);
    assert.deepEqual(await fs.readJson(file), { version: 3, entries: [], standaloneLeases: [], dispatchReceipts: expected });
});

test('duplicate v3 receipts veto both recovery and a cold write before changing bytes', async t => {
    const file = await makeJournalFixture(t), receipt = makeReceipts()[0];
    const original = JSON.stringify({ version: 3, entries: [],
        standaloneLeases: [{ scope: receiptScope, token: 'interrupted' }], dispatchReceipts: [receipt, receipt] });
    await fs.writeFile(file, original);
    const { TopicMessageAdmission } = require('../modules/services/topicMessageAdmission');
    const service = new TopicMessageAdmission({ store: createTopicMessageAdmissionStore(file),
        validate: async () => {}, commit: async () => {}, advance: async () => {} });
    try { await assert.rejects(service.initialize(), /duplicate/i); } finally { await service.dispose(); }
    await assert.rejects(createTopicMessageAdmissionStore(file).save([], []), /duplicate/i);
    assert.equal(await fs.readFile(file, 'utf8'), original);
});

test('ordinary queued message commits once without changing the dispatch ledger', async t => {
    const { TopicMessageAdmission } = require('../modules/services/topicMessageAdmission');
    const file = await makeJournalFixture(t), receipts = makeReceipts();
    await fs.writeJson(file, { version: 3, entries: [], standaloneLeases: [], dispatchReceipts: receipts });
    const committed = [], advances = [];
    let onAdvance;
    const advanced = new Promise(resolve => { onAdvance = resolve; });
    const service = new TopicMessageAdmission({ store: createTopicMessageAdmissionStore(file), validate: async () => {},
        commit: async (_scope, message) => { committed.push(message.id); }, advance: async r => { advances.push(r); onAdvance(r); } });
    try {
        await service.initialize();
        assert.equal((await service.acquire(receiptScope, 'fixture-user')).success, true);
        const accepted = await service.submit({ scope: receiptScope, message: { id: 'ordinary', role: 'user', content: 'fixture' },
            triggerPolicy: 'none' });
        assert.equal(accepted.success, true);
        const pending = await fs.readJson(file);
        assert.equal(pending.entries.length, 1);
        assert.deepEqual(pending.dispatchReceipts, receipts);
        assert.deepEqual(committed, []);
        assert.equal((await service.release(receiptScope, 'fixture-user', { saved: true })).success, true);
        // A human message starts one round even when automatic replies are disabled.
        // Its committed entry stays attached to the new lease until that round reports a saved reply.
        let timer;
        let round;
        try {
            round = await Promise.race([advanced, new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('ordinary message never advanced')), 3000);
            })]);
        } finally { clearTimeout(timer); }
        assert.deepEqual(round.scope, receiptScope);
        assert.equal(round.messageId, 'ordinary');
        assert.equal(round.automatic, false);
        assert.ok(round.token && round.token !== 'fixture-user');
        assert.deepEqual(committed, ['ordinary']);
        assert.equal(advances.length, 1);
        const active = await fs.readJson(file);
        assert.deepEqual(active.dispatchReceipts, receipts);
        assert.equal(active.entries.length, 1);
        assert.equal(active.entries[0].entryId, accepted.entryId);
        assert.equal(active.entries[0].state, 'advancing');
        assert.equal(active.entries[0].leaseToken, round.token);
        const unsaved = await service.release(receiptScope, round.token, { saved: false });
        assert.deepEqual([unsaved.success, unsaved.code], [false, 'UNSAVED_TERMINAL']);
        assert.deepEqual(await fs.readJson(file), active);
        assert.equal((await service.release(receiptScope, round.token, {saved:true})).success, true);
        assert.deepEqual(service.snapshot(receiptScope), []);
        assert.deepEqual(committed, ['ordinary']);
        assert.equal(advances.length, 1);
        assert.deepEqual(await fs.readJson(file), { version: 3, entries: [], standaloneLeases: [], dispatchReceipts: receipts });
    } finally { await service.dispose(); }
});
