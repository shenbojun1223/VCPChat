'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const { IndexerClient } = require('../VCPDistributedServer/Plugin/ProjectForge/indexerClient.js');

function fixture(exitCode, signalCode, live = false) {
    const child = Object.assign(new EventEmitter(), { exitCode, signalCode });
    const calls = [];
    child.stdin = {
        write(frame) { calls.push(JSON.parse(frame)); },
        end() {
            calls.push('end');
            if (live) queueMicrotask(() => {
                child.exitCode = 0;
                child.emit('exit', 0, null);
            });
        },
    };
    child.kill = () => { calls.push('unexpected kill'); };
    const client = new IndexerClient({ binaryPath: 'unused-fixture' });
    client.child = child;
    return { child, client, calls };
}

for (const [label, code, signal] of [['exit code', 0, null], ['signal', null, 'SIGTERM']]) {
    test('stop skips an already exited child: ' + label, { timeout: 1000 }, async () => {
        const { child, client, calls } = fixture(code, signal);
        const stopped = client.stop();
        try {
            assert.ok(client.child === null, 'must clear an already exited child without waiting for a past event');
            assert.equal(child.listenerCount('exit'), 0);
            await stopped;
            await client.stop();
            assert.deepEqual(calls, ['end']);
        } finally {
            // Release the old implementation after the assertion, not by waiting for its kill timer.
            child.emit('exit', code, signal);
            await stopped;
        }
    });
}

test('stop sends shutdown and waits for a live child', { timeout: 1000 }, async () => {
    const { client, calls } = fixture(null, null, true);
    const stopped = client.stop();
    assert.notEqual(client.child, null);
    await stopped;
    assert.equal(client.child, null);
    assert.deepEqual(calls, [{ id:0, method:'shutdown' }, 'end']);
});
