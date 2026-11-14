import fs from 'node:fs';
import path from 'node:path';

// Preserve the consumer gate's existing exclusions at every depth.
const ignoredDirectoryNames = new Set([
    '.git', 'docs', 'node_modules', 'screenshots', 'scripts', 'tests', 'vendor',
]);
// These are repository-root artifacts, not exclusions for similarly named
// directories inside actual production modules.
const ignoredRootDirectoryNames = new Set([
    'backups', 'UpdateBackups', 'DebugLog', 'AppData', 'tmp', '.integrations', '.evidence',
]);
const ignoredDirectoryPaths = new Set(['audio_engine/AppData']);

export function describeChatProductionExclusions() {
    return {
        ignoredProductionDirectoryNames: [...ignoredDirectoryNames],
        ignoredProductionRootDirectoryNames: [...ignoredRootDirectoryNames],
        ignoredProductionDirectoryPaths: [...ignoredDirectoryPaths],
    };
}

export function collectChatProductionFiles(root) {
    const files = [];
    function walk(directory, relative = '') {
        if (!fs.existsSync(directory)) return;
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const rel = path.join(relative, entry.name).replaceAll(path.sep, '/');
            if (entry.isDirectory()) {
                if (ignoredDirectoryNames.has(entry.name)
                    || (relative === '' && ignoredRootDirectoryNames.has(entry.name))
                    || ignoredDirectoryPaths.has(rel)) continue;
                walk(path.join(directory, entry.name), rel);
            } else if (entry.isFile() && /\.(?:js|mjs|html)$/.test(entry.name)) {
                files.push(rel);
            }
        }
    }
    walk(root);
    return files.sort();
}
