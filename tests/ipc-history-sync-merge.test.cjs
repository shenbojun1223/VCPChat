"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { HistoryMutationQueue } = require("../modules/services/historyMutationQueue");
const {
  listMessageDeletions,
  getMessageTombstonePath,
} = require("../modules/services/desktopSync/messageTombstones");

const root = path.resolve(__dirname, "..");
const quiet = { log() {}, warn() {}, error() {}, info() {}, debug() {} };

// Load the real IPC registration and save handlers; only Electron and unrelated
// renderer/group services are replaced. Queue and tombstone persistence remain real.
function register(relative, context) {
  const filename = path.join(root, relative);
  const nativeRequire = createRequire(filename);
  const handlers = new Map();
  const electron = {
    ipcMain: {
      handle(channel, handler) {
        assert.equal(handlers.has(channel), false, "Duplicate IPC handler " + channel);
        handlers.set(channel, handler);
      },
      on() {},
      removeHandler() {},
    },
    dialog: {},
    BrowserWindow: { fromWebContents() { return null; } },
  };
  const module = { exports: {} };
  const localRequire = request => {
    if (request === "electron") return electron;
    if (request === "../../Groupmodules/groupchat") return {};
    if (request === "../../Groupmodules/topicTitleManager") return {};
    return nativeRequire(request);
  };
  const sandbox = {
    module, exports: module.exports, require: localRequire,
    __dirname: path.dirname(filename), __filename: filename,
    console: quiet, process, Buffer, URL, URLSearchParams,
    setTimeout, clearTimeout, setInterval, clearInterval,
    setImmediate, clearImmediate, AbortController, AbortSignal,
  };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), sandbox, { filename });
  module.exports.initialize(null, context);
  return handlers;
}

test("merged Agent and Group IPC saves share the history queue and preserve explicit tombstones",
  { timeout: 15000 }, async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vcp-ipc-sync-merge-"));
    const userDataDir = path.join(dir, "UserData");
    const agentDir = path.join(dir, "Agents");
    const watcher = { stopWatching() {}, signalInternalSave() {} };
    const queue = new HistoryMutationQueue({ userDataDir, fileWatcher: watcher, logger: quiet });
    const context = {
      AGENT_DIR: agentDir, USER_DATA_DIR: userDataDir,
      APP_DATA_ROOT_IN_PROJECT: dir, NOTES_AGENT_ID: "fixture-notes",
      fileWatcher: watcher, historyMutationQueue: queue,
      getMusicState: () => ({}),
    };
    const message = id => ({ id, role: "user", content: "Fixture " + id, timestamp: 1 });
    const descriptor = (itemType, topicId) => ({
      itemType, itemId: itemType + "-fixture", topicId,
    });
    const rowsFor = async d => (await listMessageDeletions(userDataDir))
      .filter(row => row.ownerType === d.itemType && row.ownerId === d.itemId && row.topicId === d.topicId);
    const historyFile = d => queue.getHistoryPath(d.itemId, d.topicId);
    async function seed(d, ids) {
      await queue.replace(d, ids.map(message));
    }
    try {
      await fs.ensureDir(agentDir);
      await fs.ensureDir(userDataDir);
      const agent = register("modules/ipc/chatHandlers.js", context).get("save-chat-history");
      const group = register("modules/ipc/groupChatHandlers.js", context).get("save-group-chat-history");
      assert.equal(typeof agent, "function");
      assert.equal(typeof group, "function");
      for (const [type, save] of [["agent", agent], ["group", group]]) {
        const invoke = (d, history, options) => save({}, d.itemId, d.topicId, history, options);

        await t.test(type + ": record only requested deletions present in the latest old history", async () => {
          const d = descriptor(type, "explicit");
          await seed(d, ["keep", "drop", "incidental", "still-present"]);
          const result = await invoke(d, [message("keep"), message("still-present")], {
            deletedMessageIds: ["drop", "drop", "not-present", "still-present", null],
            deletedAt: 123,
          });
          assert.equal(result.success, true);
          assert.deepEqual((await queue.read(d)).map(row => row.id), ["keep", "still-present"]);
          assert.deepEqual(await rowsFor(d), [{
            ownerType: type, ownerId: d.itemId, topicId: d.topicId, msgId: "drop", deletedAt: 123,
          }]);
        });

        await t.test(type + ": absence in a replacement without deletion intent is not a tombstone", async () => {
          const d = descriptor(type, "no-intent");
          await seed(d, ["keep", "omitted"]);
          const result = await invoke(d, [message("keep")]);
          assert.equal(result.success, true);
          assert.deepEqual(await rowsFor(d), []);
          assert.deepEqual((await queue.read(d)).map(row => row.id), ["keep"]);
        });

        await t.test(type + ": queued IPC reads the latest history and snapshots caller intent", async () => {
          const d = descriptor(type, "queued-intent");
          await seed(d, ["keep"]);
          let release;
          const gate = new Promise(resolve => { release = resolve; });
          const blocker = queue.run(d, () => gate);
          const background = queue.mutate(d, previous => [...previous, message("added-in-queue")]);
          const submitted = [message("keep")];
          const options = { deletedMessageIds: ["added-in-queue"], deletedAt: 456 };
          const pending = invoke(d, submitted, options);
          submitted[0].content = "Mutated after invocation";
          submitted.push(message("caller-late"));
          options.deletedMessageIds.length = 0;
          options.deletedAt = 999;
          release();
          const [, , result] = await Promise.all([blocker, background, pending]);
          assert.equal(result.success, true);
          assert.deepEqual(await queue.read(d), [message("keep")]);
          assert.deepEqual(await rowsFor(d), [{
            ownerType: type, ownerId: d.itemId, topicId: d.topicId,
            msgId: "added-in-queue", deletedAt: 456,
          }]);
        });

        await t.test(type + ": corrupt history fails without rewriting it or recording deletions", async () => {
          const d = descriptor(type, "corrupt");
          await seed(d, ["old"]);
          await fs.writeFile(historyFile(d), "{broken-fixture-json");
          const before = await fs.readFile(historyFile(d));
          const result = await invoke(d, [], { deletedMessageIds: ["old"], deletedAt: 789 });
          assert.notEqual(result.success, true);
          assert.equal(typeof result.error, "string");
          assert.deepEqual(await fs.readFile(historyFile(d)), before);
          assert.deepEqual(await rowsFor(d), []);
        });

        await t.test(type + ": invalid history is rejected before creating files", async () => {
          const d = descriptor(type, "invalid-input");
          const result = await invoke(d, null, { deletedMessageIds: ["old"] });
          assert.notEqual(result.success, true);
          assert.equal(await fs.pathExists(historyFile(d)), false);
          assert.deepEqual(await rowsFor(d), []);
        });

        await t.test(type + ": tombstone storage failure cannot silently commit history", async () => {
          const d = descriptor(type, "bad-tombstone-store");
          await seed(d, ["old"]);
          const store = getMessageTombstonePath(userDataDir);
          const originalStore = await fs.readFile(store);
          const before = await fs.readFile(historyFile(d));
          try {
            await fs.writeFile(store, "{invalid-fixture-store");
            const result = await invoke(d, [], { deletedMessageIds: ["old"], deletedAt: 800 });
            assert.notEqual(result.success, true);
            assert.equal(typeof result.error, "string");
            assert.deepEqual(await fs.readFile(historyFile(d)), before);
          } finally {
            await fs.writeFile(store, originalStore);
          }
        });

        await t.test(type + ": failed history write is reported and retained deletion evidence is explicit", async () => {
          const d = descriptor(type, "write-failure");
          await seed(d, ["old"]);
          const before = await fs.readFile(historyFile(d));
          const write = queue.write;
          queue.write = async function(target, next) {
            if (target.itemId === d.itemId && target.topicId === d.topicId) {
              throw new Error("Injected fixture history write failure");
            }
            return write.call(this, target, next);
          };
          try {
            const result = await invoke(d, [], { deletedMessageIds: ["old"], deletedAt: 900 });
            assert.notEqual(result.success, true);
            assert.match(result.error, /Injected fixture/);
            assert.deepEqual(await fs.readFile(historyFile(d)), before);
            // This preserves the pre-existing evidence-before-history ordering.
            // It does not claim the two physical files form one atomic transaction.
            assert.deepEqual(await rowsFor(d), [{
              ownerType: type, ownerId: d.itemId, topicId: d.topicId, msgId: "old", deletedAt: 900,
            }]);
          } finally {
            queue.write = write;
          }
        });
      }
      assert.equal(queue.diagnostics().pendingConversations, 0);
    } finally {
      await queue.dispose();
      console.log("IPC_SYNC_MERGE_FIXTURE=" + dir);
      // Retain the synthetic fixture on disk for audit, never use live AppData.
    }
  });