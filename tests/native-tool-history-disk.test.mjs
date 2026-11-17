import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { HistoryMutationQueue } = require('../modules/services/historyMutationQueue.js');
const { createTopicMessageAdmissionHost } = require('../modules/services/topicMessageAdmissionHost.js');
async function loadPure(relative) {
    const source = await readFile(new URL(relative, import.meta.url), 'utf8');
    return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}
const { createChatHistoryPersistence } = await loadPure('../modules/chat/chatHistoryPersistence.js');
const { normalizeNativeToolSnapshot } = await loadPure('../modules/chat/nativeToolEvents.js');

test('native metadata survives real admission persistence, update and fresh disk read', async t => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'vcp-native-history-'));
    const userDataDir = path.join(root, 'UserData');
    const queue = new HistoryMutationQueue({ userDataDir });
    const handlers = new Map();
    const sender = { id: 1, isDestroyed: () => false, send() {} };
    const scope = { itemType: 'agent', itemId: 'fixture-agent', topicId: 'fixture-topic' };
    const context = { agentId: scope.itemId, topicId: scope.topicId };
    const file = queue.getHistoryPath(scope.itemId, scope.topicId);
    let host, reopened;
    t.after(async () => {
        try { await host?.dispose(); }
        finally {
            try {
                await queue.dispose();
                await reopened?.dispose();
            } finally { await rm(root, { recursive: true, force: true }); }
        }
    });
    const neighbor = { id: 'user-1', role: 'user', content: 'preserve me', timestamp: 1 };
    await queue.replace(scope, [neighbor]);
    host = await createTopicMessageAdmissionHost({
        appDataRoot: root, historyQueue: queue,
        validate: async target => {
            assert.deepEqual(target, scope);
            const history = JSON.parse(await readFile(file, 'utf8'));
            assert.ok(Array.isArray(history));
        },
        getMainWindow: () => ({ isDestroyed: () => false, webContents: sender }),
        ipcMain: {
            handle(channel, handler) {
                assert.equal(handlers.has(channel), false);
                handlers.set(channel, handler);
            },
            removeHandler(channel) { handlers.delete(channel); },
        },
        logger: { warn() {}, error() {}, log() {} },
    });
    const handler = handlers.get('topic-admission:persist-assistant');
    assert.equal(typeof handler, 'function');
    let commits = 0;
    const persistence = createChatHistoryPersistence({
        getHistory: () => queue.read(scope),
        saveHistory() { throw new Error('Unexpected fallback history replacement'); },
        persistAssistant(target, message) {
            commits++;
            return handler({ sender }, target, message);
        },
    });
    const events = normalizeNativeToolSnapshot([{
        schema: 1, source: 'agy-native', requestId: 'disk-request', callId: 'step:2',
        revision: 0, sequence: 1, name: 'read_file', status: 'running',
        evidence: 'transport_reported', detailsPolicy: 'withheld',
        parameters: { secret: 'SYNTHETIC_PRIVATE_INPUT' },
        output: 'SYNTHETIC_PRIVATE_OUTPUT',
    }]);
    assert.ok(events);
    const terminal = {
        id: 'assistant-1', role: 'assistant', timestamp: 2,
        content: 'partial answer', finishReason: 'failed',
        isThinking: false, nativeToolEvents: events,
    };
    const commit = message => persistence.commit({
        messageId: message.id, context, content: message.content,
        finishReason: message.finishReason, history: [message],
    });
    await commit(terminal);
    const first = JSON.parse(await readFile(file, 'utf8'));
    assert.deepEqual(first, [neighbor, terminal]);
    assert.equal(first[1].nativeToolEvents[0].status, 'unknown');
    assert.equal(first[1].nativeToolEvents[0].evidence, 'missing_terminal');
    assert.equal(JSON.stringify(first).includes('SYNTHETIC_PRIVATE'), false);
    assert.equal(first[1].content.includes('disk-request'), false);

    // Simulate a separate queued update; the terminal transaction owns only its message.
    await queue.mutate(scope, history => {
        history[1].feedback = 'preserve concurrent metadata';
        history.push({ id: 'user-2', role: 'user', content: 'new neighbor', timestamp: 3 });
        return history;
    }, { requireExisting: true });
    await commit({ ...terminal, content: 'retained partial answer' });
    assert.equal(commits, 2);
    await host.dispose();
    host = null;
    assert.equal(handlers.size, 0);
    await queue.dispose();
    reopened = new HistoryMutationQueue({ userDataDir });
    const restored = await reopened.read(scope);
    assert.equal(restored.length, 3);
    assert.deepEqual(restored[0], neighbor);
    assert.equal(restored[2].id, 'user-2');
    assert.equal(restored.filter(message => message.id === terminal.id).length, 1);
    assert.equal(restored[1].feedback, 'preserve concurrent metadata');
    assert.equal(restored[1].content, 'retained partial answer');
    assert.equal(restored[1].finishReason, 'failed');
    assert.deepEqual(normalizeNativeToolSnapshot(restored[1].nativeToolEvents), events);
    assert.deepEqual(await readdir(path.dirname(file)), ['history.json']);
});

test('admission persistence rejects a foreign sender without changing history bytes', async t => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'vcp-native-history-auth-'));
    const queue = new HistoryMutationQueue({ userDataDir: path.join(root, 'UserData') });
    const scope = { itemType: 'agent', itemId: 'fixture-agent', topicId: 'fixture-topic' };
    const handlers = new Map();
    const sender = { id: 1, isDestroyed: () => false, send() {} };
    let host;
    t.after(async () => {
        try { await host?.dispose(); }
        finally {
            try { await queue.dispose(); }
            finally { await rm(root, { recursive: true, force: true }); }
        }
    });
    await queue.replace(scope, []);
    const file = queue.getHistoryPath(scope.itemId, scope.topicId);
    const before = await readFile(file);
    host = await createTopicMessageAdmissionHost({
        appDataRoot: root, historyQueue: queue,
        validate: async () => { throw new Error('Foreign sender reached validation'); },
        getMainWindow: () => ({ isDestroyed: () => false, webContents: sender }),
        ipcMain: {
            handle: (channel, handler) => handlers.set(channel, handler),
            removeHandler: channel => handlers.delete(channel),
        },
        logger: { warn() {}, error() {}, log() {} },
    });
    const result = await handlers.get('topic-admission:persist-assistant')(
        { sender: { id: 2 } }, scope,
        { id: 'unauthorized', role: 'assistant', content: 'must not be saved' },
    );
    assert.deepEqual(result, { success: false, code: 'FORBIDDEN' });
    assert.deepEqual(await readFile(file), before);
});