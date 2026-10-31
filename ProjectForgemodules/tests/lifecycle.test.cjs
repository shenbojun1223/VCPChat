'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const T = require('../projectforge-todos');
const base = {
    version: 1, projectId: 'ptest', todoId: 7, todoSeq: 1,
    delegationId: 'aa-delegation-1793459141509-557448cf', role: '鲸鱼娘#live',
    assignedBy: 'Kerr', sessionId: 'lifecycle-test', runtimeStatus: 'queued',
    stage: 'pending', sequence: 0, updatedAt: '2026-10-31T15:00:00.000Z',
};
function note(data, original = '执行分身=Old;阶段=核验通过') {
    return '[[ForgeDelegation::v1]]\n' + JSON.stringify(data) + '\n[[/ForgeDelegation]]\n' + original;
}
const normalize = (data, extra = {}) => T.normalize({
    id: 7, seq: 1, title: 'Task', status: 'done', note: note(data), ...extra,
}, { projectId: 'ptest' });
for (const [runtimeStatus, stage, label] of [
    ['queued', 'pending', '待受理'], ['running', 'working', '施工中'],
    ['waiting', 'working', '等待续跑'], ['cancelling', 'working', '取消中'],
    ['completed', 'review', '待核验'], ['failed', 'unknown', '执行失败'],
    ['cancelled', 'unknown', '已取消'], ['stopped', 'unknown', '已停止'],
]) test('host lifecycle ' + runtimeStatus + ' stays distinct from acceptance and business done', () => {
    const row = normalize({ ...base, runtimeStatus, stage });
    assert.equal(row.delegation.source, 'runtime');
    assert.equal(row.delegation.stage, stage);
    assert.equal(row.delegation.stageLabel, label);
    assert.equal(row.delegation.role, base.role);
    assert.equal(row.delegation.rejected, false);
    assert.equal(row.status, 'done');
    assert.notEqual(row.delegation.stage, 'verified');
    assert.match(row.rawNote, /执行分身=Old/);
});
test('complete host block survives truncation of original prose but incomplete block cannot certify state', () => {
    const data = { ...base, runtimeStatus: 'completed', stage: 'review' };
    assert.equal(normalize(data, { truncated: ['note'] }).delegation.stage, 'review');
    const row = normalize(data, { note: note(data).slice(0, 100), truncated: ['note'] });
    assert.equal(row.delegation, null);
});
test('mismatched project, Todo row or seq, illegal stage and extra fields are not trusted', () => {
    for (const patch of [{ projectId: 'other' }, { todoId: 9 }, { todoSeq: 2 },
        { stage: 'verified' }, { runtimeStatus: 'constructor' }, { arbitrary: true }]) {
        const row = normalize({ ...base, ...patch });
        assert.notEqual(row.delegation?.source, 'runtime');
    }
});
test('display escapes host identity and labels origin as a lifecycle snapshot, not verification', () => {
    const data = { ...base, role: '<img src=x>', runtimeStatus: 'completed', stage: 'review' };
    const detail = { project: { id: 'ptest' }, todos: [{
        id: 7, seq: 1, title: 'Task', status: 'done', note: note(data),
    }] };
    const html = T.render(detail, T.createViewState());
    assert.match(html, /宿主生命周期快照/);
    assert.match(html, /&lt;img src=x&gt;/);
    assert.doesNotMatch(html, /phase-verified|<img/);
});