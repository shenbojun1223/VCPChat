import test from 'node:test';
import assert from 'node:assert/strict';
import { createVcpStreamBridge } from '../modules/chat/vcpStreamBridge.js';
import { createMainChatStreamConsumer } from '../modules/renderer/mainChatStreamConsumer.js';

const waitUntil = async predicate => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
        if (predicate()) return;
        await Promise.resolve();
    }
    assert.fail('stream bridge did not reach its real terminal promise');
};

test('VCP bridge drives one consumer from thinking through persisted terminal', async () => {
    const seen = [];
    const bridge = createVcpStreamBridge({
        createConsumer: () => ({
            normalizeChunk: chunk => chunk.choices[0].delta.content,
            prepare: event => seen.push(`prepare:${event.type}`),
            consume: event => seen.push(`event:${event.type}`),
            persist: value => { seen.push(`persist:${value.terminal.kind}`); return { content: value.snapshot.text }; },
        }),
    });
    assert.equal(bridge.accept({ type: 'agent_thinking', messageId: 'm1', context: { agentId: 'a', topicId: 't' } }), true);
    bridge.accept({ type: 'start', messageId: 'm1', context: { agentId: 'a', topicId: 't' } });
    bridge.accept({ type: 'data', messageId: 'm1', context: { agentId: 'a', topicId: 't' }, chunk: { choices: [{ delta: { content: 'hello' } }] } });
    bridge.accept({ type: 'end', messageId: 'm1', context: { agentId: 'a', topicId: 't' }, finish_reason: 'stop' });
    await waitUntil(() => seen.includes('event:completed'));
    assert.deepEqual(seen, [
        'event:started', 'prepare:agent_thinking', 'prepare:start', 'prepare:data',
        'event:chunk', 'prepare:end', 'persist:completed', 'event:completed',
    ]);
    await bridge.dispose();
});

test('VCP bridge ignores unrelated events and normalizes error once', async () => {
    const terminals = [];
    const bridge = createVcpStreamBridge({
        createConsumer: () => ({
            prepare() {},
            consume: event => {
                if (['completed', 'failed', 'cancelled', 'discarded'].includes(event.type)) terminals.push(event);
            },
            persist() {},
        }),
    });
    assert.equal(bridge.accept({ type: 'remove_message', messageId: 'm2' }), false);
    bridge.accept({ type: 'data', messageId: 'm2', context: { groupId: 'g', topicId: 't' }, chunk: 'partial' });
    bridge.accept({ type: 'error', messageId: 'm2', context: { groupId: 'g', topicId: 't' }, error: 'offline' });
    await waitUntil(() => terminals.length === 1);
    assert.equal(terminals[0].type, 'failed');
    assert.equal(terminals[0].outcome.transport.kind, 'failed');
    await bridge.dispose();
});

test('VCP bridge dispose aborts an externally-driven operation and reaches quiescence', async () => {
    const seen = [];
    const bridge = createVcpStreamBridge({
        createConsumer: () => ({
            prepare() {},
            consume: event => seen.push(event.type),
            persist() { throw new Error('discarded operations must not persist'); },
        }),
    });
    bridge.accept({ type: 'data', messageId: 'pending', context: { agentId: 'a', topicId: 't' }, chunk: 'partial' });
    await bridge.dispose();
    assert.deepEqual(seen, ['started'], 'dispose detaches the consumer before queued projection work can publish');
});

test('one operation can be disposed without a producer terminal and rejects every late event', async () => {
    const seen = [];
    let consumerDisposals = 0;
    const bridge = createVcpStreamBridge({
        createConsumer: () => ({
            prepare: event => seen.push(`prepare:${event.type}`),
            consume: event => seen.push(`event:${event.type}`),
            persist() { assert.fail('a retracted operation must not persist'); },
            dispose() { consumerDisposals += 1; },
        }),
    });
    assert.equal(bridge.accept({ type: 'data', messageId: 'owned', context: { agentId: 'a', topicId: 't' }, chunk: 'partial' }), true);
    await waitUntil(() => seen.includes('event:chunk'));
    const outcome = await bridge.disposeOperation('owned');
    assert.equal(outcome.kind, 'discarded');
    assert.equal(consumerDisposals, 1);
    assert.equal(bridge.accept({ type: 'end', messageId: 'owned', context: { agentId: 'a', topicId: 't' } }), false);
    assert.equal(bridge.accept({ type: 'data', messageId: 'owned', context: { agentId: 'a', topicId: 't' }, chunk: 'late' }), false);
    await bridge.dispose();
});

test('retiring before the first producer event prevents operation creation and stream resurrection', async () => {
    let consumersCreated = 0;
    const bridge = createVcpStreamBridge({
        createConsumer: () => {
            consumersCreated += 1;
            return {};
        },
    });
    assert.equal(await bridge.disposeOperation('before-first-event'), false);
    assert.equal(bridge.accept({ type: 'data', messageId: 'before-first-event', context: { agentId: 'a', topicId: 't' }, chunk: 'late' }), false);
    assert.equal(bridge.accept({ type: 'end', messageId: 'before-first-event', context: { agentId: 'a', topicId: 't' } }), false);
    assert.equal(consumersCreated, 0);

    assert.equal(await bridge.cancelOperation('cancel-before-first-event'), null);
    assert.equal(bridge.accept({ type: 'start', messageId: 'cancel-before-first-event', context: { agentId: 'a', topicId: 't' } }), false);
    assert.equal(consumersCreated, 0);
    await bridge.dispose();
});

test('producer operation identity isolates a same-message retry from delayed events', async () => {
    const seen = [];
    const bridge = createVcpStreamBridge({
        createConsumer: event => ({
            prepare() {},
            consume: item => seen.push(`${event.streamOperationId}:${item.type}`),
            persist() {},
        }),
    });
    bridge.accept({ type: 'data', messageId: 'same-message', streamOperationId: 'attempt-1', context: { agentId: 'a', topicId: 't' }, chunk: 'one' });
    bridge.accept({ type: 'end', messageId: 'same-message', streamOperationId: 'attempt-1', context: { agentId: 'a', topicId: 't' } });
    await waitUntil(() => seen.includes('attempt-1:completed'));
    bridge.accept({ type: 'data', messageId: 'same-message', streamOperationId: 'attempt-2', context: { agentId: 'a', topicId: 't' }, chunk: 'two' });
    assert.equal(bridge.accept({ type: 'data', messageId: 'same-message', streamOperationId: 'attempt-1', context: { agentId: 'a', topicId: 't' }, chunk: 'late-old' }), false);
    bridge.accept({ type: 'end', messageId: 'same-message', streamOperationId: 'attempt-2', context: { agentId: 'a', topicId: 't' } });
    await waitUntil(() => seen.includes('attempt-2:completed'));
    assert.equal(seen.some(item => item.includes('late-old')), false);
    await bridge.dispose();
});

test('local cancellation drains accepted chunks and persists one cancelled terminal', async () => {
    const seen = [];
    const bridge = createVcpStreamBridge({
        createConsumer: () => ({
            prepare: event => seen.push(`prepare:${event.type}`),
            consume: event => seen.push(`event:${event.type}`),
            persist: value => { seen.push(`persist:${value.terminal.kind}`); },
        }),
    });
    bridge.accept({ type: 'data', messageId: 'cancel-local', context: { agentId: 'a', topicId: 't' }, chunk: 'partial' });
    const outcome = await bridge.cancelOperation('cancel-local', 'backend-interrupt-failed');
    assert.equal(outcome.kind, 'cancelled');
    assert.deepEqual(seen, [
        'event:started', 'prepare:data', 'event:chunk', 'persist:cancelled', 'event:cancelled',
    ]);
    assert.equal(bridge.accept({ type: 'end', messageId: 'cancel-local', context: { agentId: 'a', topicId: 't' } }), false);
    await bridge.dispose();
});

test('VCP bridge serializes deferred prepare before immediate chunk and terminal', async () => {
    const seen = [];
    let releasePrepare;
    const prepareGate = new Promise(resolve => { releasePrepare = resolve; });
    const bridge = createVcpStreamBridge({
        createConsumer: () => ({
            async prepare(event) {
                seen.push(`prepare-start:${event.type}`);
                if (event.type === 'data') await prepareGate;
                seen.push(`prepare-end:${event.type}`);
            },
            consume: event => seen.push(`event:${event.type}`),
            persist: value => { seen.push(`persist:${value.terminal.kind}`); },
        }),
    });
    bridge.accept({ type: 'data', messageId: 'fast', context: { agentId: 'a', topicId: 't' }, chunk: 'x' });
    bridge.accept({ type: 'end', messageId: 'fast', context: { agentId: 'a', topicId: 't' } });
    await Promise.resolve();
    assert.deepEqual(seen, ['event:started', 'prepare-start:data']);
    releasePrepare();
    await waitUntil(() => seen.includes('event:completed'));
    assert.deepEqual(seen, [
        'event:started', 'prepare-start:data', 'prepare-end:data', 'event:chunk',
        'prepare-start:end', 'prepare-end:end', 'persist:completed', 'event:completed',
    ]);
    await bridge.dispose();
});

test('projection failure silences already queued events and cannot commit a partial terminal', async () => {
    const seen = [];
    // Fail the first projection before queuing an end event synchronously.
    const failingBridge = createVcpStreamBridge({
        reportError: () => {},
        createConsumer: event => createMainChatStreamConsumer(event, {
            start: async () => { throw new Error('controlled projection failure'); },
            append: () => {},
            projectTerminal: async () => { seen.push('unexpected-project-terminal'); return { id: event.messageId }; },
            persistTerminal: async () => { seen.push('unexpected-persist-terminal'); },
        }),
    });
    failingBridge.accept({ type: 'data', messageId: 'projection-failure', context: { agentId: 'a', topicId: 't' }, chunk: 'x' });
    failingBridge.accept({ type: 'end', messageId: 'projection-failure', context: { agentId: 'a', topicId: 't' } });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(seen.includes('unexpected-project-terminal'), false);
    assert.equal(seen.includes('unexpected-persist-terminal'), false);
    await failingBridge.dispose();
});

test('missing terminal projection becomes one persistence failure instead of a completed no-op', async () => {
    const terminals = [];
    const bridge = createVcpStreamBridge({
        reportError: () => {},
        createConsumer: event => {
            const consumer = createMainChatStreamConsumer(event, {
                start() {},
                append() {},
                async projectTerminal() { return null; },
                async persistTerminal() { assert.fail('a missing projection must not be committed'); },
                renderError() {},
                dispatchTerminal() {},
                getSurfaceGeneration: () => 0,
            });
            return Object.freeze({
                ...consumer,
                consume(streamEvent) {
                    if (['completed', 'failed', 'cancelled', 'discarded'].includes(streamEvent.type)) terminals.push(streamEvent);
                    consumer.consume(streamEvent);
                },
            });
        },
    });
    bridge.accept({ type: 'end', messageId: 'missing', context: { agentId: 'a', topicId: 't' } });
    await waitUntil(() => terminals.length === 1);
    assert.equal(terminals[0].type, 'failed');
    assert.equal(terminals[0].outcome.phase, 'persistence');
    await bridge.dispose();
});

test('post-commit side effect failure is reported without changing the durable completed outcome', async () => {
    const terminals = [];
    const reports = [];
    let committed = false;
    const bridge = createVcpStreamBridge({
        reportError: (...args) => reports.push(args),
        createConsumer: event => {
            const consumer = createMainChatStreamConsumer(event, {
                start() {},
                append() {},
                async projectTerminal() {
                    return { messageId: 'post-commit', context: event.context, history: [], finishReason: 'completed' };
                },
                async persistTerminal(value) { committed = true; return value; },
                async afterPersist() { throw new Error('summary failed'); },
                reportError: (...args) => reports.push(args),
                getSurfaceGeneration: () => 0,
            });
            return Object.freeze({
                ...consumer,
                consume(streamEvent) {
                    if (['completed', 'failed', 'cancelled', 'discarded'].includes(streamEvent.type)) terminals.push(streamEvent);
                    consumer.consume(streamEvent);
                },
            });
        },
    });
    bridge.accept({ type: 'end', messageId: 'post-commit', context: { agentId: 'a', topicId: 't' } });
    await waitUntil(() => terminals.length === 1);
    assert.equal(committed, true);
    assert.equal(terminals[0].type, 'completed');
    assert.equal(terminals[0].outcome.persistence.status, 'saved');
    assert.equal(reports.some(([, error]) => error?.message === 'summary failed'), true);
    await bridge.dispose();
});

for (const cancelled of [false, true]) {
    test(`native metadata remains separate through real stream consumer (${cancelled ? 'cancelled' : 'completed'})`, async () => {
        const appended = [];
        const saved = [];
        let settled = false;
        const context = { agentId: 'native-agent', topicId: 'native-topic' };
        const identity = {
            messageId: 'native-message',
            streamOperationId: `native-operation-${cancelled}`,
            context,
        };
        const native = {
            schema: 1, source: 'agy-native', requestId: 'request-1',
            callId: 'step:2', revision: 0, sequence: 1,
            name: 'read_file', status: 'running',
            evidence: 'transport_reported', detailsPolicy: 'withheld',
        };
        const bridge = createVcpStreamBridge({
            createConsumer: initial => createMainChatStreamConsumer(initial, {
                start() {},
                append(messageId, chunk, owner, operationId) {
                    assert.equal(messageId, identity.messageId);
                    assert.equal(owner.topicId, context.topicId);
                    assert.equal(operationId, identity.streamOperationId);
                    appended.push(chunk);
                },
                projectTerminal(messageId, finishReason, owner, payload) {
                    return { messageId, finishReason, context: owner, ...payload };
                },
                persistTerminal(projected) {
                    saved.push(projected);
                    return projected;
                },
                onSettled() { settled = true; },
                reportError(...args) { assert.fail(String(args)); },
            }),
        });
        try {
            bridge.accept({ ...identity, type: 'start' });
            bridge.accept({
                ...identity, type: 'data',
                chunk: {
                    id: native.requestId, object: 'chat.completion.chunk',
                    choices: [{ index: 0, delta: {}, finish_reason: null }],
                    vcp_native_tool: { ...native, parameters: { secret: 'PRIVATE_VALUE' } },
                },
            });
            bridge.accept({
                ...identity, type: 'data',
                chunk: { choices: [{ delta: { content: 'answer' } }] },
            });
            if (!cancelled) {
                bridge.accept({
                    ...identity, type: 'data',
                    chunk: {
                        id: native.requestId, object: 'chat.completion.chunk',
                        choices: [{ index: 0, delta: {}, finish_reason: null }],
                        vcp_native_tool: {
                            ...native, revision: 1, sequence: 2, status: 'succeeded',
                        },
                    },
                });
            }
            bridge.accept({
                ...identity, type: 'end',
                finish_reason: cancelled ? 'cancelled' : 'stop',
                fullResponse: 'answer',
            });
            await waitUntil(() => settled);
            assert.equal(saved.length, 1);
            assert.equal(saved[0].fullResponse, 'answer');
            assert.equal(saved[0].nativeToolEvents.length, 1);
            const final = saved[0].nativeToolEvents[0];
            assert.equal(final.status, cancelled ? 'unknown' : 'succeeded');
            assert.equal(final.evidence, cancelled ? 'missing_terminal' : 'transport_reported');
            assert.equal(JSON.stringify(saved).includes('PRIVATE_VALUE'), false);
            assert.equal(appended.filter(chunk => typeof chunk === 'string').join(''), 'answer');
            assert.equal(appended.filter(chunk => chunk?.vcp_native_tool).length, cancelled ? 1 : 2);
            assert.equal(bridge.accept({
                ...identity, type: 'data', chunk: { vcp_native_tool: native },
            }), false, 'late events must not resurrect the completed operation');
        } finally {
            await bridge.dispose();
        }
    });
}

test('explicit upstream failure status overrides transport stop without losing partial text', async () => {
    const outcomes = [];
    const persisted = [];
    const identity = {
        messageId: 'upstream-failed-message',
        streamOperationId: 'upstream-failed-operation',
        context: { agentId: 'agent', topicId: 'topic' },
    };
    const bridge = createVcpStreamBridge({
        createConsumer: () => ({
            prepare() {},
            normalizeChunk: chunk => chunk.choices?.[0]?.delta?.content || '',
            consume(event) {
                if (['completed', 'failed', 'cancelled', 'discarded'].includes(event.type)) {
                    outcomes.push(event);
                }
            },
            persist(value) {
                persisted.push(value);
                return { content: value.snapshot.text };
            },
        }),
    });
    try {
        bridge.accept({
            ...identity, type: 'data',
            chunk: { choices: [{ delta: { content: 'partial answer' } }] },
        });
        bridge.accept({
            ...identity, type: 'end', finish_reason: 'stop',
            fullResponse: 'partial answer',
            vcp_status: { code: 'UPSTREAM_STREAM_ERROR' },
        });
        await waitUntil(() => outcomes.length === 1);
        assert.equal(outcomes[0].type, 'failed');
        assert.equal(persisted.length, 1);
        assert.equal(persisted[0].terminal.kind, 'failed');
        assert.equal(persisted[0].terminal.fullResponse, 'partial answer');
        assert.equal(persisted[0].snapshot.text, 'partial answer');
    } finally {
        await bridge.dispose();
    }
});

for (const [label, endFields, expected] of [
    ['incomplete', { finish_reason: 'stop', vcp_status: { code: 'UPSTREAM_STREAM_INCOMPLETE' } }, 'failed'],
    ['user cancellation', { finish_reason: 'cancelled_by_user', vcp_status: { code: 'UPSTREAM_STREAM_ERROR' } }, 'cancelled'],
    ['interrupted flag', { finish_reason: 'stop', interrupted: true, vcp_status: { code: 'UPSTREAM_STREAM_ERROR' } }, 'cancelled'],
    ['unknown status', { finish_reason: 'stop', vcp_status: { code: 'FUTURE_INFORMATIONAL_STATUS' } }, 'completed'],
    ['native failure alone', { finish_reason: 'stop', vcp_native_tool: { status: 'failed' } }, 'completed'],
    ['ordinary success', { finish_reason: 'stop' }, 'completed'],
]) {
    test(`stream terminal classification: ${label}`, async () => {
        let outcome, stored;
        const bridge = createVcpStreamBridge({
            createConsumer: () => ({
                prepare() {},
                consume(event) {
                    if (['completed', 'failed', 'cancelled', 'discarded'].includes(event.type)) outcome = event;
                },
                persist(value) { stored = value; },
            }),
        });
        try {
            bridge.accept({
                type: 'end', messageId: 'terminal-matrix',
                streamOperationId: 'terminal-matrix-operation',
                context: { agentId: 'agent', topicId: 'topic' },
                fullResponse: 'retained answer', ...endFields,
            });
            await waitUntil(() => Boolean(outcome));
            assert.equal(outcome.type, expected);
            assert.equal(stored.terminal.kind, expected);
            assert.equal(stored.terminal.fullResponse, 'retained answer');
        } finally { await bridge.dispose(); }
    });
}
test('native display rejects mismatched frames while preserving text and separate upstream rounds', async () => {
    const appended = [], saved = [];
    let settled = false;
    const identity = {
        messageId: 'native-binding-message', streamOperationId: 'native-binding-operation',
        context: { agentId: 'agent-binding', topicId: 'topic-binding' },
    };
    const metadata = changes => ({
        schema: 1, source: 'agy-native', requestId: 'request-one',
        callId: 'step:2', revision: 0, sequence: 1, name: 'manage_task',
        status: 'running', evidence: 'transport_reported', detailsPolicy: 'withheld', ...changes,
    });
    const frame = (native, changes = {}) => ({
        id: native.requestId, object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: {}, finish_reason: null }],
        vcp_native_tool: native, ...changes,
    });
    const bridge = createVcpStreamBridge({
        createConsumer: initial => createMainChatStreamConsumer(initial, {
            start() {},
            append(messageId, chunk, context, operationId) {
                assert.equal(messageId, identity.messageId);
                assert.equal(context.topicId, identity.context.topicId);
                assert.equal(operationId, identity.streamOperationId);
                appended.push(chunk);
            },
            projectTerminal(messageId, finishReason, context, payload) {
                return { messageId, finishReason, context, ...payload };
            },
            persistTerminal(projected) { saved.push(projected); return projected; },
            onSettled() { settled = true; },
            reportError(...args) { assert.fail(String(args)); },
        }),
    });
    const send = chunk => bridge.accept({ ...identity, type: 'data', chunk });
    try {
        bridge.accept({ ...identity, type: 'start' });
        send(frame(metadata({ callId: 'step:90' }), { id: 'foreign-envelope' }));
        send(frame(metadata({ callId: 'step:91' }), { id: undefined }));
        send(frame(metadata({ callId: 'step:92' }), {
            choices: [{ index: 0, delta: { content: 'ordinary text' }, finish_reason: null }],
        }));
        send(frame(metadata(), {
            choices: [{ index: 0, delta: { content: '' }, finish_reason: null }],
        }));
        send(frame(metadata({ revision: 1, sequence: 2, status: 'failed' })));
        send(frame(metadata({ requestId: 'request-two' })));
        bridge.accept({ ...identity, type: 'end', finish_reason: 'stop', fullResponse: 'ordinary text' });
        await waitUntil(() => settled);
        assert.equal(saved.length, 1);
        assert.equal(saved[0].finishReason, 'completed');
        assert.equal(saved[0].fullResponse, 'ordinary text');
        assert.deepEqual(saved[0].nativeToolEvents.map(x => [x.requestId, x.callId, x.status]), [
            ['request-one', 'step:2', 'failed'], ['request-two', 'step:2', 'unknown'],
        ]);
        assert.equal(appended.filter(x => x?.vcp_native_tool).length, 3);
        assert.equal(appended.filter(x => typeof x === 'string').join(''), 'ordinary text');
        assert.equal(bridge.accept({
            ...identity, type: 'data', chunk: frame(metadata({ requestId: 'request-three' })),
        }), false);
    } finally { await bridge.dispose(); }
});
