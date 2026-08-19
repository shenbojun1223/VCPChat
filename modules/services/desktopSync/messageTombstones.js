const fs = require('fs-extra');
const path = require('path');

const STORE_VERSION = 1;
const STORE_RELATIVE_PATH = path.join('.desktop-sync', 'message-tombstones.json');

let mutationQueue = Promise.resolve();

function getMessageTombstonePath(userDataDir) {
    if (typeof userDataDir !== 'string' || !userDataDir.trim()) {
        throw new Error('Message tombstone store requires a UserData directory');
    }
    return path.join(userDataDir, STORE_RELATIVE_PATH);
}

function normalizeMessageTombstone(value) {
    if (!value || typeof value !== 'object') return null;
    const topicId = typeof value.topicId === 'string' ? value.topicId.trim() : '';
    const msgId = typeof value.msgId === 'string' ? value.msgId.trim() : '';
    const deletedAt = Number(value.deletedAt);
    if (
        !topicId ||
        !msgId ||
        !Number.isSafeInteger(deletedAt) ||
        deletedAt < 0
    ) {
        return null;
    }
    return { topicId, msgId, deletedAt };
}

function messageTombstoneKey(value) {
    const tombstone = normalizeMessageTombstone(value);
    return tombstone ? `${tombstone.topicId}:${tombstone.msgId}` : '';
}

async function readStore(userDataDir) {
    const storePath = getMessageTombstonePath(userDataDir);
    let stored;
    try {
        stored = await fs.readJson(storePath);
    } catch (error) {
        if (error?.code === 'ENOENT') return [];
        throw error;
    }
    const messages = Array.isArray(stored) ? stored : stored?.messages;
    if (!Array.isArray(messages)) return [];

    const deduplicated = new Map();
    for (const value of messages) {
        const tombstone = normalizeMessageTombstone(value);
        if (!tombstone) continue;
        const key = messageTombstoneKey(tombstone);
        const existing = deduplicated.get(key);
        if (!existing || tombstone.deletedAt < existing.deletedAt) {
            deduplicated.set(key, tombstone);
        }
    }
    return [...deduplicated.values()];
}

async function writeStore(userDataDir, messages) {
    const storePath = getMessageTombstonePath(userDataDir);
    if (!messages.length) {
        await fs.remove(storePath);
        return;
    }

    await fs.ensureDir(path.dirname(storePath));
    const tempPath = `${storePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeJson(tempPath, { version: STORE_VERSION, messages }, { spaces: 2 });
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

async function recordMessageDeletions(userDataDir, values) {
    const tombstones = (values || []).map(value =>
        normalizeMessageTombstone({
            ...value,
            deletedAt: value?.deletedAt ?? Date.now(),
        })
    );
    if (!tombstones.length || tombstones.some(value => !value)) {
        throw new Error('Invalid message deletion tombstone');
    }

    await mutateStore(userDataDir, current => {
        const byKey = new Map(current.map(item => [messageTombstoneKey(item), item]));
        for (const tombstone of tombstones) {
            const key = messageTombstoneKey(tombstone);
            const existing = byKey.get(key);
            byKey.set(
                key,
                existing && existing.deletedAt <= tombstone.deletedAt
                    ? existing
                    : tombstone,
            );
        }
        return [...byKey.values()];
    });
    return tombstones;
}

async function recordRemovedMessages(
    userDataDir,
    topicId,
    previousHistory,
    nextHistory,
    deletedAt = Date.now(),
) {
    const nextIds = new Set(
        (Array.isArray(nextHistory) ? nextHistory : [])
            .map(message => message?.id)
            .filter(id => typeof id === 'string' && id.length > 0),
    );
    const removedIds = [
        ...new Set(
            (Array.isArray(previousHistory) ? previousHistory : [])
                .map(message => message?.id)
                .filter(id => typeof id === 'string' && id.length > 0 && !nextIds.has(id)),
        ),
    ];
    if (!removedIds.length) return [];
    return recordMessageDeletions(
        userDataDir,
        removedIds.map(msgId => ({ topicId, msgId, deletedAt })),
    );
}

async function listMessageDeletions(userDataDir) {
    await mutationQueue;
    return readStore(userDataDir);
}

async function removeMessageDeletions(userDataDir, values) {
    const keys = new Set((values || []).map(messageTombstoneKey).filter(Boolean));
    if (!keys.size) return listMessageDeletions(userDataDir);
    return mutateStore(
        userDataDir,
        current => current.filter(item => !keys.has(messageTombstoneKey(item))),
    );
}

module.exports = {
    getMessageTombstonePath,
    listMessageDeletions,
    messageTombstoneKey,
    recordMessageDeletions,
    recordRemovedMessages,
    removeMessageDeletions,
};
