"use strict";

const crypto = require("node:crypto");
const fs = require("fs-extra");
const path = require("node:path");

const fileQueues = new Map();

function fileKey(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function withJsonFileLock(filePath, task) {
  const key = fileKey(filePath);
  const previous = fileQueues.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(task);
  fileQueues.set(key, current);
  return current.finally(() => {
    if (fileQueues.get(key) === current) fileQueues.delete(key);
  });
}

async function writeJsonAtomicUnlocked(filePath, value, { spaces = 2 } = {}) {
  await fs.ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`;
  try {
    const serialized = JSON.stringify(value, null, spaces);
    if (serialized === undefined) {
      throw new TypeError(`Cannot serialize JSON value for ${filePath}`);
    }
    await fs.writeFile(tempPath, `${serialized}\n`, "utf8");
    await fs.move(tempPath, filePath, { overwrite: true });
  } finally {
    await fs.remove(tempPath).catch(() => {});
  }
}

function writeJsonAtomic(filePath, value, options) {
  return withJsonFileLock(filePath, () =>
    writeJsonAtomicUnlocked(filePath, value, options),
  );
}

function updateJsonAtomic(filePath, updater, { defaultValue, spaces = 2 } = {}) {
  return withJsonFileLock(filePath, async () => {
    let current;
    try {
      current = await fs.readJson(filePath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      current = typeof defaultValue === "function" ? defaultValue() : defaultValue;
    }
    const next = await updater(current);
    await writeJsonAtomicUnlocked(filePath, next, { spaces });
    return next;
  });
}

module.exports = {
  updateJsonAtomic,
  withJsonFileLock,
  writeJsonAtomic,
};
