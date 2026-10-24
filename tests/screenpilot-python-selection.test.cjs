'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname,
    '../VCPDistributedServer/Plugin/ScreenPilot/ScreenPilotService.js'), 'utf8');

function select({ injected = {}, env = {}, config = null, venv = false, platform = 'win32' } = {}) {
    const root = path.resolve('synthetic-screenpilot');
    const configPath = path.join(root, 'config.env');
    const pythonPath = path.join(root, '.venv',
        platform === 'win32' ? 'Scripts' : 'bin',
        platform === 'win32' ? 'python.exe' : 'python');
    const fakeFs = {
        existsSync(p) {
            assert.ok(p === configPath || p === pythonPath, 'unexpected filesystem access');
            return p === configPath ? config !== null : venv;
        },
        readFileSync(p) {
            assert.equal(p, configPath);
            assert.notEqual(config, null);
            return config;
        },
    };
    const module = { exports: {} };
    const dependencies = {
        fs: fakeFs,
        path,
        crypto: require('node:crypto'),
        child_process: { spawn() { throw new Error('Worker must not start in selection tests'); } },
    };
    const exitHooks = [];
    const context = {
        module, exports: module.exports, __dirname: root,
        process: {
            platform,
            env: { ...env },
            once(event, callback) {
                assert.equal(event, 'exit');
                assert.equal(typeof callback, 'function');
                exitHooks.push(callback);
            },
        },
        console,
        injected,
        require(name) {
            assert.ok(Object.hasOwn(dependencies, name), `unexpected dependency: ${name}`);
            return dependencies[name];
        },
    };
    vm.runInNewContext(source + '\nruntime.config = injected; module.exports.selected = workerCommand();',
        context, { filename: 'ScreenPilotService.js', timeout: 1000 });
    assert.equal(exitHooks.length, 1, 'register exactly one isolated exit hook');
    return { selected: module.exports.selected, pythonPath };
}

test('injected Python has precedence over file, environment and venv', () => {
    assert.equal(select({
        injected: { SCREENPILOT_PYTHON: 'injected-python' },
        config: 'SCREENPILOT_PYTHON=file-python',
        env: { SCREENPILOT_PYTHON: 'env-python' }, venv: true,
    }).selected, 'injected-python');
});
test('quoted plugin file Python has precedence over environment', () => {
    assert.equal(select({
        config: '# comment\nSCREENPILOT_PYTHON="C:/Python With Spaces/python.exe"\n',
        env: { SCREENPILOT_PYTHON: 'env-python' },
    }).selected, 'C:/Python With Spaces/python.exe');
});
test('environment Python has precedence over venv', () => {
    assert.equal(select({ env: { SCREENPILOT_PYTHON: 'env-python' }, venv: true }).selected, 'env-python');
});
test('local Windows venv is selected without explicit configuration', () => {
    const result = select({ venv: true });
    assert.equal(result.selected, result.pythonPath);
});
test('local POSIX venv uses bin/python', () => {
    const result = select({ platform: 'linux', venv: true });
    assert.equal(result.selected, result.pythonPath);
});
test('missing configuration and venv use PATH Python', () => {
    assert.equal(select().selected, 'python');
});
test('empty configured value falls through; whitespace keeps existing PATH fallback', () => {
    assert.equal(select({ config: 'SCREENPILOT_PYTHON=', venv: true }).selected,
        select({ venv: true }).pythonPath);
    assert.equal(select({ injected: { SCREENPILOT_PYTHON: '   ' }, venv: true }).selected, 'python');
});