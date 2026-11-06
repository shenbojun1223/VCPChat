const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadFlowlockIntegration({ history, onSend, continueWritingPrompt = '请继续', chatManager = {}, streamOutput = true, onSave = async () => {} }) {
    let continueWritingForContext;
    const chatAPI = {
        getChatHistory: async () => history,
        getAgentConfig: async () => ({
            name: 'Nova',
            model: 'test-model',
            streamOutput,
            systemPrompt: 'You are Nova.'
        }),
        tavernGetRules: async () => ({ success: true, store: { rules: [] } }),
        sendToVCP: async (...args) => {
            return (await onSend(...args)) || {};
        }
    };
    const window = {
        chatAPI,
        electronAPI: chatAPI,
        VCPMainChatState: {
            snapshot: () => ({ selectedItem: { id: 'agent-1' }, topicId: 'topic-1' })
        },
        flowlockManager: {
            initialize: ({ continueWritingForContext: continuation }) => {
                continueWritingForContext = continuation;
            },
            recoverPendingRequests: async () => {},
            handleFinalizedMessage: async () => {},
            cleanup: () => {}
        },
        addEventListener: () => {}
    };
    const document = {
        getElementById: () => null,
        addEventListener: () => {}
    };
    const context = vm.createContext({
        console,
        document,
        window,
        setTimeout,
        clearTimeout,
        Promise
    });
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'Flowlockmodules', 'flowlock-integration.js'),
        'utf8'
    );
    vm.runInContext(source, context, { filename: 'flowlock-integration.js' });
    window.initializeFlowlockIntegration({
        chatManager: { loadChatHistory: async () => {}, isReady: () => true, ...chatManager },
        historyMutationAuthority: { replace: onSave },
        settings: {
            get: () => ({
                vcpServerUrl: 'http://127.0.0.1:6005/v1/chat/completions',
                vcpApiKey: 'test-key',
                continueWritingPrompt
            })
        }
    });

    return async () => continueWritingForContext({
        agentId: 'agent-1',
        topicId: 'topic-1',
        messageId: 'flowlock-request-1'
    });
}

test('Flowlock preserves history timestamps for OneRing and ends with a user heartbeat', async () => {
    const history = [
        { id: 'user-1', role: 'user', content: '开始任务', timestamp: 1000 },
        { id: 'assistant-1', role: 'assistant', content: '第一阶段完成', timestamp: 2000 },
        { id: 'legacy', role: 'assistant', content: '旧消息没有合法时间戳', timestamp: '3000' }
    ];
    let sentMessages;
    const run = loadFlowlockIntegration({
        history,
        onSend: (_url, _key, messages) => {
            sentMessages = messages;
        }
    });

    await run();

    assert.deepEqual(JSON.parse(JSON.stringify(sentMessages[1].__vcpchatTimestampMeta)), {
        messageId: 'user-1',
        role: 'user',
        timestamp: 1000
    });
    assert.deepEqual(JSON.parse(JSON.stringify(sentMessages[2].__vcpchatTimestampMeta)), {
        messageId: 'assistant-1',
        role: 'assistant',
        timestamp: 2000
    });
    assert.equal(sentMessages[3].__vcpchatTimestampMeta, undefined);
    assert.equal(sentMessages.at(-1).role, 'user');
    assert.match(sentMessages.at(-1).content, /^\[系统提示:\] 请继续$/);
});

test('Flowlock default includes one system prefix and the stop instruction', async () => {
    let sentMessages;
    const run = loadFlowlockIntegration({
        history: [{ role: 'assistant', content: '任务完成' }],
        continueWritingPrompt: '',
        onSend: (_url, _key, messages) => { sentMessages = messages; }
    });
    await run();
    const content = sentMessages.at(-1).content;
    assert.equal(content, '[系统提示:] 请继续。若当前已无值得继续推进的任务或话题，请输出 [[Flowlock::Stop]] 关闭心流锁心跳。');
    assert.equal(content.split('[系统提示:]').length - 1, 1);
});

test('actual Flowlock integration holds background gate after stream startup until consumer terminal',async()=>{
    const held=new Set();
    const run=loadFlowlockIntegration({history:[],chatManager:{
        beginBackgroundSend:id=>{held.add(id);return()=>held.delete(id);},
    },onSend:async()=>{
        assert.equal(held.has('flowlock-request-1'),true);
        return{streamingStarted:true};
    }});
    await run();
    assert.equal(held.has('flowlock-request-1'),true);
    // Session stop is deliberately not involved; Surface onSettled owns this release.
});
test('actual nonstream Flowlock integration releases only after terminal history write',async()=>{
    let held=false,saves=0;
    const run=loadFlowlockIntegration({history:[],streamOutput:false,chatManager:{
        beginBackgroundSend:()=>{held=true;return()=>{held=false;};},
    },onSend:async()=>({choices:[{message:{content:'done'}}]}),
        onSave:async()=>{assert.equal(held,true);saves++;}});
    await run();assert.equal(saves,2);assert.equal(held,false);
});
test('Flowlock preparation failure releases its own background gate',async()=>{
    let held=false;
    const run=loadFlowlockIntegration({history:[],chatManager:{
        beginBackgroundSend:()=>{held=true;return()=>{held=false;};},
    },onSend:async()=>{throw Error('controlled setup failure');}});
    await assert.rejects(run(),/setup failure/);assert.equal(held,false);
});
