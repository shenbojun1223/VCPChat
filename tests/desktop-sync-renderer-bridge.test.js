"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  createDesktopSyncRendererBridge,
  trySendToRenderer,
} = require("../modules/services/desktopSync/rendererBridge");

test("disposed WebFrameMain is treated as a transient unavailable renderer", () => {
  const window = {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      isLoadingMainFrame: () => false,
      send() {
        throw new Error(
          "Render frame was disposed before WebFrameMain could be accessed",
        );
      },
    },
  };

  assert.doesNotThrow(() => {
    assert.equal(
      trySendToRenderer(() => window, "desktop-sync-status", {}),
      false,
    );
  });
});

test("pending data refresh is replayed after renderer reload completes", () => {
  let loading = true;
  let cacheClears = 0;
  const sent = [];
  const status = {
    state: "success",
    dataChanged: true,
    running: false,
  };
  const window = {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      isLoadingMainFrame: () => loading,
      send: (channel, payload) => sent.push({ channel, payload }),
    },
  };
  const bridge = createDesktopSyncRendererBridge({
    getWindow: () => window,
    getStatus: () => status,
    onDataChanged: () => {
      cacheClears += 1;
    },
  });

  bridge.notify(status);
  assert.equal(cacheClears, 1);
  assert.deepEqual(sent, []);

  loading = false;
  bridge.flush();
  assert.deepEqual(
    sent.map(({ channel }) => channel),
    ["desktop-sync-status", "desktop-sync-data-updated"],
  );
});
