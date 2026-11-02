'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const T = require('../projectforge-todos.js');
const tick = () => new Promise(resolve => setImmediate(resolve));
const task = (seq, subagent, note = '原始备注') => ({ seq, title: `任务 ${seq}`, status: 'doing', subagent, note });
const detail = todos => ({ project: { id: 'fixture' }, todos });
function fixture(t, value, options = {}) {
    const dom = new JSDOM('<div class="tab-body"><div id="pane"></div></div>', { url: 'https://fixture.invalid/' });
    t.after(() => dom.window.close());
    const pane = dom.window.document.getElementById('pane'), view = T.createViewState();
    const notices = [], calls = [], scrolls = [];
    const config = {
        notify: (message, type) => notices.push({ message, type }),
        copyText: text => { calls.push(text); return Promise.resolve(); },
        ...options,
    };
    dom.window.HTMLElement.prototype.scrollIntoView = function (options) { scrolls.push({ key: this.dataset.pfTodo, options }); };
    const draw = () => {
        const saved = T.capture(pane, view);
        pane.innerHTML = T.render(value, view);
        T.restore(pane, view, saved);
    };
    draw();
    pane.addEventListener('click', e => T.handleClick(e, pane, view, draw, config));
    return { dom, pane, view, notices, calls, scrolls, draw, config, value };
}
const two = () => detail([
    task(1, { role: 'Memo', sessionId: 's1', delegationId: 'd1', stage: 'working' }),
    task(2, { role: 'Memo', sessionId: 's2', delegationId: 'd2', stage: 'review' }),
]);
function jump(f, index = 0) { return f.pane.querySelectorAll('button[data-pf-locate]')[index]; }
function copy(f, field = 'delegationId', index = 0) {
    return [...f.pane.querySelectorAll('button[data-pf-copy]')].filter(el => el.dataset.pfCopy === field)[index];
}

test('delegation actions are native buttons; ordinary Todo has no action placeholders', t => {
    const f = fixture(t, two());
    assert.equal(f.pane.querySelectorAll('.pf-delegation-card button[data-pf-locate]').length, 2);
    for (const button of f.pane.querySelectorAll('[data-pf-locate],[data-pf-copy]')) {
        assert.equal(button.tagName, 'BUTTON');
        assert.equal(button.type, 'button');
        assert.ok(button.getAttribute('aria-label'));
    }
    f.value.todos = [task(1, null)];
    f.draw();
    assert.equal(f.pane.querySelectorAll('[data-pf-locate],[data-pf-copy]').length, 0);
});

test('card locates the exact Todo for same-role delegations, retaining filter and open notes', t => {
    const f = fixture(t, two());
    f.pane.querySelector('[data-pf-role="Memo"]').click();
    const firstNote = f.pane.querySelector('details');
    firstNote.open = true;
    jump(f, 1).click();
    const rows = f.pane.querySelectorAll('li[data-pf-todo]');
    assert.equal(rows[0].classList.contains('is-located'), false);
    assert.equal(rows[1].classList.contains('is-located'), true);
    assert.equal(f.dom.window.document.activeElement, rows[1].querySelector('[data-pf-title]'));
    assert.equal(f.scrolls.length, 1);
    assert.equal(f.scrolls[0].key, rows[1].dataset.pfTodo);
    assert.equal(f.scrolls[0].options.behavior, 'instant');
    assert.equal(f.view.role, 'Memo');
    assert.equal(firstNote.open, true);
    jump(f, 0).click();
    assert.equal(rows[0].classList.contains('is-located'), true);
    assert.equal(rows[1].classList.contains('is-located'), false);
});

test('copy uses normalized current identity, not arbitrary dataset text or paths', async t => {
    const f = fixture(t, two());
    const button = copy(f);
    assert.ok(button);
    button.dataset.value = 'file:///D:/private';
    button.click();
    await tick();
    copy(f, 'sessionId').click();
    await tick();
    assert.deepEqual(f.calls, ['d1', 's1']);
    assert.deepEqual(f.notices.map(n => n.type), ['info', 'info']);
    assert.equal(button.disabled, false);
    assert.equal(button.hasAttribute('aria-busy'), false);
    assert.equal(f.value.todos[0].note, '原始备注');
});

test('missing identifiers omit copy controls; absent session never copies an empty value', t => {
    const f = fixture(t, detail([task(1, { role: 'Memo' })]));
    assert.ok(jump(f));
    assert.equal(f.pane.querySelectorAll('[data-pf-copy]').length, 0);
    assert.equal(f.calls.length, 0);
});

test('untrusted keys and unknown copy kinds cannot select another project or write arbitrary data', async t => {
    const f = fixture(t, two());
    const button = copy(f);
    assert.ok(button);
    button.dataset.pfCopy = 'writePaths';
    button.click();
    button.dataset.pfCopy = 'delegationId';
    button.dataset.pfKey = '["other-source","other-project"]';
    button.click();
    jump(f).dataset.pfLocate = '["other-source","other-project"]';
    jump(f).click();
    await tick();
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.scrolls, []);
    assert.ok(f.notices.some(n => n.type === 'error'));
});

test('permission rejection is reported without echoing IDs, remains retryable', async t => {
    const secret = 'fixture-id-not-for-toast';
    const f = fixture(t, detail([task(1, { role: 'Memo', delegationId: secret })]), {
        copyText: () => Promise.reject(Error('NotAllowedError: ' + secret)),
    });
    const button = copy(f);
    assert.ok(button);
    button.click();
    await tick();
    assert.equal(button.disabled, false);
    assert.equal(f.notices.length, 1);
    assert.equal(f.notices[0].type, 'error');
    assert.doesNotMatch(f.notices[0].message, new RegExp(secret));
    f.config.copyText = value => { f.calls.push(value); return Promise.resolve(); };
    button.click();
    await tick();
    assert.deepEqual(f.calls, [secret]);
    assert.equal(f.notices[1].type, 'info');
});

test('pending copy suppresses duplicate submission on its button', async t => {
    let finish;
    const f = fixture(t, two(), { copyText: text => { f.calls.push(text); return new Promise(r => { finish = r; }); } });
    const button = copy(f);
    assert.ok(button);
    button.click();
    assert.equal(button.disabled, true);
    assert.equal(button.getAttribute('aria-busy'), 'true');
    const event = { target: button };
    T.handleClick(event, f.pane, f.view, f.draw, f.config);
    assert.deepEqual(f.calls, ['d1']);
    finish();
    await tick();
    assert.equal(button.disabled, false);
    assert.equal(f.notices.length, 1);
});

test('late clipboard completion after project switch produces no stale success toast', async t => {
    let finish;
    const f = fixture(t, two(), { copyText: () => new Promise(r => { finish = r; }) });
    const button = copy(f);
    assert.ok(button);
    button.click();
    f.value.project.id = 'next-project';
    f.draw();
    finish();
    await tick();
    assert.deepEqual(f.notices, []);
    assert.equal(f.pane.querySelector('.is-located'), null);
});

test('unavailable native clipboard reports failure; no execCommand fallback or IPC', async t => {
    const f = fixture(t, two(), { copyText: undefined });
    const button = copy(f);
    assert.ok(button);
    button.click();
    await tick();
    assert.equal(f.notices[0].type, 'error');
    assert.equal(button.disabled, false);
});

test('copy timeout returns control; a later resolution cannot overwrite failure', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let finish;
    const f = fixture(t, two(), { copyText: () => new Promise(r => { finish = r; }) });
    const button = copy(f);
    assert.ok(button);
    button.click();
    t.mock.timers.tick(4000);
    await tick();
    assert.equal(button.disabled, false);
    assert.equal(f.notices.length, 1);
    assert.equal(f.notices[0].type, 'error');
    finish();
    await tick();
    assert.equal(f.notices.length, 1);
});

test('new action focus and located title survive same-project replacement, reset on scope change', t => {
    const f = fixture(t, two());
    jump(f, 1).click();
    f.pane.parentElement.scrollTop = 247;
    f.draw();
    assert.equal(f.pane.querySelectorAll('.is-located').length, 1);
    assert.ok(f.dom.window.document.activeElement.hasAttribute('data-pf-title'));
    assert.equal(f.pane.parentElement.scrollTop, 247);
    jump(f).focus();
    const jumpKey = jump(f).dataset.pfLocate;
    f.draw();
    assert.equal(f.dom.window.document.activeElement.dataset.pfLocate, jumpKey);
    const copyButton = copy(f);
    const owner = copyButton.closest('[data-pf-card]') ? 'card' : 'detail';
    copyButton.focus();
    f.draw();
    assert.equal(f.dom.window.document.activeElement.dataset.pfCopy, 'delegationId');
    assert.equal(Boolean(f.dom.window.document.activeElement.closest('[data-pf-card]')), owner === 'card');
    f.value.project.catalog = { remote: true, sourceId: 'different-source', localProjectId: 'fixture' };
    f.draw();
    assert.equal(f.pane.querySelectorAll('.is-located').length, 0);
});

test('malicious identity text stays escaped, round-trips exactly when explicitly copied', async t => {
    const id = '"><img src=x onerror=bad()>&\'[id]';
    const f = fixture(t, detail([task(1, { role: id, delegationId: id, sessionId: id })]));
    assert.equal(f.pane.querySelectorAll('img,script,a,[data-file],[data-node],[data-history-maid]').length, 0);
    assert.ok(jump(f));
    jump(f).click();
    copy(f).click();
    await tick();
    assert.deepEqual(f.calls, [id]);
});

test('native browser clipboard branch writes only the requested ID, without clipboard reads', async t => {
    const f = fixture(t, two());
    delete f.config.copyText;
    const writes = [];
    Object.defineProperty(f.dom.window.navigator, 'clipboard', { value: {
        writeText: value => { writes.push(value); return Promise.resolve(); },
        readText: () => { throw Error('CLIPBOARD_READ_FORBIDDEN'); },
    } });
    copy(f, 'sessionId', 1).click();
    await tick();
    assert.deepEqual(writes, ['s2']);
    assert.equal(f.notices[0].type, 'info');
    assert.equal(f.scrolls.length, 0);
});

test('same-project refresh invalidates pending copy feedback and stale detached buttons', async t => {
    let finish;
    const f = fixture(t, two(), { copyText: () => new Promise(r => { finish = r; }) });
    const button = copy(f);
    button.click();
    f.draw();
    assert.equal(T.handleClick({ target: button }, f.pane, f.view, f.draw, f.config), false);
    finish();
    await tick();
    assert.deepEqual(f.notices, []);
    assert.equal(copy(f).disabled, false);
});

test('returning to the original scope does not revive a detached clipboard completion', async t => {
    let finish;
    const f = fixture(t, two(), { copyText: () => new Promise(r => { finish = r; }) });
    copy(f).click();
    f.value.project.id = 'next-project'; f.draw();
    f.value.project.id = 'fixture'; f.draw();
    finish();
    await tick();
    assert.deepEqual(f.notices, []);
});

test('missing rendered target reports failure; unrelated history controls remain unhandled', t => {
    const f = fixture(t, two());
    const button = jump(f);
    f.pane.querySelector('li[data-pf-todo]').remove();
    button.click();
    assert.equal(f.notices[0].type, 'error');
    assert.deepEqual(f.scrolls, []);
    const history = f.dom.window.document.createElement('button');
    history.dataset.historyMaid = 'Kerr';
    f.pane.append(history);
    assert.equal(T.handleClick({ target: history }, f.pane, f.view, f.draw, f.config), false);
});