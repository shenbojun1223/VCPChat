'use strict';

const fs = require('fs-extra');
const path = require('path');
const { randomUUID } = require('crypto');

function createTopicMessageAdmissionStore(filePath) {
    if (!path.isAbsolute(filePath)) throw new TypeError('Admission journal requires absolute path');
    const validateLeases = leases => {
        if (!Array.isArray(leases)) throw new TypeError('Invalid standalone lease journal');
        const { conversationKey } = require('./historyMutationQueue');
        const seen = new Set();
        for (const lease of leases) {
            const key = conversationKey(lease?.scope || {});
            if (typeof lease.token !== 'string' || !lease.token || seen.has(key)) {
                throw new TypeError('Invalid or duplicate standalone lease');
            }
            seen.add(key);
        }
    };
    // One serialized admission owner per journal. Reopen the store when switching builds.
    // undefined: not read; null: legacy envelope; array: opaque v3 receipts to carry forward.
    let carriedReceipts;
    const loadState = async () => {
        carriedReceipts = undefined;
        let data;
        try { data = await fs.readJson(filePath); }
        catch (error) {
            if (error.code === 'ENOENT') {
                carriedReceipts = null;
                return { entries: [], standaloneLeases: [] };
            }
            throw error;
        }
        if (![1, 2, 3].includes(data?.version) || !Array.isArray(data.entries)
            || (data.version === 3 && (!Array.isArray(data.standaloneLeases) || !Array.isArray(data.dispatchReceipts)))
            || (data.version !== 3 && Object.hasOwn(data, 'dispatchReceipts'))) {
            throw new Error('Unsupported or corrupt admission journal');
        }
        const standaloneLeases = data.version === 1 ? [] : data.standaloneLeases;
        validateLeases(standaloneLeases);
        if (data.version === 3) {
            const receipts = data.dispatchReceipts;
            const { conversationKey } = require('./historyMutationQueue');
            const keys = new Set();
            for (const r of receipts) {
                if (!r || typeof r.key !== 'string' || !/^[a-f0-9]{64}$/.test(r.key)
                    || typeof r.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(r.fingerprint)
                    || typeof r.entryId !== 'string' || !r.entryId
                    || typeof r.messageId !== 'string' || !r.messageId || keys.has(r.key)) {
                    throw new TypeError('Invalid or duplicate dispatch receipt');
                }
                conversationKey(r.scope || {});
                keys.add(r.key);
            }
            // Detached from the load result, including any fields unknown to this build.
            carriedReceipts = structuredClone(receipts);
            return { entries: data.entries, standaloneLeases, dispatchReceipts: receipts };
        }
        carriedReceipts = null;
        return { entries: data.entries, standaloneLeases };
    };
    return {
        loadState,
        // Legacy consumers read messages only. The central owner uses loadState.
        async load() { return (await loadState()).entries; },
        async save(entries, standaloneLeases = []) {
            if (!Array.isArray(entries)) throw new TypeError('Admission entries must be an array');
            validateLeases(standaloneLeases);
            // Freeze before the first await; caller mutation cannot alter the transaction.
            const snapshot = structuredClone({ version: 2, entries, standaloneLeases });
            // Direct legacy callers can save before their first read. Never overwrite
            // a pre-existing v3 (or an unreadable journal) on this cold path.
            if (carriedReceipts === undefined) await loadState();
            if (carriedReceipts !== null) {
                snapshot.version = 3;
                snapshot.dispatchReceipts = carriedReceipts;
            }
            await fs.ensureDir(path.dirname(filePath));
            const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
            try {
                await fs.writeJson(temporary, snapshot, { spaces: 2 });
                await fs.rename(temporary, filePath);
            } finally {
                await fs.remove(temporary);
            }
        },
    };
}

module.exports = { createTopicMessageAdmissionStore };