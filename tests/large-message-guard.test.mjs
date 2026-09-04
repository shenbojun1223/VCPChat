import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
    LARGE_MESSAGE_PAGE_CHARS,
    LARGE_MESSAGE_THRESHOLDS,
    classifyLargeMessage,
    clearLargeMessageGuard,
    mountLargeMessageGuard,
} from '../modules/renderer/largeMessageGuard.js';

const waitForTurn = () => new Promise(resolve => setTimeout(resolve, 20));

test('large-message thresholds classify the four safety bands', () => {
    assert.equal(classifyLargeMessage(LARGE_MESSAGE_THRESHOLDS.folded - 1), null);
    assert.equal(classifyLargeMessage(LARGE_MESSAGE_THRESHOLDS.folded), 'folded');
    assert.equal(classifyLargeMessage(LARGE_MESSAGE_THRESHOLDS.plaintext), 'plaintext');
    assert.equal(classifyLargeMessage(LARGE_MESSAGE_THRESHOLDS.blocked), 'blocked');
    assert.equal(classifyLargeMessage(1024 * 1024), 'blocked');
});

test('guard keeps oversized text out of the DOM and exposes bounded pages', () => {
    const dom = new JSDOM('<!doctype html><div class="message-item"><div class="md-content"></div></div>');
    const messageItem = dom.window.document.querySelector('.message-item');
    const contentDiv = dom.window.document.querySelector('.md-content');
    const text = `${'A'.repeat(220 * 1024)}<script>window.__unsafe = true</script>`;

    const result = mountLargeMessageGuard({ messageItem, contentDiv, text });

    assert.deepEqual(result, { guarded: true, created: true, tier: 'plaintext' });
    assert.equal(messageItem.dataset.vcpLargeMessageTier, 'plaintext');
    assert.equal(contentDiv.querySelector('script'), null);
    assert.ok(
        contentDiv.textContent.length < 12_000,
        'collapsed guard must not place the full oversized message in the DOM',
    );

    const formattedButton = contentDiv.querySelector('.vcp-large-message-guard__button--warning');
    assert.equal(formattedButton.hidden, true, '200 KB+ messages cannot request formatted rendering');

    contentDiv.querySelector('.vcp-large-message-guard__button').click();
    const page = contentDiv.querySelector('.vcp-large-message-guard__page');
    assert.equal(page.textContent.length, LARGE_MESSAGE_PAGE_CHARS);
    assert.match(contentDiv.querySelector('.vcp-large-message-guard__page-status').textContent, /第 1 \//);

    const next = [...contentDiv.querySelectorAll('.vcp-large-message-guard__pager-controls button')]
        .find(button => button.textContent === '下一页');
    next.click();
    assert.match(contentDiv.querySelector('.vcp-large-message-guard__page-status').textContent, /第 2 \//);
    assert.ok(page.textContent.length <= LARGE_MESSAGE_PAGE_CHARS);

    clearLargeMessageGuard(messageItem);
    assert.equal(messageItem._vcpLargeMessageController, undefined);
    assert.equal(messageItem.classList.contains('vcp-large-message-guarded'), false);
    dom.window.close();
});

test('folded band requires two clicks before optional formatted rendering', async () => {
    const dom = new JSDOM('<!doctype html><div class="message-item"><div class="md-content"></div></div>');
    const messageItem = dom.window.document.querySelector('.message-item');
    const contentDiv = dom.window.document.querySelector('.md-content');
    let formattedCalls = 0;

    mountLargeMessageGuard({
        messageItem,
        contentDiv,
        text: 'B'.repeat(60 * 1024),
        allowFormattedRender: true,
        onRenderFormatted: async () => {
            formattedCalls += 1;
        },
    });

    const formattedButton = contentDiv.querySelector('.vcp-large-message-guard__button--warning');
    assert.equal(formattedButton.hidden, false);

    formattedButton.click();
    assert.equal(formattedCalls, 0);
    assert.equal(formattedButton.classList.contains('is-armed'), true);

    formattedButton.click();
    await waitForTurn();
    assert.equal(formattedCalls, 1);

    clearLargeMessageGuard(messageItem);
    dom.window.close();
});

function createRef(initialValue) {
    let value = initialValue;
    return {
        get: () => value,
        set: nextValue => { value = nextValue; },
    };
}

function createVisibilityStub() {
    return {
        initializeVisibilityOptimizer() {},
        observeMessage() {},
        unobserveMessage() {},
        destroyVisibilityOptimizer() {},
        isMessageInHotZone: () => true,
        recheckVisibility() {},
        registerAnimeInstance() {},
        registerThreeContext() {},
        registerCanvasAnimation() {},
        isMessagePaused: () => false,
        createPausableRAF: () => callback => setTimeout(() => callback(Date.now()), 0),
        createPausableTimerAPI: () => ({
            setTimeout,
            clearTimeout,
            setInterval,
            clearInterval,
        }),
    };
}

test('message renderer bypasses Markdown for 50 KB, 200 KB, 500 KB and 1 MB messages', async () => {
    const dom = new JSDOM(
        '<!doctype html><html><head></head><body><div class="chat-messages-container"><div id="chat"></div></div></body></html>',
        { url: 'https://vcpchat.local/', pretendToBeVisual: true },
    );
    const previousGlobals = {
        window: globalThis.window,
        document: globalThis.document,
        Node: globalThis.Node,
        NodeFilter: globalThis.NodeFilter,
        MutationObserver: globalThis.MutationObserver,
    };
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.Node = dom.window.Node;
    globalThis.NodeFilter = dom.window.NodeFilter;
    globalThis.MutationObserver = dom.window.MutationObserver;

    let renderer;
    let streamProjection;
    try {
        const [{ createStreamProjection }, { createStreamTransientHistory }, { createMessageRenderer }] =
            await Promise.all([
                import('../modules/renderer/streamManager.js'),
                import('../modules/chat/streamTransientHistory.js'),
                import('../modules/messageRenderer.js'),
            ]);

        const messages = [
            { id: 'large-50k', role: 'assistant', content: 'A'.repeat(50 * 1024), timestamp: 1 },
            { id: 'large-200k', role: 'assistant', content: 'B'.repeat(200 * 1024), timestamp: 2 },
            { id: 'large-500k', role: 'assistant', content: 'C'.repeat(500 * 1024), timestamp: 3 },
            { id: 'large-1m', role: 'assistant', content: 'D'.repeat(1024 * 1024), timestamp: 4 },
        ];
        const historyRef = createRef(messages);
        const selectedRef = createRef({
            id: 'large-agent',
            type: 'agent',
            name: 'Large Agent',
            avatarUrl: 'assets/default_avatar.png',
            config: {},
        });
        const topicRef = createRef('large-topic');
        const settingsRef = createRef({
            enableSmoothStreaming: false,
            enableAiMessageButtons: false,
            userAvatarUrl: 'assets/default_user_avatar.png',
        });
        const repository = {
            async getHistory() { return historyRef.get(); },
            async saveHistory() { return { success: true }; },
        };
        const transientStreamHistory = createStreamTransientHistory({
            repository,
            currentHistory: {
                get: historyRef.get,
                replace: historyRef.set,
            },
        });
        streamProjection = createStreamProjection();

        let markdownParseCalls = 0;
        const markedSpy = {
            parse() {
                markdownParseCalls += 1;
                return '<p data-formatted-render="true">formatted</p>';
            },
        };

        renderer = createMessageRenderer({
            streamManager: streamProjection,
            visibilityOptimizer: createVisibilityStub(),
            enableContextMenu: false,
            enableMiddleClick: false,
            exposeGlobalCommands: false,
        });
        const root = dom.window.document.getElementById('chat');
        renderer.initializeMessageRenderer({
            chatMessagesDiv: root,
            electronAPI: {
                async getEmoticonLibrary() { return []; },
                onDesktopStatus() { return () => {}; },
                openImageViewer() {},
                showImageContextMenu() {},
                sovitsStop() {},
                async saveAvatarColor() { return { success: true }; },
            },
            chatRepository: repository,
            historyMutationAuthority: {
                async replace(_context, history) {
                    historyRef.set([...history]);
                    return history;
                },
            },
            transientStreamHistory,
            markedInstance: markedSpy,
            uiHelper: {
                scrollToBottom() {},
                showToastNotification() {},
            },
            currentChatHistoryRef: historyRef,
            currentSelectedItemRef: selectedRef,
            currentTopicIdRef: topicRef,
            globalSettingsRef: settingsRef,
            summarizeTopicFromMessages: async () => null,
            handleCreateBranch: async () => null,
            messageCommands: {
                updateSendButtonState() {},
                syncNextUiEmptyStateWithMessages() {},
                handleSendMessage: async () => {},
            },
        });

        await renderer.renderHistory(messages, { initialBatch: 5 });

        assert.equal(markdownParseCalls, 0, 'history loading must bypass Markdown for oversized messages');
        assert.equal(root.querySelectorAll('.vcp-large-message-guard').length, 4);
        assert.equal(root.querySelector('[data-message-id="large-50k"]').dataset.vcpLargeMessageTier, 'folded');
        assert.equal(root.querySelector('[data-message-id="large-200k"]').dataset.vcpLargeMessageTier, 'plaintext');
        assert.equal(root.querySelector('[data-message-id="large-500k"]').dataset.vcpLargeMessageTier, 'blocked');
        assert.equal(root.querySelector('[data-message-id="large-1m"]').dataset.vcpLargeMessageTier, 'blocked');
        assert.ok(root.textContent.length < 40_000, 'four guarded messages must keep total DOM text bounded');

        renderer.updateMessageContent('large-200k', 'E'.repeat(240 * 1024));
        await waitForTurn();
        const updatedItem = root.querySelector('[data-message-id="large-200k"]');
        assert.equal(markdownParseCalls, 0, 'live updates must stay out of Markdown after crossing the guard');
        assert.equal(updatedItem.dataset.vcpLargeMessageTier, 'plaintext');
        assert.equal(updatedItem.dataset.vcpLargeMessageLength, String(240 * 1024));

        const terminalMessage = {
            id: 'large-terminal',
            role: 'assistant',
            content: '',
            timestamp: 5,
            isThinking: true,
        };
        historyRef.set([...historyRef.get(), terminalMessage]);
        await renderer.renderMessage(terminalMessage, false, true);
        await renderer.renderFullMessage(
            terminalMessage.id,
            'F'.repeat(300 * 1024),
            'Large Agent',
            'large-agent',
        );
        const terminalItem = root.querySelector('[data-message-id="large-terminal"]');
        assert.equal(markdownParseCalls, 0, 'terminal replacement must guard before Markdown');
        assert.equal(terminalItem.dataset.vcpLargeMessageTier, 'plaintext');
        assert.equal(terminalItem.classList.contains('thinking'), false);

        const foldedItem = root.querySelector('[data-message-id="large-50k"]');
        const formattedButton = foldedItem.querySelector('.vcp-large-message-guard__button--warning');
        formattedButton.click();
        assert.equal(markdownParseCalls, 0, 'first click only arms the warning');
        formattedButton.click();
        await waitForTurn();
        assert.equal(markdownParseCalls, 1, 'second click explicitly opts into Markdown');
        assert.ok(foldedItem.querySelector('[data-formatted-render="true"]'));
    } finally {
        renderer?.disposeRendererResources();
        await streamProjection?.dispose?.();
        globalThis.window = previousGlobals.window;
        globalThis.document = previousGlobals.document;
        globalThis.Node = previousGlobals.Node;
        globalThis.NodeFilter = previousGlobals.NodeFilter;
        globalThis.MutationObserver = previousGlobals.MutationObserver;
        dom.window.close();
    }
});