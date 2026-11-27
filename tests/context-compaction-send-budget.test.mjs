import test from 'node:test';
import assert from 'node:assert/strict';
import { preflightContextSend } from '../modules/chat/contextCompactionService.js';

const opts = overrides => ({
    electronAPI: {}, agentConfig: { contextTokenLimit: 1000 },
    context: { agentId: 'fixture', topicId: 'fixture-topic' }, history: [],
    pendingMessage: { id: 'new', role: 'user', content: '问题' }, ...overrides,
});
const prior = { id: 'old', role: 'assistant', content: '旧'.repeat(975) };

test('text preview does not request attachment frames', async () => {
    let reads = 0;
    const result = await preflightContextSend(opts({
        electronAPI: { async getFileAsBase64() { reads++; } },
        pendingMessage: { id: 'new', role: 'user', content: '看图',
            attachments: [{ type: 'image/png', src: 'file:///fixture.png' }] },
    }));
    assert.equal(reads, 0);
    assert.equal(result.shouldCompact, false);
    assert.ok(result.tokens < 1000);
});

test('assembled live attachment and expanded system text count before sending', async () => {
    await assert.rejects(preflightContextSend(opts({
        electronAPI: {
            async getTextContent() { return { text: '文'.repeat(735) }; },
            async expandWorkspacePlaceholders() { return { success: true, text: '树'.repeat(810) }; },
        },
        agentConfig: { contextTokenLimit: 1000, systemPrompt: '{{VCPChatWorkSpace}}' },
        pendingMessage: { id: 'new', role: 'user', content: '看看', attachments: [{
            type: 'text/plain', src: 'file:///fixture.txt',
            _fileManagerData: { isLiveReference: true, extractedText: '短' },
        }] },
    })), /展开附件.*超过上限 1000/);
});

test('ordinary history keeps the local 60 percent compaction trigger', async () => {
    const result = await preflightContextSend(opts({ history: [prior] }));
    assert.equal(result.shouldCompact, true);
    assert.ok(result.tokens >= 600 && result.tokens < 850, 'must distinguish 60% from the upstream 85%');
});

test('a new turn that cannot fit alone does not start compaction', async () => {
    await assert.rejects(preflightContextSend(opts({ history: [prior],
        pendingMessage: { id: 'new', role: 'user', content: '新'.repeat(1650) },
    })), /本轮内容.*超过上限 1000/);
});

test('after compaction do not loop; reject only when still over the hard limit', async () => {
    assert.equal((await preflightContextSend(opts({ history: [prior], afterCompaction: true }))).shouldCompact, false);
    await assert.rejects(preflightContextSend(opts({ history: [{ ...prior, content: '旧'.repeat(1650) }],
        afterCompaction: true,
    })), /压缩后的请求.*超过上限 1000/);
});

const context = { agentId: 'a', topicId: 't' };

test('send budget follows the message window and does not read encoded media', async () => {
    let mediaReads = 0;
    const result = await preflightContextSend({
        context,
        electronAPI: { async getFileAsBase64() { mediaReads++; } },
        agentConfig: { contextTokenLimit: 500, contextMessageWindowSize: 1 },
        history: [{ id: 'old', role: 'assistant', content: '旧'.repeat(1000) }],
        pendingMessage: {
            id: 'u', role: 'user', content: '看图',
            attachments: [{ type: 'image/png', src: 'file:///test.png' }],
        },
    });
    assert.equal(result.shouldCompact, false);
    assert.ok(result.tokens < 500);
    assert.equal(mediaReads, 0);
});

test('send budget counts refreshed live text and expanded workspace prompt', async () => {
    const pendingMessage = {
        id: 'u', role: 'user', content: '看看',
        attachments: [{
            type: 'text/plain', src: 'file:///test.txt',
            _fileManagerData: { isLiveReference: true, extractedText: '短' },
        }],
    };
    await assert.rejects(preflightContextSend({
        context,
        electronAPI: {
            async getTextContent() { return { text: '文'.repeat(400) }; },
            async expandWorkspacePlaceholders() { return { success: true, text: '树'.repeat(400) }; },
        },
        agentConfig: { contextTokenLimit: 500, systemPrompt: '{{VCPChatWorkSpace}}' },
        history: [],
        pendingMessage,
    }), /超过上限 500/);
});