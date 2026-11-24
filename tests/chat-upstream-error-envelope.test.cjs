'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { chatResponseError, readChatHttpError } = require('../modules/chatRequestError');
const requestId = '202611241616460000fixture01';
const fields = { type: 'upstream_error', status: 503, code: 'system_cpu_overloaded', phase: 'initial', attempt: 1, requestId };
const frame = (error = fields, extra = {}) => ({
    id: 'chatcmpl-vcp-error-1795500000000', object: 'chat.completion.chunk', model: 'vcp-upstream-error',
    choices: [{ index: 0, delta: { content: '\n[UPSTREAM_ERROR] fixture-only prose' }, finish_reason: 'stop' }],
    error, ...extra,
});

test('VCP stream failure without error.message keeps the status, code and traceable request number', () => {
    const e = chatResponseError(frame());
    assert.equal(e.status, 503);
    assert.equal(e.isChatResponseError, true);
    assert.match(e.message, /system_cpu_overloaded/);
    assert.ok(e.message.includes(requestId));
    assert.doesNotMatch(e.message, /fixture-only prose/);
});
test('explicit backend descriptions still take precedence over the VCP summary', () => {
    assert.equal(chatResponseError(frame({ ...fields, message: 'specific message' })).message, 'HTTP 503\uff1aspecific message');
});
test('ordinary provider frames do not promote delta text or VCP-only fields into errors', () => {
    for (const f of [frame(fields, { model: 'ordinary-model' }), frame({ ...fields, type: 'other_error' }), frame(fields, { object: 'ordinary.object' })]) {
        const e = chatResponseError(f);
        assert.equal(e.status, 503);
        assert.ok(!e.message.includes(requestId));
        assert.doesNotMatch(e.message, /system_cpu_overloaded|fixture-only prose/);
    }
    assert.equal(chatResponseError(frame(null)), null);
});
test('malformed display fields are not stringified and a missing request ID is not invented', () => {
    const e = chatResponseError(frame({ ...fields, code: { label: 'fixture-only' }, requestId: 'not a request number' }));
    assert.equal(e.status, 503);
    assert.doesNotMatch(e.message, /fixture-only|not a request number|\[object Object\]/);
});
test('non-stream HTTP errors keep their existing message-first behavior', async () => {
    const x = await readChatHttpError({status: 502, text: async () => JSON.stringify({error: { ...fields, message: 'HTTP body detail' }})});
    assert.deepEqual(x, {status: 502, error: 'HTTP 502\uff1aHTTP body detail'});
});

test('rate limiting without a public request number does not invent one', () => {
    const e = chatResponseError(frame({ ...fields, status: 429, code: 'rate_limit_exceeded', requestId: null }));
    assert.equal(e.status, 429);
    assert.match(e.message, /rate_limit_exceeded/);
    assert.doesNotMatch(e.message, /CPU|null|undefined|\u8bf7\u6c42\u7f16\u53f7/);
});
test('only bounded diagnostic tokens reach the public failure string', () => {
    for (const [code, requestId] of [['bad code!', '20261124161646short'], ['a'.repeat(500), 'b'.repeat(500)]]) {
        const e = chatResponseError(frame({ ...fields, code, requestId }));
        assert.ok(!e.message.includes(code) && !e.message.includes(requestId));
        assert.ok(e.message.length < 80);
    }
});
