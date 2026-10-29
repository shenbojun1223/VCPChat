import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { sanitizeToolDataHtml } from '../modules/renderer/toolDataHtml.js';

const input = '<img src=x onerror="inert()"> & <script>inert()</script>';
const escaped = '\u0026lt;img src=x onerror="inert()"\u0026gt; \u0026amp; \u0026lt;script\u0026gt;inert()\u0026lt;/script\u0026gt;';

// Inert DOM only: no runScripts/resources options and no real tool calls.
for (const [label, missingDocument] of [
    ['undefined', undefined],
    ['null', null],
    ['empty object', {}]
]) {
    test(`missing DOM (${label}) renders tool HTML as literal text`, () => {
        const result = sanitizeToolDataHtml(input, missingDocument);
        assert.equal(result, escaped);
        assert.doesNotMatch(result, /[<>]/);
        const dom = new JSDOM('');
        try {
            const host = dom.window.document.createElement('div');
            host.innerHTML = result;
            assert.equal(host.childElementCount, 0);
            assert.equal(host.textContent, input);
        } finally {
            dom.window.close();
        }
    });
}

test('missing DOM preserves existing entities, quotes and Unicode as text', () => {
    const value = '\u0026lt;b\u0026gt; "quoted" \'single\' 中文 <tag> &';
    const result = sanitizeToolDataHtml(value, null);
    assert.ok(result.startsWith('\u0026amp;lt;b\u0026amp;gt;'));
    const dom = new JSDOM('');
    try {
        const host = dom.window.document.createElement('div');
        host.innerHTML = result;
        assert.equal(host.childElementCount, 0);
        assert.equal(host.textContent, value);
    } finally {
        dom.window.close();
    }
});

test('available DOM still preserves safe structure and removes executable content', () => {
    const dom = new JSDOM('');
    try {
        const document = dom.window.document;
        const host = document.createElement('div');
        host.innerHTML = sanitizeToolDataHtml(
            '<table><tr><td>safe</td></tr></table><code>&lt;tag&gt;</code>' +
            '<span onclick="inert()">text</span><script>inert()</script>',
            document
        );
        assert.equal(host.querySelector('td')?.textContent, 'safe');
        assert.equal(host.querySelector('code')?.textContent, '<tag>');
        assert.equal(host.querySelector('script, [onclick]'), null);
    } finally {
        dom.window.close();
    }
});