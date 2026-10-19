'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const A = require('../VCPDistributedServer/Plugin/ProjectForge/args');
const forge = require('../VCPDistributedServer/Plugin/ProjectForge/ProjectForgeService');
const call = args => forge.processToolCall(args);
const text = r => r.content.filter(p => p.type === 'text').map(p => p.text).join('\n');
let temp, workspace, seq = 0;

test.before(() => {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-upstream-edit-'));
    workspace = path.join(temp, 'workspace');
    fs.mkdirSync(workspace);
    forge.initialize({
        dbPath: path.join(temp, 'fixture.db'),
        services: { workspaceService: {
            list: () => [{ id: 'fixture', alias: 'fixture', path: workspace, enabled: true }],
            getActiveWorkspaceId: () => 'fixture',
        } },
        trash: async file => fs.renameSync(file, path.join(temp, 'trash-' + (++seq))),
        logger: { log() {}, warn() {}, error() {} },
    });
});
test.after(async () => {
    await forge.cleanup();
    if (temp) fs.rmSync(temp, { recursive: true, force: true });
});
async function fixture() {
    const dir = 'project-' + (++seq);
    const created = await call({ command: 'CreateProject', name: dir, dir, todos: 'one\ntwo\nthree' });
    const id = created.details.project.id;
    const source = 'const alpha = 1;\nconst beta = 2;\n';
    const r = await call({ command: 'CreateFile', projectId: id, path: 'a.js', content: source, reason: 'fixture' });
    assert.equal(r.details.status, 'ok', text(r));
    const store = forge._test.getRuntime().store;
    return {
        id, store, source,
        read: () => fs.readFileSync(path.join(workspace, dir, 'a.js'), 'utf8'),
        todos: () => store.listTodos(id),
    };
}
test('parser rejects numbered target combined with unnumbered replacement', () => {
    assert.throws(() => A.parseEditSteps({ target1: 'alpha', replace: 'omega' }), /不带编号/);
});
test('parser rejects orphan flat replacement even when numbered step 1 is absent', () => {
    assert.throws(() => A.parseEditSteps({ target2: 'beta', replace2: 'delta', replace: 'omega' }), /不带编号/);
});
test('parser folds a complete flat step into step 1 with non-enumerable notes', () => {
    const steps = A.parseEditSteps({ target: 'alpha', replace: 'omega', target2: 'beta', replace2: 'delta', reason: 'batch', todo: '1,2' });
    assert.deepEqual(steps.map(s => s.step), [1, 2]);
    assert.equal(steps[0].replace, 'omega');
    assert.equal(steps[0].todo, undefined);
    assert.match(steps.notes.join('\n'), /步骤 1/);
    assert.equal(Object.getOwnPropertyDescriptor(steps, 'notes').enumerable, false);
});
test('ambiguous edit rejects before file or Todo changes', async () => {
    const f = await fixture();
    const todos = f.todos();
    const fileState = f.store.getFileState(f.id, 'a.js');
    await assert.rejects(call({
        command: 'EditCode', projectId: f.id, path: 'a.js',
        target1: 'alpha', replace: 'omega', todo: '1,2', reason: 'must reject',
    }), /不带编号/);
    assert.equal(f.read(), f.source);
    assert.deepEqual(f.todos(), todos);
    assert.equal(f.store.getFileState(f.id, 'a.js'), fileState);
});
test('normalized step notes reach the public edit result', async () => {
    const f = await fixture();
    const r = await call({
        command: 'EditCode', projectId: f.id, path: 'a.js', reason: 'normalize',
        target: 'alpha', replace: 'omega', target2: 'beta', replace2: 'delta',
    });
    assert.equal(r.details.status, 'ok', text(r));
    assert.equal(f.read(), 'const omega = 1;\nconst delta = 2;\n');
    assert.match(text(r), /步骤 1/);
});
test('numbered edits do not inject the symbol suffix as an unnumbered step', async () => {
    const f = await fixture();
    const r = await call({
        command: 'EditCode', projectId: f.id, path: 'a.js#notAnActualSymbol',
        reason: 'numbered target takes precedence', target1: 'alpha', replace1: 'omega',
    });
    assert.equal(r.details.status, 'ok', text(r));
    assert.equal(f.read(), 'const omega = 1;\nconst beta = 2;\n');
});
for (const [label, todo] of [
    ['comma', '2,3'], ['hash-space', '#2 #3'], ['ideographic-comma', '2、3'], ['array', [2, 3]],
]) {
    test('multiple Todo references: ' + label, async () => {
        const f = await fixture();
        const r = await call({
            command: 'EditCode', projectId: f.id, path: 'a.js', reason: 'multi todo',
            target: 'alpha', replace: 'omega', todo,
        });
        assert.equal(r.details.status, 'ok', text(r));
        assert.equal(f.read(), 'const omega = 1;\nconst beta = 2;\n');
        const todos = new Map(f.todos().map(t => [t.seq, t.status]));
        assert.equal(todos.get(1), 'pending');
        assert.equal(todos.get(2), 'doing');
        assert.equal(todos.get(3), 'doing');
    });
}
test('missing later Todo rejects before marking earlier Todo or changing file', async () => {
    const f = await fixture();
    const todos = f.todos();
    const fileState = f.store.getFileState(f.id, 'a.js');
    await assert.rejects(call({
        command: 'EditCode', projectId: f.id, path: 'a.js', reason: 'missing todo',
        target: 'alpha', replace: 'omega', todo: [2, 999],
    }), /999.*不存在/);
    assert.deepEqual(f.todos(), todos);
    assert.equal(f.read(), f.source);
    assert.equal(f.store.getFileState(f.id, 'a.js'), fileState);
});