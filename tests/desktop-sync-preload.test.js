"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
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
  const module = { exports: {} };
  const wrapper = vm.runInNewContext(
    `(function(require, module, exports, __filename, __dirname) { ${source}\n})`,
    { console },
    { filename },
  );
  wrapper(
    (request) => {
      if (request === "electron") return electron;
      throw new Error(`Unexpected preload dependency: ${request}`);
    },
    module,
    module.exports,
    filename,
    path.dirname(filename),
  );

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
    assert.equal(exposed.electronAPI[method], undefined);
  }
});

test("shared preload catalog assigns desktop sync only to the chat role", () => {
  const { createCatalog } = require("../preloads/shared/catalog");
  const { CHAT_KEYS, UTILITY_KEYS } = require("../preloads/shared/roles");
  const ops = {
    invoke() {},
    send() {},
    subscribe: () => () => {},
    pathApi: {},
  };
  const catalog = createCatalog(ops);

  for (const method of DESKTOP_SYNC_METHODS) {
    assert.ok(catalog[method], `${method} must exist in the shared catalog`);
    assert.ok(CHAT_KEYS.includes(method), `${method} must belong to CHAT_KEYS`);
    assert.ok(!UTILITY_KEYS.includes(method), `${method} must not belong to UTILITY_KEYS`);
  }
});
