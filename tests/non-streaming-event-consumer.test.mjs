import test from 'node:test';
import assert from 'node:assert/strict';
import { createNonStreamingEventConsumer } from '../modules/renderer/nonStreamingEventConsumer.js';

test('non-streaming consumer projects only already-persisted current-surface events', async () => {
    const calls = [];
    const renderTarget = {
        root: {},
        removeMessage(id, save) { calls.push(['remove', id, save]); },
    };
    const messageRenderer = {
        renderFullMessageProjection(...args) { calls.push(['full', ...args]); return Promise.resolve(); },
    };
    const consumer = createNonStreamingEventConsumer({
        renderTarget,
        messageRenderer,
        viewAuthority: { isCurrent: context => context?.topicId === 'current' },
    });
    assert.equal(await consumer.consume({ type: 'full_response', messageId: 'm1', fullResponse: 'ok', context: { topicId: 'background' } }), true);
    assert.equal(await consumer.consume({ type: 'full_response', messageId: 'm1', fullResponse: 'ok', context: { topicId: 'current' } }), true);
    assert.equal(await consumer.consume({ type: 'remove_message', messageId: 'm1', context: { topicId: 'current' } }), true);
    assert.deepEqual(calls.map(call => call[0]), ['full', 'remove']);
    assert.equal(calls[1][2], false);
    consumer.dispose();
    assert.equal(await consumer.consume({ type: 'remove_message', messageId: 'm2', context: { topicId: 'current' } }), false);
});

for (const [label, fields, reason, manual] of [
    ['legacy success', {}, 'completed', false],
    ['explicit tool pause', { finishReason: 'VCP_TOOL_LOOP_STUCK', requiresManualContinuation: true }, 'VCP_TOOL_LOOP_STUCK', true],
    ['length pause', { finishReason: 'length', requiresManualContinuation: true }, 'length', true],
]) {
    test('group full_response terminal: ' + label, async t => {
        const prior = Object.getOwnPropertyDescriptor(globalThis, 'window');
        const delivered = [], rendered = [];
        Object.defineProperty(globalThis, 'window', { configurable: true, value: {
            flowlockManager: { async handleFinalizedMessage(event) { delivered.push(event); } },
        } });
        t.after(() => {
            if (prior) Object.defineProperty(globalThis, 'window', prior);
            else delete globalThis.window;
        });
        const groupContext = { groupId: 'fixture-group', agentId: 'fixture-agent', topicId: 'fixture-topic', isGroupMessage: true };
        const c = createNonStreamingEventConsumer({
            renderTarget: { root: {} }, viewAuthority: { isCurrent: () => true },
            messageRenderer: { renderFullMessageProjection(_id, text) { rendered.push(text); } },
        });
        try {
            assert.equal(await c.consume({ type: 'full_response', messageId: 'reply-1', context: groupContext,
                fullResponse: 'retained group reply', ...fields }), true);
            assert.deepEqual(rendered, ['retained group reply']);
            assert.equal(delivered.length, 1);
            const event = delivered[0];
            assert.equal(event.messageId, 'reply-1');
            assert.equal(event.context, groupContext);
            assert.equal(event.content, 'retained group reply');
            assert.deepEqual([event.type, event.finishReason, event.requiresManualContinuation === true], ['end', reason, manual]);
        } finally { await c.dispose?.(); }
    });
}
