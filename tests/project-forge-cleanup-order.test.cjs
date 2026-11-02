'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const entry = path.resolve(__dirname, '../VCPDistributedServer/Plugin/ProjectForge/ProjectForgeService.js');
const localRequire = createRequire(entry);
function fixture() {
    const events = [];
    let evaluationCancelled = false;
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(entry, 'utf8'), {
        module, exports: module.exports, __filename: entry, __dirname: path.dirname(entry),
        process, Buffer, console, setTimeout, clearTimeout, setInterval, clearInterval,
        performance, AbortController, URL,
        require(name) {
            if (name === './evalSymbol') return {
                async cleanup() { events.push('eval'); evaluationCancelled = true; }
            };
            return localRequire(name);
        }
    }, { filename: entry, timeout: 5000 });
    const service = module.exports;
    const runtime = service._test.getRuntime();
    runtime.store = { close() { events.push('store'); } };
    runtime.indexer = { async stop() { events.push('indexer'); } };
    return { service, runtime, events, cancelled: () => evaluationCancelled };
}

test('cancel existing evaluations before catalog shutdown, final checkpoint and lease release', async () => {
    const f = fixture();
    f.runtime.catalog = { async stop() {
        assert.ok(f.cancelled(), 'catalog must not finalize while an evaluation is still running');
        f.events.push('catalog');
    } };
    f.runtime.autoResume = {
        gate: { phase: 'open' },
        async handoff() {
            assert.ok(f.cancelled(), 'evaluation is not counted by the cooperative worker gate');
            assert.ok(f.runtime.store, 'checkpoint still needs its Store');
            f.events.push('handoff');
        },
        async stop() { f.events.push('controller'); }
    };
    await f.service.cleanup();
    assert.deepEqual(f.events, ['eval', 'catalog', 'handoff', 'controller', 'store', 'indexer']);
    assert.equal(f.runtime.catalog, null);
    assert.equal(f.runtime.autoResume, null);
    assert.equal(f.runtime.store, null);
});

test('unbound service also cancels evaluations before closing its Store and indexer', async () => {
    const f = fixture();
    await f.service.cleanup();
    assert.deepEqual(f.events, ['eval', 'store', 'indexer']);
    assert.equal(f.runtime.store, null);
});

test('controller stop failure retains the Store and does not pretend shutdown completed', async () => {
    const f = fixture(), failure = new Error('WRITER_ACTIVE');
    const controller = {
        gate: { phase: 'closed' },
        async stop() { f.events.push('controller'); throw failure; }
    };
    f.runtime.autoResume = controller;
    await assert.rejects(f.service.cleanup(), error => error === failure);
    assert.deepEqual(f.events, ['eval', 'controller']);
    assert.equal(f.runtime.autoResume, controller);
    assert.ok(f.runtime.store);
});

test('handoff failure remains visible after successful controller and Store cleanup', async () => {
    const f = fixture(), failure = new Error('CHECKPOINT_FAILED');
    f.runtime.autoResume = {
        gate: { phase: 'open' },
        async handoff() {
            assert.ok(f.cancelled());
            f.events.push('handoff');
            throw failure;
        },
        async stop() { f.events.push('controller'); }
    };
    await assert.rejects(f.service.cleanup(), error => error === failure);
    assert.deepEqual(f.events, ['eval', 'handoff', 'controller', 'store', 'indexer']);
    assert.equal(f.runtime.store, null);
});