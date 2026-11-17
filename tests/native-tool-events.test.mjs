import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// The renderer module is browser ESM inside a CommonJS application package.
// This dependency-free module can be tested without changing package scope.
const source = await readFile(new URL('../modules/chat/nativeToolEvents.js', import.meta.url), 'utf8');
const { normalizeNativeToolEvent, normalizeNativeToolFrame, createNativeToolState, normalizeNativeToolSnapshot } =
    await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const event = changes => ({
    schema: 1, source: 'agy-native', requestId: 'request-1', callId: 'step:2',
    revision: 0, sequence: 1, name: 'read_file', status: 'running',
    evidence: 'transport_reported', detailsPolicy: 'withheld', ...changes,
});

test('projects only display fields and never retains raw input or output', () => {
    const input = event({ parameters: { password: 'SECRET' }, output: '<script>SECRET</script>' });
    const result = normalizeNativeToolEvent(input);
    assert.deepEqual(result, event());
    assert.equal(JSON.stringify(result).includes('SECRET'), false);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.hasOwn(input, 'parameters'), true);
});

test('invalid events and inconsistent evidence are rejected', () => {
    for (const input of [
        null, [], event({ schema: 2 }), event({ source: 'vcp' }),
        event({ requestId: '' }), event({ callId: '../escape' }),
        event({ revision: -1 }), event({ sequence: 0 }),
        event({ status: 'invented' }), event({ name: '<img>' }),
        event({ detailsPolicy: 'raw' }), event({ evidence: 'verified' }),
        event({ evidence: 'missing_terminal', status: 'succeeded' }),
    ]) assert.equal(normalizeNativeToolEvent(input), null);
});

test('same call id in different upstream requests remains separate', () => {
    const state = createNativeToolState();
    assert.equal(state.accept(event()).accepted, true);
    assert.equal(state.accept(event({ requestId: 'request-2' })).accepted, true);
    assert.equal(state.snapshot().length, 2);
    state.accept(event({ revision: 1, sequence: 2, status: 'succeeded' }));
    assert.deepEqual(state.snapshot().map(value => value.status), ['succeeded', 'running']);
});

test('stale, identity-changing and conflicting terminal updates cannot replace state', () => {
    const state = createNativeToolState();
    state.accept(event({ revision: 3, sequence: 4 }));
    assert.equal(state.accept(event()).reason, 'stale');
    assert.equal(state.accept(event({ revision: 4, sequence: 5, name: 'command' })).reason, 'identity_conflict');
    assert.equal(state.accept(event({ revision: 4, sequence: 5, status: 'pending' })).reason, 'regression');
    assert.equal(state.accept(event({ revision: 4, sequence: 5, status: 'denied' })).accepted, true);
    assert.equal(state.accept(event({ revision: 5, sequence: 6, status: 'succeeded' })).reason, 'terminal_conflict');
    assert.equal(state.snapshot()[0].status, 'denied');
});

test('bridge close event may retain revision but must have a newer sequence', () => {
    const state = createNativeToolState();
    state.accept(event());
    assert.equal(state.accept(event({
        sequence: 2, status: 'unknown', evidence: 'missing_terminal',
    })).accepted, true);
    assert.equal(state.snapshot()[0].status, 'unknown');
});

test('local closure preserves reported terminal facts and marks unfinished calls unknown', () => {
    const state = createNativeToolState();
    state.accept(event({ name: null }));
    state.accept(event({ callId: 'step:3', status: 'failed' }));
    const closed = state.close();
    assert.deepEqual(closed.map(value => value.status), ['unknown', 'failed']);
    assert.equal(closed[0].evidence, 'missing_terminal');
    assert.equal(closed[1].evidence, 'transport_reported');
    assert.equal(Object.isFrozen(closed), true);
    assert.equal(Object.isFrozen(closed[0]), true);
    assert.equal(state.accept(event()).reason, 'closed');
    assert.deepEqual(state.close(), closed);
});

test('saved snapshots survive JSON serialization and validated restoration', () => {
    const original = createNativeToolState();
    original.accept(event());
    const stored = JSON.parse(JSON.stringify(original.close()));
    const restored = createNativeToolState();
    for (const record of stored) assert.equal(restored.accept(record).accepted, true);
    assert.deepEqual(restored.close(), stored);
});

test('limits include duplicate traffic and do not prevent final closure', () => {
    const state = createNativeToolState({ maxCalls: 1, maxEvents: 3 });
    state.accept(event());
    assert.equal(state.accept(event({ callId: 'step:3' })).reason, 'call_limit');
    assert.equal(state.accept(event()).reason, 'stale');
    assert.equal(state.accept(event()).reason, 'event_limit');
    assert.equal(state.close()[0].status, 'unknown');
    for (const options of [{ maxCalls: 0 }, { maxEvents: Infinity }, { maxCalls: 513 }]) {
        assert.throws(() => createNativeToolState(options), RangeError);
    }
});

test('live snapshots preserve running state while final snapshots mark it unknown', () => {
    const input = [event({ parameters: { secret: 'PRIVATE' } })];
    const live = normalizeNativeToolSnapshot(input, { finalize: false });
    const final = normalizeNativeToolSnapshot(input);
    assert.equal(live[0].status, 'running');
    assert.equal(live[0].evidence, 'transport_reported');
    assert.equal(final[0].status, 'unknown');
    assert.equal(final[0].evidence, 'missing_terminal');
    assert.equal(input[0].status, 'running');
    assert.equal(JSON.stringify(live).includes('PRIVATE'), false);
    assert.equal(Object.isFrozen(live), true);
    assert.equal(normalizeNativeToolSnapshot([event(), event()]), null);
    assert.equal(normalizeNativeToolSnapshot(Array(129).fill(event())), null);
    assert.equal(normalizeNativeToolSnapshot({}), null);
    assert.deepEqual(normalizeNativeToolSnapshot([]), []);
});
test('native frame binds metadata to its SSE envelope, not a self-declared source label', () => {
    const frame = changes => ({
        id: 'request-1', object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: {}, finish_reason: null }],
        vcp_native_tool: event(), ...changes,
    });
    assert.deepEqual(normalizeNativeToolFrame(frame()), event());
    assert.deepEqual(normalizeNativeToolFrame(frame({
        choices: [{ index: 0, delta: { content: '' }, finish_reason: null }],
    })), event(), 'VCP output guard adds an empty content field');
    for (const value of [
        null, [], frame({ id: undefined }), frame({ id: 'other-request' }),
        frame({ object: 'chat.completion' }), frame({ vcp_native_tool: null }),
        frame({ choices: [] }),
        frame({ choices: [{ index: 1, delta: {}, finish_reason: null }] }),
        frame({ choices: [{ index: 0, delta: { content: 'text' }, finish_reason: null }] }),
        frame({ choices: [{ index: 0, delta: { tool_calls: [] }, finish_reason: null }] }),
        frame({ choices: [{ index: 0, delta: { content: null }, finish_reason: null }] }),
        frame({ choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] }),
        frame({ choices: [{ index: 0, delta: { content: '', reasoning_content: 'text' }, finish_reason: null }] }),
        frame({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
        frame({ error: { code: 'synthetic_error' } }),
    ]) assert.equal(normalizeNativeToolFrame(value), null);
    assert.deepEqual(normalizeNativeToolFrame(frame({
        vcp_native_tool: event({ parameters: { token: 'PRIVATE' } }),
    })), event());
    const second = event({ requestId: 'request-2' });
    assert.deepEqual(normalizeNativeToolFrame(frame({
        id: 'request-2', vcp_native_tool: second,
    })), second, 'VCP continuation rounds may have distinct upstream request IDs');
});