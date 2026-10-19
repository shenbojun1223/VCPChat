import test from 'node:test';
import assert from 'node:assert/strict';
import {
    estimateLazyToolRenderLength as estimate,
    MAX_LAZY_TOOL_BLOCKS,
    LAZY_TOOL_BLOCK_COST,
} from '../modules/renderer/lazyToolRenderBudget.js';
import { classifyLargeMessage } from '../modules/renderer/largeMessageGuard.js';

// Assemble protocol literals so transporting this source cannot terminate a tool payload.
const marker = name => '<'.repeat(3) + '[' + name + ']' + '>'.repeat(3);
const field = (name, escaped = false) =>
    '\u300c' + name + (escaped ? 'ESCAPE' : '') + '\u300d';
const request = (payload, name = 'ProjectForge') => [
    marker('TOOL_REQUEST'),
    'tool_name:' + field('始') + name + field('末') + ',',
    'content:' + field('始', true) + payload + field('末', true),
    marker('END_TOOL_REQUEST'),
].join('\n');
const resultStart = '[[' + 'VCP调用结果信息汇总:';
const resultEnd = 'VCP调用结果结束' + ']]';
const result = payload => resultStart + '\n' + payload + '\n' + resultEnd;
const huge = 'x'.repeat(600 * 1024);

test('ordinary text keeps its complete budget', () => {
    assert.equal(estimate(huge), huge.length);
    assert.equal(classifyLargeMessage(estimate(huge)), 'blocked');
});

test('closed lazy requests and results are discounted without altering the source', () => {
    for (const source of [request(huge), result(huge)]) {
        const saved = source;
        assert.equal(estimate(source), LAZY_TOOL_BLOCK_COST);
        assert.equal(source, saved);
    }
});

test('140 request/result pairs stay below the ordinary-text threshold', () => {
    const source = Array.from({ length: 140 }, () =>
        request('x'.repeat(5000)) + '\n' +
        result('```js\n' + 'x'.repeat(5000) + '\n```')
    ).join('\n');
    assert.ok(source.length > 600000);
    assert.equal(classifyLargeMessage(estimate(source)), null);
});

test('one valid tool block cannot exempt a large ordinary suffix', () => {
    const source = request('small') + '\n' + huge;
    assert.ok(estimate(source) >= huge.length);
    assert.equal(classifyLargeMessage(estimate(source)), 'blocked');
});

test('code examples retain their original budget', () => {
    for (const block of [request(huge), result(huge)]) {
        for (const source of [
            '```text\n' + block + '\n```',
            '`' + block.replaceAll('\n', ' ') + '`',
        ]) assert.equal(estimate(source), source.length);
    }
});

test('unclosed request and result retain their original budget', () => {
    for (const source of [
        marker('TOOL_REQUEST') + '\ncontent:' + field('始') + huge,
        resultStart + '\n' + huge,
    ]) assert.equal(estimate(source), source.length);
});

test('DailyNote and thought-chain content retain protection', () => {
    const openThought = '<' + 'think' + '>';
    const closeThought = '<' + '/' + 'think' + '>';
    for (const source of [
        request(huge, 'DailyNote'),
        openThought + '\n' + request(huge) + '\n' + closeThought,
        '[--- VCP元思考链 ---]\n' + request(huge),
    ]) {
        assert.ok(source.length >= huge.length, 'Boundary fixture must retain its large payload');
        assert.equal(estimate(source), source.length);
    }
});

test('too many cards fall back instead of constructing an unbounded DOM', () => {
    const source = Array.from(
        { length: MAX_LAZY_TOOL_BLOCKS + 1 }, () => request('x')
    ).join('\n');
    assert.equal(estimate(source), source.length);
    assert.ok(classifyLargeMessage(estimate(source)));
});

test('nested result/request markers are charged once as outer result data', () => {
    const source = result(result('inner') + '\n' + request(huge));
    assert.equal(estimate(source), LAZY_TOOL_BLOCK_COST);
});
test('result payload fences after metadata never capture subsequent tool blocks', () => {
    const payload = 'LAZY_PAYLOAD_SENTINEL\n' + 'const source = 123456789;\n'.repeat(210);
    const transcript = Array.from({ length: 140 }, () =>
        request(payload) + '\n\n' +
        marker('ROLE_DIVIDE_USER') + '\n\n' +
        result('- 工具名称: ProjectForge\n- 执行状态: SUCCESS\n- 返回内容: ```js\n' + payload + '\n```') +
        '\n\n' + marker('END_ROLE_DIVIDE_USER')
    ).join('\n\n') + '\n\n最终回答。';
    assert.ok(transcript.length > 600000);
    const budget = estimate(transcript);
    assert.ok(budget >= 280 * LAZY_TOOL_BLOCK_COST, 'Each card retains a nonzero budget');
    assert.equal(classifyLargeMessage(budget), null);
    assert.equal(classifyLargeMessage(estimate(transcript + '\n' + huge)), 'blocked');
});