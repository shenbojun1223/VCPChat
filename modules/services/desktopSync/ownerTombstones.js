const fs = require('fs-extra');
const path = require('path');

const STORE_VERSION = 1;
const STORE_RELATIVE_PATH = path.join('.desktop-sync', 'owner-tombstones.json');

let mutationQueue = Promise.resolve();

function getOwnerTombstonePath(userDataDir) {
    if (typeof userDataDir !== 'string' || !userDataDir.trim()) {
        throw new Error('Owner tombstone store requires a UserData directory');
    }
    return path.join(userDataDir, STORE_RELATIVE_PATH);
}

function normalizeOwnerTombstone(value) {
    if (!value || typeof value !== 'object') return null;
    const id = typeof value.id === 'string' ? value.id.trim() : '';
    const type = value.type;
    const deletedAt = Number(value.deletedAt);
    if (
        !/^[a-zA-Z0-9_-]+$/.test(id) ||
        !['agent', 'group'].includes(type) ||
        !Number.isSafeInteger(deletedAt) ||
        deletedAt < 0
    ) {
        return null;
    }
    return { id, type, deletedAt };
}

function ownerTombstoneKey(value) {
    const tombstone = normalizeOwnerTombstone(value);
    return tombstone ? `${tombstone.type}:${tombstone.id}` : '';
}

async function readStore(userDataDir) {
    let stored;
    try {
        stored = await fs.readJson(getOwnerTombstonePath(userDataDir));
    } catch (error) {
        if (error?.code === 'ENOENT') return [];
        throw error;
    }
    const owners = Array.isArray(stored) ? stored : stored?.owners;
    if (!Array.isArray(owners)) return [];

    const deduplicated = new Map();
    for (const value of owners) {
        const tombstone = normalizeOwnerTombstone(value);
        if (!tombstone) continue;
        const key = ownerTombstoneKey(tombstone);
        const existing = deduplicated.get(key);
        if (!existing || tombstone.deletedAt < existing.deletedAt) {
            deduplicated.set(key, tombstone);
        }
    }
    return [...deduplicated.values()];
}

async function writeStore(userDataDir, owners) {
    const storePath = getOwnerTombstonePath(userDataDir);
    if (!owners.length) {
        await fs.remove(storePath);
        return;
    }
    await fs.ensureDir(path.dirname(storePath));
    const tempPath = `${storePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeJson(tempPath, { version: STORE_VERSION, owners }, { spaces: 2 });
    await fs.move(tempPath, storePath, { overwrite: true });
}

function mutateStore(userDataDir, mutation) {
    const operation = mutationQueue.then(async () => {
        const current = await readStore(userDataDir);
        const next = await mutation(current);
        await writeStore(userDataDir, next);
        return next;
    });
    mutationQueue = operation.catch(() => {});
    return operation;
}

async function recordOwnerDeletion(userDataDir, value) {
    const tombstone = normalizeOwnerTombstone({
        ...value,
        deletedAt: value?.deletedAt ?? Date.now(),
    });
    if (!tombstone) throw new Error('Invalid owner deletion tombstone');
    const key = ownerTombstoneKey(tombstone);
    await mutateStore(userDataDir, current => {
        const byKey = new Map(current.map(item => [ownerTombstoneKey(item), item]));
        const existing = byKey.get(key);
        byKey.set(key, existing && existing.deletedAt <= tombstone.deletedAt ? existing : tombstone);
        return [...byKey.values()];
    });
    return tombstone;
}

async function listOwnerDeletions(userDataDir) {
    await mutationQueue;
    return readStore(userDataDir);
}

async function removeOwnerDeletions(userDataDir, values) {
    const keys = new Set((values || []).map(ownerTombstoneKey).filter(Boolean));
    if (!keys.size) return listOwnerDeletions(userDataDir);
    return mutateStore(
        userDataDir,
        current => current.filter(item => !keys.has(ownerTombstoneKey(item))),
    );
}

module.exports = {
    getOwnerTombstonePath,
    listOwnerDeletions,
    ownerTombstoneKey,
    recordOwnerDeletion,
    removeOwnerDeletions,
};
