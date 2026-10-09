"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { test } = require("node:test");

const PROJECT_ROOT = path.join(__dirname, "..");
const DESKTOP_SYNC_METHODS = [
  "runDesktopSync",
  "getDesktopSyncStatus",
  "onDesktopSyncStatus",
  "onDesktopSyncDataUpdated",
];

function loadPreload(relativePath) {
  const filename = path.join(PROJECT_ROOT, relativePath);
  const source = fs.readFileSync(filename, "utf8");
  const exposed = {};
  const calls = [];
  const listeners = new Map();

  const ipcRenderer = {
    invoke(channel, ...args) {
      calls.push({ kind: "invoke", channel, args });
      return Promise.resolve({ channel, args });
    },
    send(channel, ...args) {
      calls.push({ kind: "send", channel, args });
    },
    on(channel, listener) {
      listeners.set(channel, listener);
    },
    removeListener(channel, listener) {
      if (listeners.get(channel) === listener) {
        listeners.delete(channel);
      }
    },
  };
  const electron = {
    contextBridge: {
      exposeInMainWorld(name, api) {
        exposed[name] = api;
      },
    },
    ipcRenderer,
  };
  const cache = new Map();
  function evaluateModule(modulePath) {
    if (cache.has(modulePath)) return cache.get(modulePath).exports;
    const localRequire = createRequire(modulePath);
    const module = { exports: {} };
    cache.set(modulePath, module);
    const code = modulePath === filename ? source : fs.readFileSync(modulePath, "utf8");
    const wrapper = vm.runInNewContext(
      `(function(require, module, exports, __filename, __dirname) { ${code}\n})`,
      { console, URLSearchParams },
      { filename: modulePath },
    );
    wrapper((request) => {
      if (request === "electron") return electron;
      if (request.startsWith(".") || path.isAbsolute(request)) {
        return evaluateModule(localRequire.resolve(request));
      }
      return localRequire(request);
    }, module, module.exports, modulePath, path.dirname(modulePath));
    return module.exports;
  }
  evaluateModule(filename);

  return { exposed, calls, listeners };
}

test("chat preload exposes desktop sync IPC bridge", async () => {
  const { exposed, calls, listeners } = loadPreload("preloads/chat.js");
  const chatApi = exposed.chatAPI;

  for (const method of DESKTOP_SYNC_METHODS) {
    assert.equal(typeof chatApi[method], "function", `${method} must be exposed`);
  }

  await chatApi.runDesktopSync();
  await chatApi.getDesktopSyncStatus();
  assert.deepEqual(
    calls.filter(({ kind }) => kind === "invoke").map(({ channel }) => channel),
    ["desktop-sync-now", "desktop-sync-status"],
  );

  const statuses = [];
  const stopStatus = chatApi.onDesktopSyncStatus((status) => statuses.push(status));
  const stopData = chatApi.onDesktopSyncDataUpdated((status) => statuses.push(status));
  listeners.get("desktop-sync-status")({}, { state: "running" });
  listeners.get("desktop-sync-data-updated")({}, { state: "complete" });
  assert.deepEqual(statuses, [{ state: "running" }, { state: "complete" }]);

  stopStatus();
  stopData();
  assert.equal(listeners.size, 0);
});

test("utility preload does not expose desktop sync controls", () => {
  const { exposed } = loadPreload("preloads/utility.js");

  for (const method of DESKTOP_SYNC_METHODS) {
    assert.equal(exposed.utilityAPI[method], undefined);
    assert.equal(typeof exposed.electronAPI[method], "function");
  }
});

test("preload registry assigns desktop sync only to the chat role", () => {
  const { loadRegistry } = require("../preloads/core/registry");
  const catalog = loadRegistry();
  for (const method of DESKTOP_SYNC_METHODS) {
    const definition = catalog.get(method);
    assert.ok(definition, `${method} must exist in the registry`);
    assert.deepEqual(definition.roles, ["chat"]);
  }
});

test("new preload adapters preserve deletion intent and WorkerPanel commands", async () => {
  const { exposed, calls } = loadPreload("preloads/chat.js");
  const options = { deletedMessageIds: ["message-1"], deletedAt: 123 };
  await exposed.chatAPI.saveChatHistory("agent", "topic", [], options);
  await exposed.chatAPI.saveGroupChatHistory("group", "topic", [], options);
  assert.deepEqual(calls.map(call => call.args[3]), [options, options]);
  exposed.chatAPI.connectWorkerPanel("ws://worker", "key");
  exposed.chatAPI.queryWorkerJob("job-1", "trace");
  assert.deepEqual(JSON.parse(JSON.stringify(calls.slice(2))), [
    { kind: "send", channel: "connect-worker-panel", args: [{ url: "ws://worker", key: "key" }] },
    { kind: "send", channel: "query-worker-job", args: [{ jobId: "job-1", traceMode: "trace" }] },
  ]);
});
