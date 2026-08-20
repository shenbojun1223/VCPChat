"use strict";

const assert = require("node:assert/strict");
const nativeFs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const fs = require("fs-extra");

const {
  updateJsonAtomic,
  writeJsonAtomic,
} = require("../modules/services/atomicJsonFile");

function removeTempDir(dir) {
  return nativeFs.rm(dir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 50,
  });
}

test("serialized atomic JSON updates preserve every concurrent mutation", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vcpchat-atomic-json-"));
  t.after(() => removeTempDir(dir));
  const filePath = path.join(dir, "history.json");
  await writeJsonAtomic(filePath, []);

  await Promise.all(Array.from({ length: 25 }, (_, index) =>
    updateJsonAtomic(filePath, history => [...history, { id: `message-${index}` }]),
  ));

  const history = await fs.readJson(filePath);
  assert.equal(history.length, 25);
  assert.deepEqual(
    new Set(history.map(message => message.id)),
    new Set(Array.from({ length: 25 }, (_, index) => `message-${index}`)),
  );
});

test("a failed JSON update leaves the previous file intact", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vcpchat-atomic-json-"));
  t.after(() => removeTempDir(dir));
  const filePath = path.join(dir, "history.json");
  const original = [{ id: "keep" }];
  await writeJsonAtomic(filePath, original);

  await assert.rejects(
    updateJsonAtomic(filePath, () => {
      throw new Error("simulated update failure");
    }),
    /simulated update failure/,
  );

  assert.deepEqual(await fs.readJson(filePath), original);
});
