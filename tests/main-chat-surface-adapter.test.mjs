import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createMainChatSurfaceAdapter } from '../modules/renderer/mainChatSurfaceAdapter.js';
import { createMainChatSendOwner } from '../modules/renderer/mainChatSendOwner.js';

test('MainChatSurfaceAdapter owns renderer, stream routes and quiescent teardown', async () => {
    const dom = new JSDOM('<main><div id="root"></div><textarea></textarea></main>');
    const root = dom.window.document.getElementById('root');
    let initialized = null;
    let rendererDisposed = false;
    const renderer = {
        initializeMessageRenderer(value) { initialized = value; },
        renderHistory() {}, renderMessage() {},
    };
    const adapter = createMainChatSurfaceAdapter({
        root,
        renderer,
        repository: { getHistory: async () => [], saveHistory() {} },
        focusTarget: dom.window.document.querySelector('textarea'),
        operations: { dispose: async () => {} },
        renderDependencies: {},
        streamServices: {
            streamProjection: {
                startStreamingMessage() {}, appendStreamChunk() {}, projectStreamTerminal() {},
            },
            historyPersistence: { commit() {} },
            messageRenderer: renderer,
            getSelection: () => null,
            getTopicId: () => null,
        },
        disposeRenderer: async () => { rendererDisposed = true; },
    });
    assert.equal(initialized.chatDomRenderer, adapter.domRenderer);
    const release = adapter.streamRoutes.register('m1', { kind: 'main-chat' });
    assert.equal(typeof release.retract, 'function');
    assert.equal(typeof release.cancel, 'function');
    release();
    await adapter.dispose();
    assert.equal(rendererDisposed, true);
    assert.equal(root.hasAttribute('data-chat-surface'), false);
    assert.throws(() => adapter.streamRoutes.register('late', {}), /disposed/);
});

test('MainChatSurfaceAdapter owns the window unload receipt and releases it on dispose', async () => {
    const dom = new JSDOM('<main><div id="root"></div><textarea></textarea>');
    const root = dom.window.document.getElementById('root');
    let disposed = 0;
    const renderer = { initializeMessageRenderer() {}, renderHistory() {}, renderMessage() {} };
    const adapter = createMainChatSurfaceAdapter({
        root,
        renderer,
        repository: { getHistory: async () => [], saveHistory() {} },
        focusTarget: dom.window.document.querySelector('textarea'),
        operations: { dispose: async () => {} },
        renderDependencies: {},
        streamServices: {
            streamProjection: { startStreamingMessage() {}, appendStreamChunk() {}, projectStreamTerminal() {} },
            historyPersistence: { commit() {} },
            messageRenderer: renderer,
            getSelection: () => null,
            getTopicId: () => null,
        },
        disposeRenderer: async () => { disposed += 1; },
        ownerWindow: dom.window,
    });
    dom.window.dispatchEvent(new dom.window.Event('beforeunload'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(disposed, 1);
    await adapter.dispose();
    dom.window.close();
});

test('main Surface lights the composer during an IPC group reply and clears it at the terminal', async t => {
    const dom = new JSDOM('<main><div id="root"></div><textarea></textarea>');
    const root = dom.window.document.getElementById('root');
    const renderer = { initializeMessageRenderer() {}, renderHistory() {}, renderMessage() {} };
    const composer = dom.window.document.createElement('div');
    composer.className = 'chat-input-card';
    const button = dom.window.document.createElement('button');
    composer.append(button);
    root.after(composer);
    const selection = { id: 'group-a', type: 'group' };
    const topicId = 'topic-a';
    const context = { groupId: selection.id, agentId: 'agent-a', topicId, isGroupMessage: true };
    let active = null;
    const streamProjection = {
        async startStreamingMessage(message) { active = message; },
        appendStreamChunk() {},
        getActiveStreamingMessageId: () => active?.id,
        getActiveStreamingContext: () => active?.context,
        async projectStreamTerminal(messageId, finishReason, context, payload) {
            active = null;
            return { messageId, finishReason, context, content: payload.fullResponse, history: [] };
        },
    };
    const sendOwner = createMainChatSendOwner({
        button,
        messagesRoot: root,
        historyRef: { get: () => [] },
        selectedItemRef: { get: () => selection },
        topicIdRef: { get: () => topicId },
        streamProjection,
        getChatManager: () => null,
        hasDraft: () => true,
    });
    let settled;
    const terminalSettled = new Promise(resolve => { settled = resolve; });
    const adapter = createMainChatSurfaceAdapter({
        root,
        renderer,
        repository: { getHistory: async () => [], saveHistory() {} },
        focusTarget: dom.window.document.querySelector('textarea'),
        operations: { dispose: async () => {} },
        renderDependencies: {},
        streamServices: {
            streamProjection,
            historyPersistence: { commit: projected => projected },
            messageRenderer: renderer,
            getSelection: () => selection,
            getTopicId: () => topicId,
            notifySendStateChanged: value => {
                sendOwner.update();
                if (value?.event?.type === 'completed') settled(value);
            },
        },
        disposeRenderer: async () => {},
    });
    t.after(async () => {
        await adapter.dispose();
        sendOwner.dispose();
        dom.window.close();
    });
    assert.equal(composer.classList.contains('has-streaming-reply'), false);
    assert.equal(adapter.acceptStreamEvent({ type: 'agent_thinking', messageId: 'm1', streamOperationId: 'op1', context }), true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(composer.classList.contains('has-streaming-reply'), true);
    assert.equal(composer.querySelector('button').dataset.mode, 'send');
    assert.equal(adapter.acceptStreamEvent({ type: 'end', messageId: 'm1', streamOperationId: 'op1', context, fullResponse: 'done', finish_reason: 'completed' }), true);
    const outcome = await terminalSettled;
    assert.equal(outcome.event.type, 'completed');
    assert.equal(composer.classList.contains('has-streaming-reply'), false);
});

// 心流锁按助手加锁；侧聊回复若进入心流锁，会把整个助手锁到隐藏的侧聊话题上，主聊天无法切换话题
test('side chat replies never reach the Flowlock manager; main topic replies still do', async () => {
    const dom = new JSDOM('<main><div id="root"></div><textarea></textarea>');
    const root = dom.window.document.getElementById('root');
    const renderer = { initializeMessageRenderer() {}, renderHistory() {}, renderMessage() {} };
    const flowlockTopics = [];
    const settledIds = [];
    const adapter = createMainChatSurfaceAdapter({
        root,
        renderer,
        repository: { getHistory: async () => [], saveHistory() {} },
        focusTarget: dom.window.document.querySelector('textarea'),
        operations: { dispose: async () => {} },
        renderDependencies: {},
        streamServices: {
            streamProjection: {
                startStreamingMessage() {},
                appendStreamChunk() {},
                projectStreamTerminal: async (messageId, finishReason, context, payload) => ({
                    messageId, finishReason, context, content: payload.fullResponse, history: [],
                }),
            },
            historyPersistence: { commit: projected => projected },
            messageRenderer: renderer,
            getSelection: () => ({ id: 'agent-a' }),
            getTopicId: () => 'topic-a',
            flowlockManager: { handleFinalizedMessage: async event => { flowlockTopics.push(event.context.topicId); } },
            notifySendStateChanged: value => { if (value?.messageId) settledIds.push(value.messageId); },
        },
        disposeRenderer: async () => {},
    });
    const send = (messageId, topicId) => {
        const context = { agentId: 'agent-a', topicId };
        adapter.acceptStreamEvent({ type: 'start', messageId, streamOperationId: messageId, context });
        adapter.acceptStreamEvent({ type: 'end', messageId, streamOperationId: messageId, context, fullResponse: '[[Flowlock::Start]]', finish_reason: 'completed' });
    };
    send('side-1', 'sidechat_1791000000000_abc123');
    send('main-1', 'topic-a');
    const deadline = Date.now() + 3000;
    while (!(flowlockTopics.length && settledIds.includes('side-1'))) {
        assert.ok(Date.now() < deadline, 'stream terminals did not settle');
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(flowlockTopics, ['topic-a']);
    await adapter.dispose();
    dom.window.close();
});

test('manual tool pause waits for the saved reply and skips the normal relay and claim paths', { timeout: 8000 }, async () => {
    const dom = new JSDOM('<main><div id="root"></div><textarea></textarea></main>');
    const root = dom.window.document.getElementById('root');
    const context = { agentId: 'fixture-agent', topicId: 'fixture-topic', admissionToken: 'fixture-lease' };
    const id = 'fixture-message';
    const order = [];
    const observed = {};
    let finishCommit, settled = false;
    const committed = new Promise(resolve => { finishCommit = resolve; });
    const waitFor = async predicate => {
        const until = Date.now() + 2500;
        while (!predicate()) {
            assert.ok(Date.now() < until, 'public surface did not reach the expected state');
            await new Promise(resolve => setTimeout(resolve, 5));
        }
    };
    dom.window.chatAPI = { async topicAdmissionRelease(scope, token, options) {
        order.push('release'); observed.release = [scope.itemId, scope.topicId, token, options.saved];
        return { success: true };
    }};
    const renderer = { initializeMessageRenderer() {}, renderHistory() {}, renderMessage() {} };
    const adapter = createMainChatSurfaceAdapter({
        root, renderer, repository: { getHistory: async () => [], saveHistory() {} },
        focusTarget: dom.window.document.querySelector('textarea'), operations: { dispose: async () => {} },
        renderDependencies: {}, disposeRenderer: async () => {},
        streamServices: {
            streamProjection: {
                startStreamingMessage() {}, appendStreamChunk() {},
                projectStreamTerminal(messageId, finishReason, owner, payload) {
                    return { messageId, finishReason, context: owner, content: payload.fullResponse, history: [] };
                },
            },
            historyPersistence: { async commit(value) {
                observed.projected = [value.finishReason, value.content];
                order.push('saving'); await committed; order.push('saved'); return value;
            }},
            chatManager: {
                cancelManualStreamContinuation(messageId, owner) {
                    order.push('cancel-intent'); observed.cancel = [messageId, owner.topicId]; return null;
                },
                hasStreamAdmissionRelay: () => true,
                finishStreamAdmissionRelay() { order.push('unexpected-relay'); },
                attemptTopicSummarizationIfNeeded() { order.push('unexpected-summary'); },
                finishStreamContextCompaction() { order.push('unexpected-compaction'); },
            },
            flowlockManager: { handleFinalizedMessage(event) {
                order.push(event.requiresManualContinuation === true ? 'manual-stop-gate' : 'unexpected-normal-flow');
                observed.flow = [event.messageId, event.context.topicId, event.finishReason];
            }},
            messageRenderer: renderer, getSelection: () => ({ id: context.agentId }), getTopicId: () => context.topicId,
            notifySendStateChanged(value) { if (value?.event?.outcome) settled = true; },
        },
    });
    try {
        const identity = { messageId: id, streamOperationId: id, context };
        adapter.acceptStreamEvent({ ...identity, type: 'start' });
        adapter.acceptStreamEvent({ ...identity, type: 'end', fullResponse: 'saved partial reply',
            finish_reason: 'length', vcp_status: { code: 'VCP_TOOL_LOOP_LIMIT' } });
        await waitFor(() => order.includes('saving'));
        assert.deepEqual(order, ['saving']);
        finishCommit();
        await waitFor(() => settled);
        assert.deepEqual(order, ['saving', 'saved', 'cancel-intent', 'manual-stop-gate', 'release']);
        assert.deepEqual(observed.projected, ['VCP_TOOL_LOOP_LIMIT', 'saved partial reply']);
        assert.deepEqual(observed.cancel, [id, context.topicId]);
        assert.deepEqual(observed.flow, [id, context.topicId, 'VCP_TOOL_LOOP_LIMIT']);
        assert.deepEqual(observed.release, [context.agentId, context.topicId, context.admissionToken, true]);
    } finally { finishCommit(); await adapter.dispose(); dom.window.close(); }
});
