import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { collectChatProductionFiles } from '../scripts/chat-production-files.mjs';

function fixture(files) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vcp-production-scan-'));
    for (const [relative, content] of Object.entries(files)) {
        const file = path.join(root, relative);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
    }
    return {
        root,
        close() {
            assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
            assert.ok(path.basename(root).startsWith('vcp-production-scan-'));
            fs.rmSync(root, { recursive: true, force: true });
        },
    };
}

test('consumer inventory ignores root archives and runtime data without muting production violations', () => {
    const retiredAccess = 'window.globalSettings = {};';
    const f = fixture({
        'renderer.js': 'export const live = true;',
        'modules/legacy.js': retiredAccess,
        'preloads/chat.js': 'export const preload = true;',
        'VCPDistributedServer/Plugin/Example/plugin.js': 'module.exports = {};',
        'backups/old/renderer.js': retiredAccess,
        'UpdateBackups/old/renderer.js': retiredAccess,
        'DebugLog/captured.js': retiredAccess,
        'AppData/UserData/captured.js': retiredAccess,
        'tmp/pilot/renderer.js': retiredAccess,
        '.integrations/old/renderer.js': retiredAccess,
        '.evidence/old/renderer.js': retiredAccess,
        'audio_engine/AppData/captured.js': retiredAccess,
    });
    try {
        const files = collectChatProductionFiles(f.root);
        assert.deepEqual(files, [
            'VCPDistributedServer/Plugin/Example/plugin.js',
            'modules/legacy.js',
            'preloads/chat.js',
            'renderer.js',
        ]);
        assert.match(fs.readFileSync(path.join(f.root, 'modules/legacy.js'), 'utf8'), /\bwindow\.globalSettings\b/,
            'a real production violation remains available to the unchanged consumer assertions');
    } finally { f.close(); }
});

test('root-only archive exclusions do not hide identically named source subdirectories', () => {
    const f = fixture({
        'modules/backups/live.js': 'export const live = true;',
        'modules/tmp/view.mjs': 'export const view = true;',
        'modules/AppData/view.html': '<div>production view</div>',
        'modules/tests/fixture.js': 'fixture',
        'modules/vendor/vendor.js': 'vendor',
        'scripts/check.mjs': 'test-only tool',
        'docs/example.html': 'documentation',
        'node_modules/package/index.js': 'dependency',
        '.git/hooks/local.js': 'git metadata',
        'screenshots/snapshot.html': 'capture',
        'styles/theme.css': 'not scanned',
    });
    try {
        assert.deepEqual(collectChatProductionFiles(f.root), [
            'modules/AppData/view.html',
            'modules/backups/live.js',
            'modules/tmp/view.mjs',
        ]);
    } finally { f.close(); }
});

test('consumer inventory is deterministic, read-only and tolerates an absent source root', () => {
    const files = {
        'z.js': 'z',
        'a.html': '<div>a</div>',
        'modules/feature.mjs': 'export const feature = 1;',
        'backups/old.js': 'keep this archive intact',
    };
    const f = fixture(files);
    try {
        const first = collectChatProductionFiles(f.root);
        assert.deepEqual(first, collectChatProductionFiles(f.root));
        assert.deepEqual(first, ['a.html', 'modules/feature.mjs', 'z.js']);
        for (const [relative, content] of Object.entries(files)) {
            assert.equal(fs.readFileSync(path.join(f.root, relative), 'utf8'), content);
        }
        assert.deepEqual(collectChatProductionFiles(path.join(f.root, 'absent')), []);
    } finally { f.close(); }
});

test('consumer gate uses the tested production inventory while retaining retired-global assertions', () => {
    const source = fs.readFileSync(new URL('../scripts/check-chat-kernel-consumers.mjs', import.meta.url), 'utf8');
    assert.match(source, /import\s*\{\s*collectChatProductionFiles\s*\}\s*from\s*['"]\.\/chat-production-files\.mjs['"]/);
    assert.match(source, /const productionFiles = collectChatProductionFiles\(root\)/);
    assert.match(source, /for \(const file of productionFiles\)[\s\S]*retiredRendererGlobals[\s\S]*assert\.doesNotMatch/);
});
test('consumer report derives detached exclusion metadata from the production inventory policy', async () => {
    const { describeChatProductionExclusions } = await import('../scripts/chat-production-files.mjs');
    const first = describeChatProductionExclusions();
    assert.ok(first.ignoredProductionDirectoryNames.includes('node_modules'));
    assert.ok(first.ignoredProductionRootDirectoryNames.includes('backups'));
    assert.deepEqual(first.ignoredProductionDirectoryPaths, ['audio_engine/AppData']);
    first.ignoredProductionRootDirectoryNames.push('modules');
    assert.equal(describeChatProductionExclusions().ignoredProductionRootDirectoryNames.includes('modules'), false);
    const gate = fs.readFileSync(new URL('../scripts/check-chat-kernel-consumers.mjs', import.meta.url), 'utf8');
    assert.match(gate, /\.\.\.describeChatProductionExclusions\(\)/);
    assert.doesNotMatch(gate, /\[\.\.\.ignoredProductionDirectory(?:Names|Paths)\]/);
});