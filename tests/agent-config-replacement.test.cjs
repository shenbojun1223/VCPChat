const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs-extra');
const os = require('node:os');
const path = require('node:path');
const AgentConfigManager = require('../modules/utils/agentConfigManager');

test('failed config publication preserves the readable previous version', async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-config-replace-'));
    const manager = new AgentConfigManager(dir);
    const { configPath } = manager.getAgentPaths('fixture');
    try {
        await manager.writeAgentConfig('fixture', { version: 1 });
        const rename = t.mock.method(fs, 'rename', async (from, to) => {
            assert.equal(to, configPath);
            assert.deepEqual(await fs.readJson(to), { version: 1 });
            throw Object.assign(new Error('injected write failure'), { code: 'EIO' });
        });
        await assert.rejects(manager.writeAgentConfig('fixture', { version: 2 }), /injected write failure/);
        rename.mock.restore();
        assert.deepEqual(await fs.readJson(configPath), { version: 1 });
        await manager.writeAgentConfig('fixture', { version: 2 });
        assert.deepEqual(await fs.readJson(configPath), { version: 2 });
        assert.deepEqual(await fs.readJson(configPath + '.backup'), { version: 1 });
    } finally { await fs.remove(dir); }
});

for (const staysBusy of [false, true]) {
    test(`Windows config replacement ${staysBusy ? 'stops after bounded retries' : 'recovers from a busy destination'}`,
        { skip: process.platform !== 'win32', timeout: 10000 }, async t => {
            const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-config-busy-'));
            const manager = new AgentConfigManager(dir);
            const { configPath } = manager.getAgentPaths('fixture');
            const before = { version: 1 };
            const after = { version: 2 };
            try {
                await manager.writeAgentConfig('fixture', before);
                const originalRename = fs.rename;
                let attempts = 0;
                const rename = t.mock.method(fs, 'rename', async (from, to) => {
                    assert.equal(to, configPath);
                    assert.equal(path.dirname(from), path.dirname(to), 'replacement must be in the same directory');
                    assert.deepEqual(await fs.readJson(to), before, 'readers must still see the old config');
                    attempts++;
                    if (staysBusy || attempts <= 2) {
                        throw Object.assign(new Error('simulated sharing conflict'), {
                            code: attempts === 1 ? 'EPERM' : 'EBUSY',
                        });
                    }
                    return originalRename(from, to);
                });
                try {
                    if (staysBusy) {
                        await assert.rejects(manager.writeAgentConfig('fixture', after), { code: 'EBUSY' });
                        assert.equal(attempts, 8);
                        assert.deepEqual(await fs.readJson(configPath), before);
                    } else {
                        await manager.writeAgentConfig('fixture', after);
                        assert.equal(attempts, 3);
                        assert.deepEqual(await fs.readJson(configPath), after);
                    }
                    assert.deepEqual(await fs.readJson(configPath + '.backup'), before);
                } finally {
                    rename.mock.restore();
                }
            } finally {
                await fs.remove(dir);
            }
        });
}