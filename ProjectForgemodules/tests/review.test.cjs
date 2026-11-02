'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const T = require('../projectforge-todos.js');
const todo = (note, extra = {}) => ({ seq: 1, title: '【审查】原始标题', status: 'done', note, ...extra });
const row = note => T.normalize(todo(note));
const detail = todos => ({ project: { id: 'review', progress: { total: todos.length } }, todos });

for (const [label, note] of [
    ['verification after ID', '执行分身=Memo;阶段=核验通过;delegationId=d1。核验结果=不通过'],
    ['negative phase after ID', '执行分身=Memo;阶段=核验通过;delegationId=d1。阶段=核验未通过'],
    ['negative phase before approval', '执行分身=Memo。阶段=核验未通过;delegationId=d1。阶段=核验通过'],
    ['duplicate verification retains denial', '执行分身=Memo;核验结果=通过;阶段=核验通过;delegationId=d1。核验结果=不通过'],
]) {
    test('P1 denies false approval: ' + label, () => {
        const d = row(note).delegation;
        assert.notEqual(d.stage, 'verified');
        assert.equal(d.rejected, true, 'explicit denial must remain visible');
    });
}
test('P1 explicit fields after identities are independent of sentence order', () => {
    for (const note of [
        '执行分身=Memo。阶段=核验通过。delegationId=d1',
        'delegationId=d1。阶段=核验通过。执行分身=Memo',
        '阶段=核验通过。执行分身=Memo。delegationId=d1',
    ]) {
        const d = row(note).delegation;
        assert.equal(d.role, 'Memo');
        assert.equal(d.delegationId, 'd1');
        assert.equal(d.stage, 'verified');
    }
});
test('P1 non-keyed caveats in a stage value are not discarded', () => {
    for (const suffix of ['仍需确认', '仅为历史状态', '引用文本：核验通过']) {
        const d = row('执行分身=Memo;delegationId=d1。阶段=核验通过。' + suffix).delegation;
        assert.equal(d.stage, 'unknown', suffix);
    }
    const d = row('执行分身=Memo;delegationId=d1。阶段=核验通过。核验未通过').delegation;
    assert.equal(d.rejected, true);
});
test('P1 paths and artifacts are opaque and raw notes are preserved', () => {
    const note = '执行分身=Memo;delegationId=task.v2。阶段=待核验;约定写入=src/v1.2/a.js;约定产物=报告。最终.md。阶段=核验通过';
    const value = row(note);
    assert.equal(value.delegation.delegationId, 'task.v2');
    assert.equal(value.delegation.stage, 'review');
    assert.deepEqual(value.delegation.artifacts, ['报告。最终.md。阶段=核验通过']);
    assert.deepEqual(value.delegation.writePaths, ['src/v1.2/a.js']);
    assert.equal(value.rawNote, note);
    assert.equal(row('约定产物=说明。执行分身=NotAnExecutor').delegation, null);
});
test('P1 contradictory stages and truncated notes never certify approval', () => {
    assert.equal(row('执行分身=Memo。阶段=施工中。阶段=核验通过').delegation.stage, 'unknown');
    const value = T.normalize(todo('执行分身=Memo。阶段=核验通过。delegationId=partial', { truncated: ['note'] }));
    assert.equal(value.delegation.stage, 'unknown');
    assert.equal(value.delegation.delegationId, '');
});
test('P2 status alias recognizes pending review without certifying completed Todos', () => {
    const d = row('执行分身=Memo;状态=已完成报告，待核验').delegation;
    assert.equal(d.stage, 'review');
    assert.equal(d.source, 'note');
});
test('P2 explicit review delivery acceptance retains its limited meaning and evidence', () => {
    const note = '执行分身=@鲸鱼娘#记忆审查；派工方/验收=@Kerr；session_id=s2；delegationId=d2。状态=审查交付已独立核验并接受。证据：DebugLog/review-memory.md，b89/n89';
    const d = row(note).delegation;
    assert.equal(d.stage, 'verified');
    assert.equal(d.stageLabel, '审查交付已接受');
    assert.match(d.scope, /审查交付/);
    assert.match(d.stageEvidence, /已独立核验并接受/);
    assert.equal(d.assignedBy, '@Kerr');
    const html = T.render(detail([todo(note)]), T.createViewState());
    assert.match(html, /审查交付已接受/);
    assert.match(html, /判定依据/);
});
test('P2 scoped verification displays the actual scope, not unrestricted approval', () => {
    const scope = '共享知识库一次create、同篇一次update、无旧历史/答案的新会话一次DailyNoteSearcher检索并答对';
    const note = '执行分身=Memo;状态=限定范围验收通过：' + scope + '。原始日志依次113640_978-f641、114212_502-0dae';
    const d = row(note).delegation;
    assert.equal(d.stage, 'verified');
    assert.equal(d.stageLabel, '限定范围验收通过');
    assert.equal(d.scope, scope);
    const dom = new JSDOM(T.render(detail([todo(note)]), T.createViewState()));
    try {
        const doc = dom.window.document;
        assert.equal(doc.querySelector('.pf-delegation-phase').textContent, '限定范围验收通过');
        assert.match(doc.querySelector('.pf-delegation-detail').textContent, new RegExp(scope));
        assert.match(doc.querySelector('.pf-delegation-steps').getAttribute('aria-label'), /限定范围/);
    } finally { dom.window.close(); }
});
test('P2 conditional, historical, quoted and caveated acceptance cannot turn green', () => {
    for (const value of [
        '待验收通过后再接受', '未验收通过', '历史状态=核验通过', '引用文本：核验通过',
        '“审查交付已独立核验并接受”', '如果核验通过则接受', '核验通过后再接受',
        '审查交付已独立核验并接受。仍需确认', '限定范围验收通过：如果复测通过后再接受',
        '限定范围验收通过：报告。核验未通过',
    ]) {
        assert.notEqual(row('执行分身=Memo;状态=' + value).delegation.stage, 'verified', value);
    }
    assert.equal(row('执行分身=Memo;状态=核验通过;delegationId=d1。状态=核验未通过').delegation.rejected, true);
});
test('P2 compound dispatcher keys do not promote a mere verifier to dispatcher', () => {
    assert.equal(row('执行分身=Memo;验收=@Kerr').delegation.assignedBy, '');
    assert.equal(row('执行分身=Memo;派工/验收=@Kerr').delegation.assignedBy, '@Kerr');
    assert.equal(row('验收=@Kerr;状态=核验通过').delegation, null);
    const d = row('复测按限定文件边界与审查交付接受，验收=@Kerr。执行分身=Memo').delegation;
    assert.equal(d.stage, 'unknown', 'unkeyed narration remains unknown');
    assert.equal(d.delegationId, '');
});
test('P2 multiple explicit roles produce independent filters, never duplicate cards', () => {
    const note = '执行分身=@鲸鱼娘#知识沉淀、@鲸鱼娘#独立记忆读取;状态=施工中';
    const value = detail([todo(note)]), view = T.createViewState();
    const prepared = T.prepare(value, view);
    assert.deepEqual(prepared.rows[0].delegation.roles, ['@鲸鱼娘#知识沉淀', '@鲸鱼娘#独立记忆读取']);
    assert.equal(prepared.rows[0].delegation.role, '@鲸鱼娘#知识沉淀、@鲸鱼娘#独立记忆读取');
    assert.deepEqual(prepared.roles, ['@鲸鱼娘#知识沉淀', '@鲸鱼娘#独立记忆读取']);
    const dom = new JSDOM('<div class="tab-body"><div id="pane"></div></div>');
    try {
        const pane = dom.window.document.getElementById('pane');
        const draw = () => {
            const saved = T.capture(pane, view);
            pane.innerHTML = T.render(value, view);
            T.restore(pane, view, saved);
        };
        draw();
        dom.window.HTMLElement.prototype.scrollIntoView = function () {};
        pane.addEventListener('click', e => T.handleClick(e, pane, view, draw));
        assert.match(pane.textContent, /1 条委托记录/);
        assert.match(pane.querySelector('[data-pf-title]').textContent, /【审查】原始标题/);
        for (const role of prepared.roles) {
            const button = [...pane.querySelectorAll('[data-pf-role]')].find(el => el.dataset.pfRole === role);
            button.focus(); button.click();
            assert.equal(view.role, role);
            assert.equal(pane.querySelectorAll('.pf-delegation-card').length, 1);
            assert.equal(pane.querySelectorAll('[data-pf-todo]').length, 1);
            assert.equal(dom.window.document.activeElement.dataset.pfRole, role);
            pane.querySelector('[data-pf-locate]').click();
            assert.equal(view.located, prepared.rows[0].key);
        }
        assert.equal(pane.querySelectorAll('[data-pf-copy]').length, 0, 'missing IDs do not imply an asynchronous delegation');
    } finally { dom.window.close(); }
});
test('P2 structured roles are bounded, deduplicated and type checked', () => {
    const input = todo('', { subagent: { roles: ['A', 'B', 'A', '', 9, {}, 'x'.repeat(513)], stage: 'working' } });
    const before = JSON.stringify(input), d = T.normalize(input).delegation;
    assert.deepEqual(d.roles, ['A', 'B']);
    assert.equal(d.stage, 'working');
    assert.equal(JSON.stringify(input), before);
    assert.equal(T.normalize(todo('', { subagent: { roles: [9, {}], stage: 'verified' } })).delegation, null);
});
test('P1 interposed identity cannot hide a following denial or reservation', () => {
    for (const note of [
        '执行分身=Memo;阶段=核验通过。派工方=Kerr。核验未通过',
        '执行分身=Memo;阶段=核验通过;delegationId=d1。核验未通过',
        '执行分身=Memo;阶段=核验通过;delegationId=d1。核验结果=不通过。证据：deny.md',
    ]) {
        const d = row(note).delegation;
        assert.notEqual(d.stage, 'verified', note);
        assert.equal(d.rejected, true, note);
    }
    assert.equal(row('执行分身=Memo;阶段=核验通过。派工方=Kerr。仍需确认').delegation.stage, 'unknown');
});
test('P2 a terminal sentence mark is not a caveat and invalid roles cannot hide a valid executor', () => {
    assert.equal(row('执行分身=Memo。阶段=核验通过。').delegation.stage, 'verified');
    const d = T.normalize(todo('', { subagent: { role: 'Memo', roles: [9, {}], stage: 'working' } })).delegation;
    assert.deepEqual(d.roles, ['Memo']);
});
test('P1 unexplained identity suffixes conservatively block approval without inventing rejection', () => {
    for (const suffix of ['并非最终结论', '暂不接受', '结论存在争议']) {
        const d = row('执行分身=Memo;阶段=核验通过;delegationId=d1。' + suffix).delegation;
        assert.equal(d.stage, 'unknown', suffix);
        assert.equal(d.rejected, false, 'a caveat is not an explicit failed verification');
    }
});