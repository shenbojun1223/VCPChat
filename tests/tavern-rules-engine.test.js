'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../modules/tavernRulesEngine');

const officialStore = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'AppData', 'VCPChatTarven.official.json'), 'utf8')
);

test('official presets are loaded from the independent official JSON file', () => {
    const names = officialStore.rules.map(rule => rule.name);

    assert.equal(Object.hasOwn(engine, 'BUILTIN_RULES'), false);
    assert.equal(officialStore.rules.length, 9);
    assert.deepEqual(names, [
        'Agent输出动画气泡',
        '心流锁系统',
        'Loom权限',
        '文坊权限',
        '禁用所有工具',
        'VCP桌面权限',
        '获取服务器验证码',
        '窗口控制权限',
        '启用HTML多媒体权限'
    ]);
    assert.equal(names.includes('插件管理员'), false);
});

test('combining files marks source according to the source file', () => {
    const combined = engine.combineRuleStores(
        {
            version: 3,
            rules: [{
                id: 'official_rule',
                name: '官方规则',
                type: 'system_suffix',
                enabled: true,
                content: 'official',
                scope: 'global',
                source: 'user'
            }]
        },
        {
            version: 3,
            rules: [{
                id: 'user_rule',
                name: '用户规则',
                type: 'user_suffix',
                enabled: true,
                content: 'user',
                scope: 'agent',
                source: 'official',
                isBuiltin: true
            }]
        }
    );

    assert.equal(combined.rules[0].source, 'official');
    assert.equal(combined.rules[0].isBuiltin, true);
    assert.equal(combined.rules[1].source, 'user');
    assert.equal(combined.rules[1].isBuiltin, false);
});

test('official and user rules share the same runtime behavior', () => {
    const combined = engine.combineRuleStores(
        {
            version: 3,
            rules: [{
                id: 'official_suffix',
                name: '官方注入',
                type: 'system_suffix',
                enabled: true,
                content: 'official content',
                scope: 'global',
                wrap: false,
                order: 0
            }]
        },
        {
            version: 3,
            rules: [{
                id: 'user_suffix',
                name: '用户注入',
                type: 'system_suffix',
                enabled: true,
                content: 'user content',
                scope: 'global',
                wrap: false,
                order: 1
            }]
        }
    );

    assert.equal(
        engine.applySystemSuffix('base', combined.rules, 'agent'),
        'base\n\nofficial content\n\nuser content'
    );
});

test('split persists edits and cross-source ordering back to each file', () => {
    const combined = engine.combineRuleStores(
        {
            version: 3,
            rules: [{
                id: 'official_rule',
                name: '官方规则',
                type: 'system_suffix',
                enabled: false,
                content: 'official',
                scope: 'global',
                order: 0
            }]
        },
        {
            version: 3,
            rules: [{
                id: 'user_rule',
                name: '用户规则',
                type: 'system_suffix',
                enabled: true,
                content: 'user',
                scope: 'global',
                order: 1
            }]
        }
    );

    const officialRule = combined.rules.find(rule => rule.id === 'official_rule');
    officialRule.name = '已编辑的官方规则';
    officialRule.enabled = true;
    combined.rules.reverse();

    const split = engine.splitRuleStore(combined);

    assert.equal(split.userStore.rules[0].id, 'user_rule');
    assert.equal(split.userStore.rules[0].order, 0);
    assert.equal(split.officialStore.rules[0].id, 'official_rule');
    assert.equal(split.officialStore.rules[0].name, '已编辑的官方规则');
    assert.equal(split.officialStore.rules[0].enabled, true);
    assert.equal(split.officialStore.rules[0].order, 1);
    assert.equal(split.officialStore.rules[0].source, undefined);
    assert.equal(split.officialStore.rules[0].isBuiltin, undefined);
});

test('deleting an official rule does not recreate it during split and recombine', () => {
    const combined = engine.combineRuleStores(officialStore, { version: 3, rules: [] });
    const remaining = {
        ...combined,
        rules: combined.rules.filter(rule => rule.builtinKey !== 'forbid-tools')
    };

    const split = engine.splitRuleStore(remaining);
    const restored = engine.combineRuleStores(split.officialStore, split.userStore);

    assert.equal(
        restored.rules.some(rule => rule.builtinKey === 'forbid-tools'),
        false
    );
    assert.equal(restored.rules.length, officialStore.rules.length - 1);
});

test('all official capability switches are disabled by default', () => {
    const combined = engine.combineRuleStores(officialStore, { version: 3, rules: [] });
    const enabled = combined.rules.filter(rule => rule.enabled !== false);

    assert.equal(enabled.length, 0);

    const systemPrompt = engine.applySystemSuffix('base', combined.rules, 'agent');
    assert.doesNotMatch(systemPrompt, /\{\{VarDivRender\}\}/);
    assert.doesNotMatch(systemPrompt, /\{\{USER_AUTH_CODE\}\}/);
    assert.doesNotMatch(systemPrompt, /\{\{VCPScreenPilot\}\}/);
    assert.doesNotMatch(systemPrompt, /\{\{VCPLoomController\}\}/);
    assert.doesNotMatch(systemPrompt, /\[\[Flowlock::Start\]\]/);
});

test('DivRender is injected only after explicit enablement', () => {
    const combined = engine.combineRuleStores(officialStore, { version: 3, rules: [] });
    combined.rules.find(rule => rule.builtinKey === 'agent-div-render').enabled = true;
    assert.match(engine.applySystemSuffix('base', combined.rules, 'agent'), /\{\{VarDivRender\}\}/);
});

test('legacy true setting enables the official DivRender rule once', () => {
    const combined = engine.combineRuleStores(officialStore, { version: 3, rules: [] });
    const migration = engine.migrateLegacyAgentBubbleTheme(combined, true);
    assert.equal(migration.changed, true);
    assert.equal(migration.enabledOverrideCreated, true);
    assert.equal(migration.store.rules.find(rule => rule.builtinKey === 'agent-div-render').enabled, true);
});

test('legacy false setting does not enable DivRender', () => {
    const combined = engine.combineRuleStores(officialStore, { version: 3, rules: [] });
    const migration = engine.migrateLegacyAgentBubbleTheme(combined, false);
    assert.equal(migration.changed, false);
    assert.equal(migration.store.rules.find(rule => rule.builtinKey === 'agent-div-render').enabled, false);
});

test('message rendering UI exposes a distinct Tavern-backed animation bubble switch', () => {
    const projectRoot = path.join(__dirname, '..');
    const page = fs.readFileSync(path.join(projectRoot, 'main.html'), 'utf8');
    const managerSource = fs.readFileSync(path.join(projectRoot, 'Tavernmodules', 'tavern-manager.js'), 'utf8');
    assert.match(page, /id="enableAgentDivRenderRule"/);
    assert.match(page, /id="manageAgentDivRenderRulesBtn"/);
    assert.match(managerSource, /AGENT_DIV_RENDER_BUILTIN_KEY = 'agent-div-render'/);
    assert.match(managerSource, /_bindAgentDivRenderSettingsControls/);
    assert.match(managerSource, /_syncAgentDivRenderSettingsControls/);
});
