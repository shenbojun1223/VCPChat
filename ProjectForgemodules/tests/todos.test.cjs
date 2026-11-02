'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const T = require('../projectforge-todos.js');
const todo = (note, extra = {}) => ({ seq: 1, title: '实现', status: 'doing', note, updated_by: 'Kerr', ...extra });
const detail = todos => ({ project: { id: 'fixture', progress: { total: todos.length } }, todos });
const normalized = (note, extra) => T.normalize(todo(note, extra));

test('ordinary Todo updater never becomes executor or dispatcher', () => {
    const row = normalized('已完成报告，待核验', { status: 'done' });
    assert.equal(row.delegation, null);
    const html = T.render(detail([todo('正常备注')]), T.createViewState());
    assert.match(html, /更新者 @Kerr/);
    assert.doesNotMatch(html, /委托监视席|data-pf-role|主控|派工方/);
});
test('legacy delimiters, whitespace and explicit roles normalize without mutation', () => {
    const source = todo(' 执行分身 ： MemoMaster ；派工方=Kerr; session_id : s1；委托阶段：施工中；约定写入=src/a.js');
    const snapshot = JSON.stringify(source), row = T.normalize(source);
    assert.equal(row.delegation.role, 'MemoMaster');
    assert.equal(row.delegation.assignedBy, 'Kerr');
    assert.equal(row.delegation.stage, 'working');
    assert.equal(row.delegation.sessionId, 's1');
    assert.deepEqual(row.delegation.writePaths, ['src/a.js']);
    assert.equal(row.rawNote, source.note);
    assert.equal(JSON.stringify(source), snapshot);
});
test('report completion and negative verification never become approved', () => {
    for (const phase of ['已完成报告，待核验', '已完成报告', '已核验', '已核验但不通过', '核验未通过']) {
        const row = normalized(`执行分身=Memo;委托阶段=${phase}`, { status: 'done' });
        assert.notEqual(row.delegation.stage, 'verified', phase);
        assert.equal(row.status, 'done');
    }
    assert.equal(normalized('执行分身=Memo;阶段=已完成报告，待核验').delegation.stage, 'review');
    assert.equal(normalized('执行分身=Memo;阶段=已核验但不通过').delegation.rejected, true);
    assert.equal(normalized('执行分身=Memo;阶段=核验通过').delegation.stage, 'verified');
});
test('blocked Todo overlays warning without inventing failed verification', () => {
    for (const stage of ['施工中', '待受理', '未知']) {
        const row = normalized(`执行分身=Memo;阶段=${stage}`, { status: 'blocked' });
        assert.equal(row.delegation.rejected, false);
    }
    const html = T.render(detail([todo('执行分身=Memo;阶段=施工中', { status: 'blocked' })]), T.createViewState());
    assert.match(html, /phase-working/);
    assert.match(html, /Todo 阻塞/);
    assert.doesNotMatch(html, /核验退回|phase-verified/);
});
test('structured data is projected, type checked and takes precedence over note', () => {
    const row = normalized('执行分身=Old;阶段=核验通过', {
        subagent: { role: 'New', stage: 'working', assignedBy: 7, session_id: 's2', writePaths: ['a', 9], arbitrary: '<img>', verification: 'pending' },
    });
    assert.equal(row.delegation.role, 'New');
    assert.equal(row.delegation.stage, 'working');
    assert.equal(row.delegation.assignedBy, '');
    assert.equal(row.delegation.source, 'structured');
    assert.deepEqual(row.delegation.writePaths, ['a']);
    assert.equal('arbitrary' in row.delegation, false);
    for (const subagent of [null, [], 'memo', 2, {}]) {
        assert.equal(normalized('执行分身=Old;阶段=施工中', { subagent }).delegation.role, 'Old');
    }
    for (const stage of ['done', '<img>', ['verified'], {}, null]) {
        assert.equal(normalized('', { subagent: { role: 'Memo', stage } }).delegation.stage, 'unknown');
    }
    assert.equal(normalized('', { status: ['done'] }).status, 'unknown');
});
test('conflicting explicit verification is conservative', () => {
    assert.equal(normalized('', { subagent: { role: 'Memo', stage: 'verified', verification: 'failed' } }).delegation.rejected, true);
    assert.equal(normalized('', { subagent: { role: 'Memo', stage: 'verified', verification: 'pending' } }).delegation.stage, 'unknown');
    assert.equal(normalized('执行分身=Memo;阶段=施工中;阶段=核验通过').delegation.stage, 'unknown');
    assert.equal(normalized('执行分身=A;执行分身=B').delegation, null);
    for (const verification of ['已核验但不通过', '核验未通过', '未确认', '', ['passed']]) {
        const row = normalized('', { subagent: { role: 'Memo', stage: 'verified', verification } });
        assert.notEqual(row.delegation.stage, 'verified');
    }
    assert.equal(normalized('执行分身=Memo;阶段=constructor').delegation.stage, 'unknown');
    assert.equal(normalized('', { subagent: { role: 'Memo', stage: 'verified', verification: 'passed' } }).delegation.stage, 'verified');
});
test('list preview is distinct from field preview and title truncation', () => {
    const value = detail([
        todo('执行分身=Memo;阶段=核验通过', { truncated: ['title'] }),
        todo('执行分身=Memo;阶段=核验通过;约定产物=part', { seq: 2, truncated: ['note'] }),
    ]);
    value.project.progress.total = 9;
    const rows = T.projectTodos(value);
    assert.equal(rows[0].delegation.stage, 'verified');
    assert.equal(rows[1].delegation.stage, 'unknown');
    const html = T.render(value, T.createViewState());
    assert.match(html, /仅展示部分任务/);
    assert.match(html, /phase-verified/);
    const structured = normalized('执行分身=Old;阶段=核验通', { truncated: ['note'], subagent: { role: 'Memo', stage: 'working' } });
    assert.equal(structured.delegation.stage, 'working');
});
test('same role is one filter but separate delegation cards; identities include source/project/Todo', () => {
    const value = detail([
        todo('执行分身=Memo;session_id=s1;delegationId=d1;阶段=施工中'),
        todo('执行分身=Memo;session_id=s2;delegationId=d2;阶段=待核验', { seq: 2 }),
    ]);
    const view = T.createViewState(), { rows, roles } = T.prepare(value, view);
    assert.deepEqual(roles, ['Memo']);
    assert.notEqual(rows[0].key, rows[1].key);
    assert.notEqual(T.normalize(value.todos[0], { sourceId: 'server' }).key, T.normalize(value.todos[0], { sourceId: 'local' }).key);
    const dom = new JSDOM(T.render(value, view));
    try {
        assert.equal(dom.window.document.querySelectorAll('.pf-delegation-card').length, 2);
        assert.equal(dom.window.document.querySelectorAll('[data-pf-role]').length, 2);
    } finally { dom.window.close(); }
});
test('all dynamic fields and attributes are escaped; no path navigation or write hooks', () => {
    const evil = '"><img src=x onerror=bad()><script>bad()</script>';
    const value = detail([todo(evil, { title: evil, status: evil, seq: evil, updated_by: evil,
        subagent: { role: evil, assignedBy: evil, stage: evil, sessionId: evil, artifacts: [evil], writePaths: ['D:/private'] },
    })]);
    const dom = new JSDOM(T.render(value, T.createViewState()));
    try {
        const d = dom.window.document;
        assert.equal(d.querySelectorAll('img,script,a,[data-file],[data-node],[data-history-maid]').length, 0);
        assert.match(d.body.textContent, /<img/);
        assert.equal(d.querySelector('.todo-state').className, 'todo-state unknown');
        for (const el of d.querySelectorAll('*')) for (const attr of el.attributes) assert.doesNotMatch(attr.name, /^on/i);
    } finally { dom.window.close(); }
});
test('huge note, missing fields and anomalous input remain bounded and nonmutating', () => {
    assert.equal(T.normalize(null).delegation, null);
    assert.equal(T.normalize({ subagent: [] }).rawNote, '');
    const note = '执行分身=Memo;阶段=核验通过;' + 'x'.repeat(70000);
    const row = normalized(note);
    assert.equal(row.delegation.stage, 'unknown');
    assert.equal(row.rawNote, note);
});
test('filter updates, note expansion, focus and scroll survive same-project DOM replacement', () => {
    const dom = new JSDOM('<div class="tab-body"><div id="pane" tabindex="-1"></div></div>');
    try {
        const pane = dom.window.document.getElementById('pane'), view = T.createViewState();
        const value = detail([todo('执行分身=Memo;阶段=施工中'), todo('普通', { seq: 2 })]);
        const draw = () => {
            const saved = T.capture(pane, view);
            pane.innerHTML = T.render(value, view);
            T.restore(pane, view, saved);
        };
        draw();
        pane.addEventListener('click', e => T.handleClick(e, pane, view, draw));
        const filter = pane.querySelector('[data-pf-role="Memo"]');
        filter.focus(); filter.click();
        assert.equal(view.role, 'Memo');
        assert.equal(pane.querySelectorAll('.pf-todo-list > li').length, 1);
        assert.equal(dom.window.document.activeElement.dataset.pfRole, 'Memo');
        pane.querySelector('details').open = true;
        pane.querySelector('summary').focus();
        pane.parentElement.scrollTop = 123;
        draw();
        assert.equal(pane.querySelector('details').open, true);
        assert.equal(dom.window.document.activeElement.tagName, 'SUMMARY');
        assert.equal(pane.parentElement.scrollTop, 123);
        value.todos = [todo('普通', { seq: 2 })];
        draw();
        assert.equal(view.role, '');
        assert.equal(pane.querySelector('[data-pf-role]'), null);
        value.project.id = 'different';
        draw();
        assert.equal(view.expanded.size, 0);
        assert.equal(pane.parentElement.scrollTop, 0);
    } finally { dom.window.close(); }
});
test('remote scope resets view, while version refresh preserves existing note keys', () => {
    const value = detail([todo('执行分身=Memo;阶段=施工中')]), view = T.createViewState();
    const row = T.prepare(value, view).rows[0];
    view.role = 'Memo'; view.expanded.add(row.key);
    T.prepare(value, view);
    assert.equal(view.expanded.size, 1);
    value.project.catalog = { remote: true, sourceId: 'remote', localProjectId: 'fixture', version: 1 };
    T.prepare(value, view);
    assert.equal(view.role, '');
    assert.equal(view.expanded.size, 0);
    const remoteKey = T.projectTodos(value)[0].key;
    view.expanded.add(remoteKey);
    value.project.catalog.version++;
    T.prepare(value, view);
    assert.equal(view.expanded.has(remoteKey), true);
});

test('legacy sentence-delimited identities exclude narration and preserve raw notes', () => {
    const note = '复测按限定文件边界接受，验收=@Kerr。执行分身=@鲸鱼娘#边界复测；session_id=ps8vm-closeout-boundary-20261028；delegationId=aa-delegation-1793192155160-f37d4059。两段原始日志说明。';
    const row = normalized(note, { status: 'done' });
    assert.equal(row.delegation.role, '@鲸鱼娘#边界复测');
    assert.equal(row.delegation.sessionId, 'ps8vm-closeout-boundary-20261028');
    assert.equal(row.delegation.delegationId, 'aa-delegation-1793192155160-f37d4059');
    assert.equal(row.delegation.assignedBy, '');
    assert.equal(row.delegation.stage, 'unknown');
    assert.equal(row.rawNote, note);
    const review = normalized('执行分身=@鲸鱼娘#记忆审查；派工方/验收=@Kerr；session_id=s2；delegationId=d2。状态=审查交付已独立核验并接受。证据：review.md');
    assert.equal(review.delegation.delegationId, 'd2');
    assert.equal(review.delegation.stage, 'verified');
    assert.equal(review.delegation.stageLabel, '审查交付已接受');
    assert.match(review.delegation.scope, /仅审查交付/);
});
test('sentence identity compatibility never drops negative stage evidence or splits file paths', () => {
    assert.equal(normalized('执行分身=Memo;阶段=核验通过。核验未通过').delegation.rejected, true);
    assert.equal(normalized('执行分身=Memo;阶段=核验通过。仍需确认').delegation.stage, 'unknown');
    assert.equal(normalized('执行分身=Memo;阶段=核验通过。待核验').delegation.stage, 'review');
    assert.equal(normalized('约定产物=说明。执行分身=NotAnExecutor').delegation, null);
    const row = normalized('执行分身=Memo;session_id=session.v1;delegationId=task.v2。说明；约定写入=src/v1.2/a.js；约定产物=报告。最终.md');
    assert.equal(row.delegation.sessionId, 'session.v1');
    assert.equal(row.delegation.delegationId, 'task.v2');
    assert.deepEqual(row.delegation.writePaths, ['src/v1.2/a.js']);
    assert.deepEqual(row.delegation.artifacts, ['报告。最终.md']);
});
test('truncated sentence-delimited identity retains complete prefixes only, with unknown phase', () => {
    const row = normalized('执行分身=Memo。session_id=s1。delegationId=partial', { truncated: ['note'] });
    assert.equal(row.delegation.role, 'Memo');
    assert.equal(row.delegation.sessionId, 's1');
    assert.equal(row.delegation.delegationId, '');
    assert.equal(row.delegation.stage, 'unknown');
});