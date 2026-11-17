import test from 'node:test';
import assert from 'node:assert/strict';
import { createStreamTransientHistory } from '../modules/chat/streamTransientHistory.js';

test('transient stream history owns pending models without performing durable writes', async () => {
    let current = [{ id: 'user-a', role: 'user', timestamp: 1 }];
    let durableReads = 0;
    const provider = createStreamTransientHistory({
        repository: {
            async getHistory() { durableReads += 1; return [{ id: 'user-b', role: 'user', timestamp: 3 }]; },
            async saveHistory() { assert.fail('transient provider must never perform a durable write'); },
        },
        currentHistory: {
            get: () => current,
            replace: history => { current = history; },
        },
    });

    await provider.prepare({ id: 'assistant-a', replyToMessageId: 'user-a', timestamp: 2 }, { agentId: 'a', topicId: 'current' }, { visible: true });
    assert.equal(provider.pendingCount, 1);
    assert.deepEqual(current.map(message => message.id), ['user-a', 'assistant-a']);

    const finalized = await provider.finalize({
        messageId: 'assistant-a', context: { agentId: 'a', topicId: 'current' },
        content: 'answer', finishReason: 'completed', visible: true,
    });
    assert.equal(finalized.message.content, 'answer');
    assert.equal(finalized.message.isPendingStream, undefined);
    assert.equal(provider.pendingCount, 0);
    assert.equal(durableReads, 0);
});

test('background transient models read latest history and preserve reply ordering', async () => {
    let current = [{ id: 'unrelated', timestamp: 99 }];
    const provider = createStreamTransientHistory({
        repository: {
            async getHistory() {
                return [
                    { id: 'user-a', role: 'user', timestamp: 1 },
                    { id: 'user-b', role: 'user', timestamp: 3 },
                ];
            },
        },
        currentHistory: { get: () => current, replace: history => { current = history; } },
    });
    const context = { agentId: 'background', topicId: 'topic' };
    await provider.prepare({ id: 'assistant-a', replyToMessageId: 'user-a', timestamp: 2 }, context, { visible: false });
    const terminal = await provider.finalize({
        messageId: 'assistant-a', context, content: 'done', finishReason: 'completed', visible: false,
    });
    assert.deepEqual(terminal.history.map(message => message.id), ['user-a', 'assistant-a', 'user-b']);
    assert.deepEqual(current.map(message => message.id), ['unrelated'], 'background projection must not replace current Surface history');
});

test('dispose revokes transient history authority and clears pending models', async () => {
    const provider = createStreamTransientHistory({
        repository: { async getHistory() { return []; } },
        currentHistory: { get: () => [], replace() {} },
    });
    await provider.prepare({ id: 'pending' }, { agentId: 'a', topicId: 't' }, { visible: true });
    provider.dispose();
    assert.equal(provider.pendingCount, 0);
    await assert.rejects(provider.prepare({ id: 'late' }, { agentId: 'a', topicId: 't' }), /disposed/);
    assert.equal(await provider.finalize({ messageId: 'pending' }), null);
});

test('native tool metadata is projected separately from text without durable writes', async () => {
    let current = [];
    const provider = createStreamTransientHistory({
        repository: {
            async getHistory() { return []; },
            async saveHistory() { assert.fail('unexpected durable write'); },
        },
        currentHistory: { get: () => current, replace: value => { current = value; } },
    });
    const context = { agentId: 'agent', topicId: 'topic' };
    await provider.prepare({ id: 'native-message', role: 'assistant' }, context, { visible: true });
    const input = [{
        schema: 1, source: 'agy-native', requestId: 'req-1', callId: 'step:2',
        revision: 0, sequence: 1, name: 'read_file', status: 'running',
        evidence: 'transport_reported', detailsPolicy: 'withheld',
        parameters: { token: 'SYNTHETIC_PRIVATE' }, output: 'SYNTHETIC_PRIVATE',
    }];
    const finalized = await provider.finalize({
        messageId: 'native-message', context, content: 'answer',
        finishReason: 'cancelled', visible: true, nativeToolEvents: input,
    });
    assert.equal(finalized.message.content, 'answer');
    assert.equal(finalized.message.nativeToolEvents[0].status, 'unknown');
    assert.equal(finalized.message.nativeToolEvents[0].evidence, 'missing_terminal');
    assert.equal(JSON.stringify(finalized.history).includes('SYNTHETIC_PRIVATE'), false);
    assert.equal(current[0].nativeToolEvents[0].status, 'unknown');
    assert.equal(input[0].status, 'running', 'input is not mutated');
    assert.equal(provider.pendingCount, 0);
});

test('invalid native snapshots do not consume the pending message', async () => {
    let current = [];
    const provider = createStreamTransientHistory({
        repository: { async getHistory() { return []; } },
        currentHistory: { get: () => current, replace: value => { current = value; } },
    });
    const context = { agentId: 'agent', topicId: 'topic' };
    await provider.prepare({ id: 'pending-native', role: 'assistant' }, context, { visible: true });
    await assert.rejects(provider.finalize({
        messageId: 'pending-native', context, content: 'answer',
        visible: true, nativeToolEvents: [{ source: 'unvalidated' }],
    }), /Invalid native tool history snapshot/);
    assert.equal(provider.pendingCount, 1);
    assert.equal(current[0].isPendingStream, true);
    const finalized = await provider.finalize({
        messageId: 'pending-native', context, content: 'answer',
        finishReason: 'completed', visible: true,
    });
    assert.equal(Object.hasOwn(finalized.message, 'nativeToolEvents'), false);
    assert.equal(finalized.message.content, 'answer');
});
