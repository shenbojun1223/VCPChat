import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderNativeToolCards } from '../modules/renderer/nativeToolCards.js';

const event = changes => ({
    schema: 1, source: 'agy-native', requestId: 'req-1', callId: 'step:2',
    revision: 0, sequence: 1, name: 'read_file', status: 'running',
    evidence: 'transport_reported', detailsPolicy: 'withheld', ...changes,
});
function fixture(t) {
    const dom = new JSDOM('<article><img class="chat-avatar"><div class="details-and-bubble-wrapper"><div class="md-content">正文</div></div></article>');
    t.after(() => dom.window.close());
    return dom.window.document.querySelector('article');
}

test('native panel is a sibling of untouched answer content', t => {
    const root = fixture(t);
    const answer = root.querySelector('.md-content');
    assert.equal(renderNativeToolCards(root, [event({
        parameters: { token: 'PRIVATE' }, output: '<script>PRIVATE</script>',
    })]), true);
    assert.equal(root.querySelector('.md-content'), answer);
    assert.equal(answer.textContent, '正文');
    const panel = root.querySelector('[data-vcp-native-tools]');
    assert.equal(panel.parentElement, root.querySelector('.details-and-bubble-wrapper'));
    assert.equal(panel.previousElementSibling, answer);
    assert.equal(answer.contains(panel), false);
    assert.equal(root.children.length, 2);
    assert.match(panel.textContent, /AGY 原生工具/);
    assert.match(panel.textContent, /调用已发起（CLI 报告）/);
    assert.match(panel.textContent, /不代表已获准执行或已独立核验/);
    assert.equal(panel.textContent.includes('执行中'), false);
    assert.equal(panel.textContent.includes('PRIVATE'), false);
    assert.equal(panel.querySelector('script,iframe,img,button'), null);
});

test('updates replace one panel while preserving expansion choice', t => {
    const root = fixture(t);
    renderNativeToolCards(root, [event()]);
    root.querySelector('details').open = false;
    renderNativeToolCards(root, [event({
        revision: 1, sequence: 2, status: 'succeeded',
    })]);
    assert.equal(root.querySelectorAll('[data-vcp-native-tools]').length, 1);
    assert.equal(root.querySelector('details').open, false);
    assert.match(root.querySelector('li').textContent, /成功（CLI 报告）/);
});

test('invalid or duplicate snapshots do not replace existing panel', t => {
    const root = fixture(t);
    renderNativeToolCards(root, [event()]);
    const original = root.querySelector('details');
    for (const records of [
        null, [event({ name: '<img src=x onerror=alert(1)>' })],
        [event(), event()], Array(129).fill(event()),
    ]) {
        assert.equal(renderNativeToolCards(root, records), false);
        assert.equal(root.querySelector('details'), original);
    }
});

test('saved metadata restores unknown state without inventing success', t => {
    const root = fixture(t);
    const saved = JSON.parse(JSON.stringify([event({
        name: null, status: 'unknown', evidence: 'missing_terminal',
    })]));
    assert.equal(renderNativeToolCards(root, saved), true);
    assert.match(root.textContent, /未提供工具名/);
    assert.match(root.textContent, /未收到调用终态/);
    assert.equal(root.querySelector('[data-native-status]').dataset.nativeStatus, 'unknown');
    assert.equal(renderNativeToolCards(root, []), true);
    assert.equal(root.querySelector('details'), null);
    assert.equal(root.querySelector('.md-content').textContent, '正文');
});
test('legacy root panel migrates into the content column without losing collapse state', t => {
    const root = fixture(t);
    renderNativeToolCards(root, [event()]);
    const old = root.querySelector('details');
    old.open = false;
    root.appendChild(old);
    renderNativeToolCards(root, [event({ revision: 1, sequence: 2, status: 'failed' })]);
    const next = root.querySelector('details');
    assert.equal(root.querySelectorAll('[data-vcp-native-tools]').length, 1);
    assert.equal(next.open, false);
    assert.equal(next.parentElement, root.querySelector('.details-and-bubble-wrapper'));
    assert.equal(root.children.length, 2);
    assert.equal(root.querySelector('.md-content').textContent, '正文');
});