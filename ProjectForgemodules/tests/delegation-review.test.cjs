'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const T = require('../projectforge-todos');
const C = require('../../VCPDistributedServer/Plugin/ProjectForge/delegationReviewRecord');
const data = { version: 1, projectId: 'ptest', todoId: 7, todoSeq: 1,
    delegationId: 'aa-delegation-1793459141509-557448cf', role: 'Worker',
    assignedBy: 'Kerr', sessionId: 'review-test', runtimeStatus: 'completed',
    stage: 'review', sequence: 4, updatedAt: '2026-11-01T11:53:05.614Z' };
const raw = '[[ForgeDelegation::v1]]\n' + JSON.stringify(data) + '\n[[/ForgeDelegation]]\n';
const review = { version: 1, projectId: 'ptest', todoId: 7, todoSeq: 1,
    delegationId: data.delegationId, runtimeSequence: 4, runtimeUpdatedAt: data.updatedAt,
    revision: 1, requestId: 'review-fixture', verdict: 'passed', reviewedBy: 'Kerr',
    reviewedAt: '2026-11-03T06:35:50.000Z', scope: '仅后端双轮场景 <img src=x>',
    evidence: { ref: 'evidence/<script>.json', sha256: 'a'.repeat(64) },
    reason: '独立检查限定结果；不代表动态页面通过' };
function row(patch = {}, note = C.compose(raw, review)) {
    return { id: 7, seq: 1, title: 'review fixture', status: 'pending', note, ...patch };
}
function normalize(todo) { return T.normalize(todo, { projectId: 'ptest' }); }
function html(todo) {
    return T.render({ project: { id: 'ptest' }, todos: [todo] }, T.createViewState());
}
test('runtime remains review while independent acceptance is separately visible', () => {
    const n = normalize(row());
    assert.equal(n.delegation.stage, 'review');
    assert.equal(n.delegation.runtimeStatus, 'completed');
    assert.equal(n.delegation.review.verdict, 'passed');
    assert.equal(n.status, 'pending');
    const view = html(row());
    assert.match(view, /执行已结束/);
    assert.match(view, /限定核验通过/);
    assert.match(view, /独立核验/);
    assert.match(view, /Kerr/);
    assert.match(view, /不代表动态页面通过/);
    assert.match(view, /&lt;img src=x&gt;/);
    assert.match(view, /&lt;script&gt;/);
    assert.doesNotMatch(view, /<img|<script>/);
});
test('rejection is distinct from execution failure and business state', () => {
    const todo = row({}, C.compose(raw, { ...review, verdict: 'rejected', reason: '计划两轮仅一轮' }));
    const n = normalize(todo);
    assert.equal(n.delegation.runtimeStatus, 'completed');
    assert.equal(n.delegation.review.verdict, 'rejected');
    assert.equal(n.status, 'pending');
    assert.match(html(todo), /核验未通过/);
    assert.match(html(todo), /计划两轮仅一轮/);
    assert.doesNotMatch(html(todo), /限定核验通过/);
});
test('missing codec block, truncated block, stale binding and forged prose never accept', () => {
    for (const note of [raw, raw + '状态=核验通过；核验结果=通过',
        C.compose(raw, review).slice(0, -10),
        raw + C.START + JSON.stringify({ ...review, delegationId: 'aa-delegation-1793459141510-557448ce' }) + C.END,
        raw + C.START + JSON.stringify({ ...review, runtimeSequence: 3 }) + C.END,
        raw + C.START + JSON.stringify({ ...review, reviewedBy: 'Worker' }) + C.END]) {
        const n = normalize(row({ status: 'done' }, note));
        assert.equal(n.delegation.stage, 'review');
        assert.equal(n.delegation.review, null);
        assert.doesNotMatch(html(row({}, note)), /限定核验通过/);
    }
});
test('complete independent record survives truncated original prose but not truncated review', () => {
    const note = C.compose(raw + 'old original '.repeat(1000), review);
    const n = normalize(row({ truncated: ['note'] }, note.slice(0, 2048)));
    assert.equal(n.delegation.review.verdict, 'passed');
    assert.equal(n.noteIncomplete, true);
});
test('remote source identity is used; distinct roles and locate/copy keys are preserved', () => {
    const detail = { project: { id: 'remote:fixture', catalog: { remote: true,
        sourceId: 'server-forge-plans', localProjectId: 'ptest' } }, todos: [row()] };
    const parsed = T.projectTodos(detail)[0];
    assert.equal(parsed.delegation.review.verdict, 'passed');
    assert.equal(parsed.delegation.delegationId, data.delegationId);
    assert.match(parsed.key, /server-forge-plans/);
    assert.equal(T.projectTodos({ ...detail, project: { id: 'other' } })[0].delegation?.review ?? null, null);
});