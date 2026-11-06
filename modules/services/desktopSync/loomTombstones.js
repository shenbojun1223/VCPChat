"use strict";

const fs = require("fs-extra");
const path = require("path");

const STORE_VERSION = 1;
const STORE_RELATIVE_PATH = path.join(".desktop-sync", "loom-tombstones.json");
const SAFE_LOOM_APP_ID = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const SIDE_BROWSER_APP_ID = "vcpchat-browser";

let mutationQueue = Promise.resolve();

function getLoomTombstonePath(userDataDir) {
    if (typeof userDataDir !== "string" || !userDataDir.trim()) {
        throw new Error("Loom tombstone store requires a UserData directory");
    }
    return path.join(userDataDir, STORE_RELATIVE_PATH);
}

function normalizeLoomTombstone(value) {
    if (!value || typeof value !== "object") return null;
    const id = typeof value.id === "string" ? value.id.trim().toLowerCase() : "";
    const deletedAt = Number(value.deletedAt);
    if (
        !SAFE_LOOM_APP_ID.test(id) ||
        id === SIDE_BROWSER_APP_ID ||
        !Number.isSafeInteger(deletedAt) ||
        deletedAt < 0
    ) {
        return null;
    }
    return { id, deletedAt };
}

function loomTombstoneKey(value) {
    if (typeof value === "string") {
        const id = value.trim().toLowerCase();
        return SAFE_LOOM_APP_ID.test(id) && id !== SIDE_BROWSER_APP_ID ? id : "";
    }
    const id = typeof value?.id === "string" ? value.id.trim().toLowerCase() : "";
    return SAFE_LOOM_APP_ID.test(id) && id !== SIDE_BROWSER_APP_ID ? id : "";
}

async function readStore(userDataDir) {
    let stored;
    try {
        stored = await fs.readJson(getLoomTombstonePath(userDataDir));
    } catch (error) {
        if (error?.code === "ENOENT") return [];
        throw error;
    }
    const apps = Array.isArray(stored) ? stored : stored?.apps;
    if (!Array.isArray(apps)) return [];

    const deduplicated = new Map();
    for (const value of apps) {
        const tombstone = normalizeLoomTombstone(value);
        if (!tombstone) continue;
        const key = tombstone.id;
        const existing = deduplicated.get(key);
        if (!existing || tombstone.deletedAt > existing.deletedAt) {
            deduplicated.set(key, tombstone);
        }
    }
    return [...deduplicated.values()];
}

async function writeStore(userDataDir, apps) {
    const storePath = getLoomTombstonePath(userDataDir);
    if (!apps.length) {
        await fs.remove(storePath);
        return;
    }
    await fs.ensureDir(path.dirname(storePath));
    const tempPath = `${storePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeJson(tempPath, { version: STORE_VERSION, apps }, { spaces: 2 });
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

async function recordLoomAppDeletion(userDataDir, value) {
    const tombstone = normalizeLoomTombstone({
        ...value,
        deletedAt: value?.deletedAt ?? Date.now(),
    });
    if (!tombstone) throw new Error("Invalid LoomApp deletion tombstone");
    const key = tombstone.id;
    await mutateStore(userDataDir, (current) => {
        const byKey = new Map(current.map((item) => [item.id, item]));
        const existing = byKey.get(key);
        byKey.set(key, existing && existing.deletedAt >= tombstone.deletedAt ? existing : tombstone);
        return [...byKey.values()];
    });
    return tombstone;
}

async function listLoomAppDeletions(userDataDir) {
    await mutationQueue;
    return readStore(userDataDir);
}

async function removeLoomAppDeletions(userDataDir, values) {
    const keys = new Set((values || []).map(loomTombstoneKey).filter(Boolean));
    if (!keys.size) return listLoomAppDeletions(userDataDir);
    return mutateStore(
        userDataDir,
        (current) => current.filter((item) => !keys.has(item.id)),
    );
}

module.exports = {
    getLoomTombstonePath,
    listLoomAppDeletions,
    loomTombstoneKey,
    recordLoomAppDeletion,
    removeLoomAppDeletions,
};