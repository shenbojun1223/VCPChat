'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DesktopSyncService } = require('../modules/services/desktopSync');
const { computeMessageFingerprint } =
    require('../VCPDistributedServer/Plugin/VCPMobileSync/core/hash');

// Characterization of current limitations, NOT acceptance of end-to-end sync.
// Call only projection methods; never construct/start the sync service.
const projection = DesktopSyncService.prototype;
function message() {
    return {
        id: 'native-sync-fixture', role: 'assistant',
        content: 'retained answer', timestamp: 1,
        nativeToolEvents: [{
            schema: 1, source: 'agy-native',
            requestId: 'sync-request', callId: 'step:2',
            revision: 0, sequence: 2, name: 'read_file',
            status: 'unknown', evidence: 'missing_terminal',
            detailsPolicy: 'withheld',
        }],
    };
}

test('sync projection currently preserves native metadata through JSON transport', async () => {
    const original = message();
    const before = structuredClone(original);
    const transport = projection.toTransportMessage.call({}, original);
    const wire = JSON.parse(JSON.stringify({ ...transport, contentHash: 'fixture-hash' }));
    // No attachments: this path must not access filesystem or network.
    const restored = await projection.normalizeRemoteMessage.call({}, wire);
    assert.deepEqual(restored, original);
    assert.equal(Object.hasOwn(restored, 'contentHash'), false);
    assert.deepEqual(original, before);
});

test('known sync limitation: native-only metadata changes do not change fingerprint', () => {
    const original = message();
    const changed = structuredClone(original);
    changed.nativeToolEvents[0] = {
        ...changed.nativeToolEvents[0],
        revision: 1, sequence: 3,
        status: 'failed', evidence: 'transport_reported',
    };
    assert.notDeepEqual(original.nativeToolEvents, changed.nativeToolEvents);
    assert.equal(computeMessageFingerprint(original), computeMessageFingerprint(changed));
    const withoutMetadata = structuredClone(original);
    delete withoutMetadata.nativeToolEvents;
    assert.equal(computeMessageFingerprint(original), computeMessageFingerprint(withoutMetadata));
    assert.notEqual(computeMessageFingerprint(original),
        computeMessageFingerprint({ ...original, content: 'changed answer' }));
});

test('known sync limitation: metadata-only assistant is classified as empty', () => {
    assert.equal(projection.isEmptyAssistantMessage.call({}, message()), false);
    assert.equal(projection.isEmptyAssistantMessage.call({}, { ...message(), content: '' }), true);
    assert.equal(projection.isEmptyAssistantMessage.call({}, { ...message(), content: '  ' }), true);
});