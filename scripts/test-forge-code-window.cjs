'use strict';
// electron scripts/test-forge-code-window.cjs <new absolute evidence directory>
// Reuse the isolated actual-page runner; no production IPC, DB or credentials.
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const runner = path.join(__dirname, 'test-forge-catalog-window.cjs');
let source = fs.readFileSync(runner, 'utf8');
function replaceOnce(target, replacement) {
    if (source.split(target).length !== 2) throw Error('CODE_WINDOW_ANCHOR_CHANGED');
    source = source.replace(target, replacement);
}
const engineering = {
    version: 1, state: 'shared',
    report: { text: '合成快照验收', by: 'Kerr', truncated: [] },
    timeline: { total: 0, truncated: false, items: [] },
    files: { total: 1, truncated: false, items: [{
        file_path: 'src/example.js', edits: 1, added: 1, removed: 1, last_node: 9,
    }] },
};
replaceOnce(
    '                project: id === local.id ? local : remote(), todos,',
    '                project: id === local.id ? local : remote(), todos,\n' +
    '                ...(id === local.id ? {} : { engineering: ' + JSON.stringify(engineering) + ' }),'
);
replaceOnce(
    '            version: 3, observedAt: 1792512000000, stale: offline },',
    "            version: 3, digest: 'b'.repeat(64), kind: 'source', observedAt: 1792512000000, stale: offline },"
);
replaceOnce(
    '        projectForgeGetNode: forbidden,',
    `        projectForgeGetNode: forbidden,
        projectForgeGetRemoteCode: async (id, options) => {
            if (id !== remote().id || options.version !== 3 ||
                options.digest !== 'b'.repeat(64) || options.node !== 9) {
                return { success: false, error: 'INVALID_BINDING' };
            }
            counts.code = (counts.code || 0) + 1;
            return { success: true, data: {
                version: 1, state: 'shared',
                binding: { sourceId: 'server-fixture', localProjectId: 'p1',
                    version: 3, digest: 'b'.repeat(64), node: 9 },
                file: { file_path: 'src/example.js', node: 9, batch: 7,
                    before: { state: 'text', size: 18, text: 'const value = 1;\\r\\n' },
                    after: { state: 'text', size: 18, text: 'const value = 2;\\r\\n' } },
            } };
        },`
);
replaceOnce('    assert.match(remote.header, /远端计划只读/);',
    '    assert.match(remote.header, /远端只读/);');
replaceOnce("    assert.deepEqual(remote.tabs, ['overview']);",
    "    assert.deepEqual(remote.tabs, ['overview', 'timeline', 'files', 'report']);");
replaceOnce('    await finish();', `
    await evaluate("catalogWindowTest.offline(false); selectProject('remote:' + 'a'.repeat(64))");
    await evaluate("document.querySelector('.tab[data-tab=files]').click()");
    await evaluate("document.querySelector('[data-remote-code]').click()");
    await until("!document.getElementById('node-modal').hidden && Boolean(state.diffView)");
    const diff = await evaluate(\`({
        left: state.diffView.leftOriginal().getValue(),
        right: state.diffView.editor().getValue(),
        leftReadOnly: state.diffView.leftOriginal().getOption('readOnly'),
        rightReadOnly: state.diffView.editor().getOption('readOnly'),
        beforeDisabled: document.getElementById('revert-before-btn').disabled,
        afterDisabled: document.getElementById('revert-after-btn').disabled,
        reasonDisabled: document.getElementById('revert-reason').disabled,
        meta: document.getElementById('node-meta').textContent,
        remote: state.currentNode.remote,
        visible: document.getElementById('diff-view').getBoundingClientRect().width > 0
    })\`);
    assert.equal(diff.left, 'const value = 1;\\n');
    assert.equal(diff.right, 'const value = 2;\\n');
    assert.equal(diff.leftReadOnly, true);
    assert.equal(diff.rightReadOnly, true);
    assert.ok(diff.beforeDisabled && diff.afterDisabled && diff.reasonDisabled);
    assert.ok(diff.visible && diff.remote);
    assert.match(diff.meta, /发布版本 3/);
    await evaluate("revertCurrent('before')");
    await evaluate("openNode(9)");
    assert.equal(await evaluate("catalogWindowTest.counts().forbidden"), 0);
    assert.equal(await evaluate("catalogWindowTest.counts().code"), 1);
    await screenshot('remote-code-diff');
    await evaluate("closeNodeModal()");
    assert.equal(await evaluate("state.currentNode === null && state.diffView === null"), true);
    checks.push('actual file click, real CodeMirror before/after text, both editors readonly, no local node or revert calls, modal disposal');
    assert.deepEqual(errors, []);
    assert.deepEqual(blockedNetwork, []);
    await finish();`);
const compiled = new Module(runner, module);
compiled.filename = runner;
compiled.paths = Module._nodeModulePaths(path.dirname(runner));
compiled._compile(source, runner);