'use strict';
// Actual page, synthetic API, isolated profile. No production credentials/DB.
// electron scripts/test-forge-engineering-window.cjs <new absolute evidence dir>
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const runner = path.join(__dirname, 'test-forge-catalog-window.cjs');
let source = fs.readFileSync(runner, 'utf8');
function replaceOnce(target, replacement) {
    if (source.split(target).length !== 2) throw Error('ENGINEERING_WINDOW_ANCHOR_CHANGED');
    source = source.replace(target, replacement);
}
const engineering = {
    version: 1, state: 'shared',
    report: {
        text: '工程验收报告\n<img src=x onerror=boom()>\n<script>window.injected=true</script>\n' +
            '中文说明与长行 '.repeat(80),
        by: 'Kerr', truncated: ['text'],
    },
    timeline: {
        total: 3, truncated: true,
        items: [{
            id: 7, kind: 'edit', reason: '<script>window.injected=true</script> 修复边界',
            maid: 'Kerr', created_at: '2026-10-22T02:00:00.000Z',
            node_count: 2, added: 2, removed: 1, files: ['src/a.js'],
            file_total: 2, files_truncated: true, truncated: [],
        }],
    },
    files: {
        total: 2, truncated: true,
        items: [{
            file_path: 'src/' + 'long-name-'.repeat(20) + '.js',
            edits: 1, added: 2, removed: 1, last_node: 9,
        }],
    },
};
replaceOnce(
    '                project: id === local.id ? local : remote(), todos,',
    '                project: id === local.id ? local : remote(), todos,\n' +
    '                ...(id === local.id ? {} : { engineering: ' + JSON.stringify(engineering) + ' }),'
);
replaceOnce(
    '        projectForgeGetNode: forbidden,',
    '        projectForgeGetNode: forbidden,\n        projectForgeGetBatch: forbidden,'
);
// The remote fixture now explicitly shares summaries. Full history remains hidden.
replaceOnce("    assert.deepEqual(remote.tabs, ['overview']);",
    "    assert.deepEqual(remote.tabs, ['overview', 'timeline', 'files', 'report']);");
replaceOnce('    await finish();', `
    await evaluate("selectProject('remote:' + 'a'.repeat(64))");
    for (const section of ['timeline', 'files', 'report']) {
        await evaluate("document.querySelector('.tab[data-tab=" + section + "]').click()");
        const result = await evaluate(\`(() => {
            const pane=document.getElementById('pane-${'${section}'}');
            return {
                visible:pane.getBoundingClientRect().width>0,
                unsafe:pane.querySelectorAll('img,script,iframe').length,
                localHooks:pane.querySelectorAll('[data-node],[data-batch],[data-file],.clickable').length,
                text:pane.textContent,
                overflow:document.documentElement.scrollWidth>innerWidth+1
            };
        })()\`);
        assert.equal(result.visible,true);
        assert.equal(result.unsafe,0);
        assert.equal(result.localHooks,0);
        assert.equal(result.overflow,false);
        assert.match(result.text,/离线缓存/);
        assert.match(result.text,/截断/);
        await screenshot('engineering-'+section);
    }
    assert.match(await evaluate("document.getElementById('pane-report').textContent"),/<img/);
    await evaluate("toggleBatch(null)");
    await evaluate("openNode(7)");
    await evaluate("runHistorySearch()");
    assert.equal(await evaluate("catalogWindowTest.counts().forbidden"),0);
    assert.equal(await evaluate("Boolean(window.injected)"),false);
    checks.push('shared engineering tabs: actual visibility, escaped report, truncation, offline provenance, layout bounds and zero local history calls');
    await evaluate("selectProject('p1')");
    assert.equal(await evaluate("document.querySelector('.tab[data-tab=history]').hidden"),false);
    assert.equal(await evaluate("document.querySelectorAll('.project-item[data-id=p1] .project-delete-confirm').length"),1);
    assert.deepEqual(errors,[]);
    assert.deepEqual(blockedNetwork,[]);
    checks.push('return to local restores ordinary tabs and controls');
    await finish();`);
const compiled = new Module(runner, module);
compiled.filename = runner;
compiled.paths = Module._nodeModulePaths(path.dirname(runner));
compiled._compile(source, runner);