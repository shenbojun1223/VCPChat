'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');

const filename = path.resolve(__dirname, '../Groupmodules/groupchat.js');
const localRequire = createRequire(filename);
const clone = value => JSON.parse(JSON.stringify(value));
const hashText = text => `sha256:${crypto.createHash('sha256').update(text, 'utf8').digest('hex')}`;

function loadEngine(stream = false) {
    const requests = [];
    const module = { exports: {} };
    const sandbox = {
        module, exports: module.exports, URL, AbortController, TextDecoder,
        setTimeout, clearTimeout,
        console: { log() {}, warn() {}, error() {}, info() {} },
        fetch: async (_url, options) => {
            requests.push(JSON.parse(options.body));
            const data = stream
                ? `data: ${JSON.stringify({ choices: [{ delta: { content: 'MOCK_REPLY' } }] })}\n\ndata: [DONE]\n\n`
                : JSON.stringify({ choices: [{ message: { content: 'MOCK_REPLY' } }] });
            return new Response(data, {
                headers: { 'Content-Type': stream ? 'text/event-stream' : 'application/json' }
            });
        },
        require: name => {
            if (name === 'electron') return { ipcMain: {} };
            if (name === '../modules/modelTrajectory') return {
                beginTrajectoryCall: () => ({ chunk() {}, finish() {} }),
                sessionKeyFromContext: () => 'isolated-test',
                sourceFromContext: value => value
            };
            if (name === '../modules/contextSanitizer') return {
                stripThoughtChains: value => value,
                sanitizeMessages: value => value
            };
            if (name === '../modules/ipc/tavernHandlers') return { getActiveRules: () => [] };
            if (name === './topicTitleManager') return {
                async triggerSummarizationIfNeeded() {}
            };
            if (['../modules/fileManager', '../modules/ipc/canvasHandlers',
                '../modules/tavernRulesEngine'].includes(name)) return {};
            return localRequire(name);
        }
    };
    // Test-only access: production exports and module initialization are unchanged.
    vm.runInNewContext(
        fs.readFileSync(filename, 'utf8') +
        '\nmodule.exports.testBuildRequest = buildGroupRequestBody;',
        sandbox, { filename }
    );
    return { api: module.exports, requests };
}

function freezeDeep(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        for (const child of Object.values(value)) freezeDeep(child);
        Object.freeze(value);
    }
    return value;
}

test('outbound single text blocks become strings without mutating history or timestamp bindings', () => {
    const { api } = loadEngine();
    const source = freezeDeep([
        { role: 'system', content: 'SYSTEM' },
        {
            role: 'user', name: '用户',
            content: [{ type: 'text', text: ' \n中文 hello\r\n ' }],
            __vcpchatTimestampMeta: { messageId: 'u1', role: 'user', timestamp: 1793344610000 }
        },
        {
            role: 'assistant', content: [{ type: 'text', text: '[Lucy的发言]: previous' }],
            __vcpchatTimestampMeta: { messageId: 'a1', role: 'assistant', timestamp: 1793344611000 }
        },
        { role: 'user', content: [{ type: 'text', text: 'invitation' }] }
    ]);
    const before = JSON.stringify(source);
    const model = freezeDeep({ model: 'claude-vcp-opus-max', stream: true, max_tokens: 60000, temperature: 0.7 });
    const body = clone(api.testBuildRequest(source, model, 'request-1'));

    assert.deepEqual(body.messages.map(message => message.content), [
        'SYSTEM', ' \n中文 hello\r\n ', '[Lucy的发言]: previous', 'invitation'
    ]);
    assert.deepEqual(body.messages.map(message => message.role), ['system', 'user', 'assistant', 'user']);
    assert.equal(body.messages[1].name, '用户');
    assert.equal(body.messageId, 'request-1');
    for (const [key, value] of Object.entries(model)) assert.equal(body[key], value);
    assert.equal(JSON.stringify(source), before);
    assert.ok(body.messages.every(message => !Object.hasOwn(message, '__vcpchatTimestampMeta')));
    assert.equal(body.vcpchatExtensions.messageMetadataMode, 'hash_only');
    const bindings = body.vcpchatExtensions.messageTimestampBindings;
    assert.deepEqual(bindings.map(binding => binding.sentMessageIndex), [1, 2]);
    assert.deepEqual(bindings.map(binding => binding.messageId), ['u1', 'a1']);
    assert.deepEqual(bindings.map(binding => binding.timestamp), [1793344610000, 1793344611000]);
    assert.deepEqual(bindings.map(binding => binding.sentMessageHash), [
        hashText(source[1].content[0].text), hashText(source[2].content[0].text)
    ]);
});

test('plain strings, empty text, and system/developer/assistant single text blocks retain exact text', () => {
    const { api } = loadEngine();
    for (const role of ['system', 'developer', 'user', 'assistant']) {
        for (const text of ['', 'hello', ' \n文本\r\n\t ']) {
            for (const content of [text, [{ type: 'text', text }]]) {
                const body = api.testBuildRequest([{ role, content }], {}, 'r');
                assert.equal(body.messages[0].content, text);
                assert.equal(body.messages[0].role, role);
                assert.equal(body.vcpchatExtensions, undefined);
            }
        }
    }
});

test('images, mixed media, multiple text blocks, unknown and malformed parts are not flattened or dropped', () => {
    const { api } = loadEngine();
    const image = { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } };
    const cases = [
        [image],
        [{ type: 'text', text: 'look' }, image],
        [{ type: 'text', text: 'first' }, { type: 'text', text: 'second' }],
        [{ type: 'input_audio', input_audio: { data: 'AAAA', format: 'wav' } }],
        [{ type: 'unknown', text: 'do not drop' }],
        [{ type: 'text', text: 123 }],
        [null],
        []
    ];
    for (const content of cases) {
        const source = freezeDeep([{ role: 'user', content }]);
        const before = JSON.stringify(source);
        const body = clone(api.testBuildRequest(source, {}, 'r'));
        assert.deepEqual(body.messages[0].content, content);
        assert.equal(JSON.stringify(source), before);
    }
});

async function fixture(t, mode, stream, withImage = false) {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'vcp-group-text-compat-'));
    t.after(() => fsp.rm(root, { recursive: true, force: true }));
    const { api, requests } = loadEngine(stream);
    const settingsFile = path.join(root, 'settings.json');
    await fsp.writeFile(settingsFile, JSON.stringify({
        vcpServerUrl: 'http://localhost:1234/v1/chat/completions',
        vcpApiKey: 'isolated-test', userName: 'Tester'
    }));
    api.initializePaths({
        APP_DATA_ROOT_IN_PROJECT: root, USER_DATA_DIR: path.join(root, 'users'),
        AGENT_DIR: path.join(root, 'agents'), SETTINGS_FILE: settingsFile
    });
    const created = await api.createAgentGroup('compat-test', {
        mode, members: ['lucy'], sequentialSpeakerOrder: ['lucy'],
        modeSettings: { sequential: { speakerOrder: ['lucy'] } }
    });
    assert.equal(created.success, true);
    const groupId = created.agentGroup.id, topicId = created.agentGroup.topics[0].id;
    await api.appendGroupHistoryMessage(groupId, topicId, {
        id: 'prior-user', role: 'user', name: 'Tester', content: 'PRIOR_USER',
        timestamp: 1793344600000,
        attachments: withImage ? [{
            name: 'fixture.png', type: 'image/png', imageFrames: ['AAAA']
        }] : []
    });
    await api.appendGroupHistoryMessage(groupId, topicId, {
        id: 'prior-assistant', role: 'assistant', name: 'Lucy',
        agentId: 'lucy', content: 'PRIOR_ASSISTANT', timestamp: 1793344601000
    });
    const loadAgent = async () => ({
        id: 'lucy', name: 'Lucy', model: 'claude-vcp-opus-max',
        systemPrompt: 'TEST_PERSONA', streamOutput: stream, temperature: 0.7, maxOutputTokens: 60000
    });
    let decisions = 0;
    api.initializeRuntimeServices({
        getAgentConfigById: loadAgent,
        jevService: {
            async decide() {
                const first = decisions++ === 0;
                return {
                    answers: {
                        speaker_routing: {
                            probabilities: { agent_0: first ? 1 : 0, end_conversation: first ? 0 : 1 }
                        },
                        continue_discussion: { noul: first ? 1 : 0 }
                    }
                };
            }
        }
    });
    const events = [];
    if (mode === 'invite_only') {
        await api.handleInviteAgentToSpeak(
            groupId, topicId, 'lucy', event => events.push(event), loadAgent, { skipSummary: true }
        );
    } else {
        await api.handleGroupChatMessage(
            groupId, topicId,
            { id: 'new-user', name: 'Tester', content: { text: 'NEW_USER' } },
            event => events.push(event), loadAgent
        );
    }
    return { api, groupId, topicId, requests, events };
}

for (const mode of ['sequential', 'invite_only', 'jev']) {
    for (const stream of [false, true]) {
        test(`${mode}/${stream ? 'stream' : 'json'} sends strings including invitation and preserves historical timestamps`, async t => {
            const f = await fixture(t, mode, stream);
            assert.equal(f.requests.length, 1);
            const body = f.requests[0];
            assert.equal(body.model, 'claude-vcp-opus-max');
            assert.equal(body.stream, stream);
            assert.ok(body.messages.every(message => typeof message.content === 'string'),
                'plain-text group payload must not trigger bridge multimodal_unsupported');
            assert.match(body.messages.at(-1).content, /Lucy/);
            assert.ok(!JSON.stringify(body.messages).includes('__vcpchatTimestampMeta'));
            const bindings = body.vcpchatExtensions.messageTimestampBindings;
            const prior = bindings.find(binding => binding.messageId === 'prior-user');
            assert.equal(prior.timestamp, 1793344600000);
            for (const binding of bindings) {
                assert.equal(binding.sentMessageHash, hashText(body.messages[binding.sentMessageIndex].content));
            }
            const history = await f.api.getGroupChatHistory(f.groupId, f.topicId);
            assert.equal(history[0].content, 'PRIOR_USER');
            assert.equal(history[1].content, 'PRIOR_ASSISTANT');
            assert.equal(history.at(-1).content, 'MOCK_REPLY');
        });
    }
}

for (const mode of ['sequential', 'invite_only', 'jev']) {
    test(`${mode} keeps actual image parts while simplifying the text-only invitation`, async t => {
        const f = await fixture(t, mode, false, true);
        assert.equal(f.requests.length, 1);
        const body = f.requests[0];
        const mediaMessage = body.messages.find(message => Array.isArray(message.content));
        assert.ok(mediaMessage, 'media content must not be silently discarded');
        assert.equal(mediaMessage.content[0].type, 'text');
        assert.equal(mediaMessage.content[1].type, 'image_url');
        assert.equal(mediaMessage.content[1].image_url.url, 'data:image/jpeg;base64,AAAA');
        assert.equal(typeof body.messages.at(-1).content, 'string');
        const history = await f.api.getGroupChatHistory(f.groupId, f.topicId);
        assert.deepEqual(clone(history[0].attachments[0].imageFrames), ['AAAA']);
    });
}