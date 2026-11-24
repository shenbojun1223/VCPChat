import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createVcpStreamBridge } from '../modules/chat/vcpStreamBridge.js';
import { createMainChatStreamConsumer } from '../modules/renderer/mainChatStreamConsumer.js';

for (const [label, wire, code, reason, manual] of [
    ['output length', 'length', null, 'length', true],
    ['incomplete tool block', 'stop', 'VCP_TOOL_BLOCK_INCOMPLETE', 'VCP_TOOL_BLOCK_INCOMPLETE', true],
    ['tool loop stuck', 'stop', 'VCP_TOOL_LOOP_STUCK', 'VCP_TOOL_LOOP_STUCK', true],
    ['tool loop limit', 'length', 'VCP_TOOL_LOOP_LIMIT', 'VCP_TOOL_LOOP_LIMIT', true],
    ['ordinary stop', 'stop', null, 'completed', false],
    ['informational status', 'stop', 'FUTURE_INFORMATIONAL_STATUS', 'completed', false],
    ['explicit cancel wins', 'cancelled_by_user', 'VCP_TOOL_LOOP_STUCK', 'cancelled', false],
    ['explicit upstream failure wins', 'length', 'UPSTREAM_STREAM_ERROR', 'failed', false],
]) {
    test('main consumer saves once: ' + label, async () => {
        const saved = [], after = [];
        let settled = false;
        const id = { messageId: 'fixture-m', streamOperationId: 'fixture-op',
            context: { agentId: 'fixture-agent', topicId: 'fixture-topic' } };
        const bridge = createVcpStreamBridge({
            reportError() {},
            createConsumer: initial => createMainChatStreamConsumer(initial, {
                start() {}, append() {},
                projectTerminal(messageId, finishReason, context, payload) {
                    return { messageId, finishReason, context, ...payload };
                },
                persistTerminal(projected) { saved.push(projected); return projected; },
                afterPersist({ terminal }) { after.push(terminal); },
                onSettled() { settled = true; },
            }),
        });
        try {
            bridge.accept({ ...id, type: 'start' });
            bridge.accept({ ...id, type: 'data', chunk: { choices: [{ index: 0, delta: { content: 'partial answer' } }] } });
            bridge.accept({ ...id, type: 'end', finish_reason: wire, fullResponse: 'partial answer',
                ...(code ? { vcp_status: { code } } : {}) });
            const deadline = Date.now() + 2000;
            while (!settled && Date.now() < deadline) await delay(5);
            assert.equal(settled, true);
            assert.equal(saved.length, 1, 'partial text must reach the commit capability once');
            assert.equal(after.length, 1);
            assert.equal(saved[0].finishReason, reason);
            if (reason === 'failed') assert.ok(saved[0].fullResponse.startsWith('partial answer'));
            else assert.equal(saved[0].fullResponse, 'partial answer');
            assert.equal(after[0].requiresManualContinuation === true, manual);
        } finally { await bridge.dispose(); }
    });
}
