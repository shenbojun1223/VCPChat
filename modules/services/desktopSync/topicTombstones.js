const fs = require('fs-extra');
const path = require('path');

const STORE_VERSION = 1;
const STORE_RELATIVE_PATH = path.join('.desktop-sync', 'topic-tombstones.json');

let mutationQueue = Promise.resolve();

function getTopicTombstonePath(userDataDir) {
    if (typeof userDataDir !== 'string' || !userDataDir.trim()) {
        throw new Error('Topic tombstone store requires a UserData directory');
    }
    return path.join(userDataDir, STORE_RELATIVE_PATH);
}

function normalizeTopicTombstone(value) {
    if (!value || typeof value !== 'object') return null;
    const id = typeof value.id === 'string' ? value.id.trim() : '';
    const ownerId = typeof value.ownerId === 'string' ? value.ownerId.trim() : '';
    const ownerType = value.ownerType;
    const deletedAt = Number(value.deletedAt);
    if (
        !id ||
        !ownerId ||
        !['agent', 'group'].includes(ownerType) ||
        !Number.isSafeInteger(deletedAt) ||
        deletedAt < 0
    ) {
        return null;
    }
    return { id, ownerId, ownerType, deletedAt };
}

function topicTombstoneKey(value) {
    const tombstone = normalizeTopicTombstone(value);
    if (!tombstone) return '';
    return `${tombstone.ownerType}:${tombstone.ownerId}:${tombstone.id}`;
}

async function readStore(userDataDir) {
    const storePath = getTopicTombstonePath(userDataDir);
    let stored;
    try {
        stored = await fs.readJson(storePath);
    } catch (error) {
        if (error?.code === 'ENOENT') return [];
        throw error;
    }
    const topics = Array.isArray(stored) ? stored : stored?.topics;
    if (!Array.isArray(topics)) return [];

    const deduplicated = new Map();
    for (const value of topics) {
        const tombstone = normalizeTopicTombstone(value);
        if (!tombstone) continue;
        const key = topicTombstoneKey(tombstone);
        const existing = deduplicated.get(key);
        if (!existing || tombstone.deletedAt < existing.deletedAt) {
            deduplicated.set(key, tombstone);
        }
    }
    return [...deduplicated.values()];
}

async function writeStore(userDataDir, topics) {
    const storePath = getTopicTombstonePath(userDataDir);
    if (!topics.length) {
        await fs.remove(storePath);
        return;
    }

    await fs.ensureDir(path.dirname(storePath));
    const tempPath = `${storePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeJson(tempPath, { version: STORE_VERSION, topics }, { spaces: 2 });
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

async function recordTopicDeletion(userDataDir, value) {
    const tombstone = normalizeTopicTombstone({ ...value, deletedAt: value?.deletedAt ?? Date.now() });
    if (!tombstone) throw new Error('Invalid topic deletion tombstone');
    const key = topicTombstoneKey(tombstone);

    await mutateStore(userDataDir, current => {
        const byKey = new Map(current.map(item => [topicTombstoneKey(item), item]));
        const existing = byKey.get(key);
        byKey.set(key, existing && existing.deletedAt <= tombstone.deletedAt ? existing : tombstone);
        return [...byKey.values()];
    });
    return tombstone;
}

async function listTopicDeletions(userDataDir) {
    await mutationQueue;
    return readStore(userDataDir);
}

async function removeTopicDeletions(userDataDir, values) {
    const keys = new Set((values || []).map(topicTombstoneKey).filter(Boolean));
    if (!keys.size) return listTopicDeletions(userDataDir);
    return mutateStore(userDataDir, current => current.filter(item => !keys.has(topicTombstoneKey(item))));
}

module.exports = {
    getTopicTombstonePath,
    listTopicDeletions,
    recordTopicDeletion,
    removeTopicDeletions,
    topicTombstoneKey,
};
