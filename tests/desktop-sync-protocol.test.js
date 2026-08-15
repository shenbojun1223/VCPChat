"use strict";

const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const fs = require("fs-extra");

const { DesktopSyncService } = require("../modules/services/desktopSync");
const {
  listTopicDeletions,
  recordTopicDeletion,
} = require("../modules/services/desktopSync/topicTombstones");
const {
  listOwnerDeletions,
  recordOwnerDeletion,
} = require("../modules/services/desktopSync/ownerTombstones");

function createService() {
  const service = new DesktopSyncService({
    appDataPath: "C:/unused-test-appdata",
    logger: { error() {} },
  });
  service.settings = {
    enabled: true,
    httpUrl: "http://127.0.0.1:6005",
    wsUrl: "ws://127.0.0.1:5975/ws-sync",
    token: "test-token",
    intervalSeconds: 60,
  };
  return service;
}

function topicFixture() {
  return {
    id: "topic-1",
    ownerType: "agent",
    ownerId: "agent-1",
    configHash: "a".repeat(64),
    contentHash: "b".repeat(64),
    ts: 123,
    messageHashes: { "message-1": "c".repeat(64) },
    messages: [{ id: "message-1", content: "hello" }],
    historyPath: "C:/unused-test-appdata/history.json",
  };
}

test("desktop sync sends and validates VERSION_CHECK before business frames", async () => {
  const service = createService();
  const frames = [];
  const socket = { close() {} };
  service.syncFullConfigs = async () => {};
  service.openWebSocket = async () => socket;
  service.wsRequest = async (_socket, payload) => {
    frames.push(payload);
    return {
      type: "VERSION_ACK",
      pluginVersion: "1.1.0",
      protocolVersion: "1.1",
    };
  };
  service.syncTopicsAndMessages = async () => frames.push({ type: "TOPICS" });
  service.syncAvatars = async () => frames.push({ type: "AVATARS" });

  const status = await service.runNow("manual");
  assert.equal(status.state, "success");
  assert.deepEqual(frames[0], {
    type: "VERSION_CHECK",
    mobileVersion: "vcpchat-desktop-sync-1.1",
    protocolVersion: "1.1",
  });
  assert.deepEqual(frames.slice(1).map(({ type }) => type), ["TOPICS", "AVATARS"]);
});

test("renderer notification failure cannot reject or stall a completed sync", async () => {
  const warnings = [];
  const service = new DesktopSyncService({
    appDataPath: "C:/unused-test-appdata",
    notify() {
      throw new Error(
        "Render frame was disposed before WebFrameMain could be accessed",
      );
    },
    logger: {
      error() {},
      warn(...args) {
        warnings.push(args);
      },
    },
  });
  service.settings = {
    enabled: true,
    httpUrl: "http://127.0.0.1:6005",
    wsUrl: "ws://127.0.0.1:5975/ws-sync",
    token: "test-token",
    intervalSeconds: 60,
  };
  service.syncFullConfigs = async () => ({});
  service.openWebSocket = async () => ({ close() {} });
  service.wsRequest = async () => ({
    type: "VERSION_ACK",
    pluginVersion: "1.1.0",
    protocolVersion: "1.1",
  });
  service.syncTopicsAndMessages = async () => ({});
  service.syncAvatars = async () => ({});

  const status = await service.runNow("manual");

  assert.equal(status.state, "success");
  assert.equal(status.running, false);
  assert.ok(warnings.length >= 2);
});

test("topic manifest and message diff carry protocol 1.1 owner identity", async () => {
  const service = createService();
  const topic = topicFixture();
  const frames = [];
  service.buildTopicState = async () => [topic];
  service.wsRequest = async (_socket, payload) => {
    frames.push(payload);
    if (payload.type === "SYNC_MANIFEST") return { data: [] };
    return { results: {} };
  };

  await service.syncTopicsAndMessages({});

  assert.deepEqual(frames[0], {
    type: "SYNC_MANIFEST",
    dataType: "topic",
    phase: 2,
    targetedOwners: ["agent-1"],
    data: [{
      id: "topic-1",
      hash: "a".repeat(64),
      configHash: "a".repeat(64),
      contentHash: "b".repeat(64),
      ts: 123,
      ownerType: "agent",
      ownerId: "agent-1",
    }],
  });
  assert.deepEqual(frames[1].topics["topic-1"], {
    ownerType: "agent",
    ownerId: "agent-1",
    topicHash: "b".repeat(64),
    messages: { "message-1": "c".repeat(64) },
  });
});

test("fresh client targets downloaded owners before it has local topics", async () => {
  const service = createService();
  service.buildTopicState = async () => [];
  service.listConfigs = async () => [
    { id: "agent-1", type: "agent" },
    { id: "group-1", type: "group" },
  ];
  let manifest;
  service.wsRequest = async (_socket, payload) => {
    manifest = payload;
    return { data: [] };
  };

  await service.syncTopicsAndMessages({});

  assert.equal(manifest.type, "SYNC_MANIFEST");
  assert.deepEqual(manifest.targetedOwners, ["agent-1", "group-1"]);
  assert.deepEqual(manifest.data, []);
});

test("pending topic tombstones are uploaded durably before topic sync", async (t) => {
  const appDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "vcpchat-desktop-sync-"));
  t.after(() => fs.remove(appDataPath));
  const userDataDir = path.join(appDataPath, "UserData");
  const service = new DesktopSyncService({
    appDataPath,
    logger: { error() {}, warn() {} },
  });
  const tombstone = await recordTopicDeletion(userDataDir, {
    id: "topic-deleted",
    ownerId: "agent-1",
    ownerType: "agent",
    deletedAt: 1700000000000,
  });
  const calls = [];
  service.apiJson = async (pathname, options) => {
    calls.push({ pathname, options });
    return { success: true };
  };

  const uploaded = await service.flushTopicTombstones();

  assert.deepEqual(uploaded, ["topic-deleted"]);
  assert.deepEqual(calls, [{
    pathname: "/delete-entity",
    options: {
      method: "POST",
      body: {
        id: tombstone.id,
        type: "agent_topic",
        deletedAt: tombstone.deletedAt,
      },
    },
  }]);
  assert.deepEqual(await listTopicDeletions(userDataDir), []);
});

test("pending owner tombstones are uploaded before config manifest", async (t) => {
  const appDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "vcpchat-desktop-sync-"));
  t.after(() => fs.remove(appDataPath));
  const userDataDir = path.join(appDataPath, "UserData");
  const service = new DesktopSyncService({
    appDataPath,
    logger: { error() {}, warn() {} },
  });
  await recordOwnerDeletion(userDataDir, {
    id: "group-deleted",
    type: "group",
    deletedAt: 1700000000000,
  });
  const calls = [];
  service.apiJson = async (pathname, options) => {
    calls.push({ pathname, options });
    return pathname === "/desktop/config-manifest" ? { actions: [] } : { success: true };
  };
  service.listConfigs = async () => [];

  await service.flushOwnerTombstones();
  await service.syncFullConfigs();

  assert.deepEqual(calls.map(call => call.pathname), [
    "/delete-entity",
    "/desktop/config-manifest",
  ]);
  assert.deepEqual(calls[0].options.body, {
    id: "group-deleted",
    type: "group",
    deletedAt: 1700000000000,
  });
  assert.deepEqual(await listOwnerDeletions(userDataDir), []);
});

test("server owner DELETE removes stale local config and history", async (t) => {
  const appDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "vcpchat-desktop-sync-"));
  t.after(() => fs.remove(appDataPath));
  const groupId = "group-deleted-remotely";
  const groupDir = path.join(appDataPath, "AgentGroups", groupId);
  const historyDir = path.join(appDataPath, "UserData", groupId);
  await fs.ensureDir(groupDir);
  await fs.ensureDir(historyDir);
  await fs.writeJson(path.join(groupDir, "config.json"), { id: groupId, name: "stale" });
  await fs.writeJson(path.join(historyDir, "history.json"), []);

  const service = new DesktopSyncService({
    appDataPath,
    logger: { error() {}, warn() {} },
  });
  service.apiJson = async pathname => {
    if (pathname === "/desktop/config-manifest") {
      return {
        actions: [{ id: groupId, type: "group", action: "DELETE", deletedAt: 1 }],
      };
    }
    throw new Error(`Unexpected API call ${pathname}`);
  };

  const result = await service.syncFullConfigs();

  assert.deepEqual(result.deletedConfigIds, [`group:${groupId}`]);
  assert.equal(await fs.pathExists(groupDir), false);
  assert.equal(await fs.pathExists(historyDir), false);
});

test("failed topic tombstone upload remains queued for retry", async (t) => {
  const appDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "vcpchat-desktop-sync-"));
  t.after(() => fs.remove(appDataPath));
  const userDataDir = path.join(appDataPath, "UserData");
  const service = new DesktopSyncService({
    appDataPath,
    logger: { error() {}, warn() {} },
  });
  await recordTopicDeletion(userDataDir, {
    id: "topic-retry",
    ownerId: "group-1",
    ownerType: "group",
    deletedAt: 1700000000001,
  });
  service.apiJson = async () => {
    throw new Error("offline");
  };

  await assert.rejects(service.flushTopicTombstones(), /offline/);
  assert.deepEqual(await listTopicDeletions(userDataDir), [{
    id: "topic-retry",
    ownerId: "group-1",
    ownerType: "group",
    deletedAt: 1700000000001,
  }]);
});

test("server PUSH_DELETE removes the local topic config and history", async (t) => {
  const appDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "vcpchat-desktop-sync-"));
  t.after(() => fs.remove(appDataPath));
  const configPath = path.join(appDataPath, "Agents", "agent-1", "config.json");
  const topicDir = path.join(appDataPath, "UserData", "agent-1", "topics", "topic-deleted");
  await fs.outputJson(configPath, {
    id: "agent-1",
    topics: [
      { id: "topic-deleted", name: "delete me" },
      { id: "topic-kept", name: "keep me" },
    ],
  });
  await fs.outputJson(path.join(topicDir, "history.json"), [{ id: "message-1" }]);
  const service = new DesktopSyncService({
    appDataPath,
    logger: { error() {}, warn() {} },
  });

  const deleted = await service.applyRemoteTopicDeletions([{
    id: "topic-deleted",
    action: "PUSH_DELETE",
    ownerId: "agent-1",
    ownerType: "agent",
    deletedAt: 1700000000002,
  }]);

  assert.deepEqual(deleted, ["topic-deleted"]);
  assert.deepEqual((await fs.readJson(configPath)).topics, [{ id: "topic-kept", name: "keep me" }]);
  assert.equal(await fs.pathExists(topicDir), false);
});

test("message HTTP frames and avatar manifest carry owner and phase fields", async () => {
  const service = createService();
  const topic = topicFixture();
  const calls = [];
  service.api = async (pathname, options) => {
    calls.push({ pathname, options });
    return { text: async () => "" };
  };

  await service.pullMessages(
    { "topic-1": { toPull: ["message-1"] } },
    [topic],
  );
  assert.deepEqual(calls[0], {
    pathname: "/download-messages-stream",
    options: {
      method: "POST",
      body: {
        requests: [{
          topicId: "topic-1",
          ownerType: "agent",
          ownerId: "agent-1",
          msgIds: ["message-1"],
        }],
      },
    },
  });

  await service.pushMessages({ "topic-1": { toPush: true } }, [topic]);
  const pushedFrame = JSON.parse(calls[1].options.body.trim());
  assert.equal(pushedFrame.ownerType, "agent");
  assert.equal(pushedFrame.ownerId, "agent-1");

  service.buildAvatarManifest = async () => [{
    id: "agent:agent-1",
    hash: "d".repeat(64),
    ts: 456,
  }];
  let avatarFrame;
  service.wsRequest = async (_socket, payload) => {
    avatarFrame = payload;
    return { data: [] };
  };
  await service.syncAvatars({});
  assert.equal(avatarFrame.phase, 1);
  assert.equal(avatarFrame.dataType, "avatar");
});

test("missing remote attachment becomes a placeholder without failing message sync", async (t) => {
  const appDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "vcpchat-desktop-sync-"));
  t.after(() => fs.remove(appDataPath));

  const service = new DesktopSyncService({
    appDataPath,
    logger: { error() {}, warn() {} },
  });
  service.api = async (pathname) => {
    assert.match(pathname, /^\/download-attachment\?hash=/);
    const error = new Error("HTTP 404: Not Found");
    error.status = 404;
    throw error;
  };

  const hash = "d".repeat(64);
  const message = await service.normalizeRemoteMessage({
    id: "message-with-missing-attachment",
    role: "user",
    content: "attachment metadata survives",
    attachments: [{ hash, name: "missing.txt", type: "text/plain", size: 12 }],
  });

  assert.equal(message.content, "attachment metadata survives");
  assert.equal(message.attachments.length, 1);
  assert.equal(message.attachments[0].status, "missing");
  assert.equal(message.attachments[0]._fileManagerData.hash, hash);
  assert.match(message.attachments[0].src, /^file:\/\//);
  assert.equal(await fs.pathExists(path.join(appDataPath, "UserData", "attachments", `${hash}.txt`)), false);
});

test("non-404 attachment download errors still fail message sync", async (t) => {
  const appDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "vcpchat-desktop-sync-"));
  t.after(() => fs.remove(appDataPath));
  const service = new DesktopSyncService({
    appDataPath,
    logger: { error() {}, warn() {} },
  });
  service.api = async () => {
    const error = new Error("HTTP 500: broken attachment store");
    error.status = 500;
    throw error;
  };

  await assert.rejects(
    service.normalizeRemoteMessage({
      id: "message-with-server-error",
      attachments: [{ hash: "e".repeat(64), name: "broken.txt", type: "text/plain" }],
    }),
    /HTTP 500/,
  );
});

test("topic with a missing local attachment is skipped before any server mutation", async (t) => {
  const appDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "vcpchat-desktop-sync-"));
  t.after(() => fs.remove(appDataPath));
  const service = new DesktopSyncService({
    appDataPath,
    logger: { error() {}, warn() {} },
  });
  const hash = "f".repeat(64);
  const topic = topicFixture();
  topic.messages[0].attachments = [{
    hash,
    name: "missing.txt",
    type: "text/plain",
  }];
  let apiCalled = false;
  service.api = async () => {
    apiCalled = true;
    throw new Error("server must not be called");
  };

  const result = await service.pushMessages({ "topic-1": { toPush: true } }, [topic]);

  assert.equal(apiCalled, false);
  assert.deepEqual(result.pushedTopicIds, []);
  assert.deepEqual(result.skippedTopics, [{
    topicId: "topic-1",
    missingAttachmentHashes: [hash],
  }]);
  assert.deepEqual(result.missingAttachmentHashes, [hash]);
});

test("empty assistant messages are not uploaded even if marked completed", async () => {
  const service = createService();
  const topic = topicFixture();
  topic.messages.push({
    id: "assistant-placeholder",
    role: "assistant",
    content: "",
    isThinking: false,
    finishReason: "completed",
  });
  let pushedFrame;
  service.api = async (pathname, options) => {
    assert.equal(pathname, "/upload-messages-batch");
    pushedFrame = JSON.parse(options.body.trim());
    return {
      text: async () => JSON.stringify({
        topicId: "topic-1",
        success: true,
        neededAttachmentHashes: [],
      }),
    };
  };

  await service.pushMessages({ "topic-1": { toPush: true } }, [topic]);

  assert.deepEqual(pushedFrame.messages.map((message) => message.id), ["message-1"]);
});

test("remote empty content cannot overwrite a non-empty local assistant message", async (t) => {
  const appDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "vcpchat-desktop-sync-"));
  t.after(() => fs.remove(appDataPath));
  const historyPath = path.join(appDataPath, "history.json");
  const localMessage = {
    id: "assistant-1",
    role: "assistant",
    content: "complete local answer",
    timestamp: 20,
  };
  await fs.writeJson(historyPath, [localMessage]);
  const service = new DesktopSyncService({
    appDataPath,
    logger: { error() {}, warn() {} },
  });
  service.api = async () => ({
    text: async () => JSON.stringify({
      topicId: "topic-1",
      messages: [{
        id: "assistant-1",
        role: "assistant",
        content: "",
        contentHash: "a".repeat(64),
        timestamp: 20,
      }],
    }),
  });
  const results = { "topic-1": { toPull: ["assistant-1"], toPush: false } };
  const topic = {
    ...topicFixture(),
    historyPath,
    messages: [],
  };

  await service.pullMessages(results, [topic]);

  assert.deepEqual(await fs.readJson(historyPath), [localMessage]);
  assert.equal(results["topic-1"].toPush, true);
});

test("a failed push rolls back history written by the preceding pull", async (t) => {
  const appDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "vcpchat-desktop-sync-"));
  t.after(() => fs.remove(appDataPath));
  const historyPath = path.join(appDataPath, "history.json");
  const originalHistory = [{
    id: "local-1",
    role: "user",
    content: "local before sync",
    timestamp: 10,
  }];
  await fs.writeJson(historyPath, originalHistory);
  const service = new DesktopSyncService({
    appDataPath,
    logger: { error() {}, warn() {} },
  });
  const topic = {
    ...topicFixture(),
    historyPath,
    messages: originalHistory,
  };
  service.listConfigs = async () => [{ id: "agent-1", type: "agent" }];
  service.buildTopicState = async () => [topic];
  service.wsRequest = async (_ws, payload) => payload.type === "SYNC_MANIFEST"
    ? { data: [] }
    : { results: { "topic-1": { toPull: ["remote-1"], toPush: true } } };
  service.api = async () => ({
    text: async () => JSON.stringify({
      topicId: "topic-1",
      messages: [{
        id: "remote-1",
        role: "assistant",
        content: "remote answer",
        timestamp: 20,
      }],
    }),
  });
  service.pushMessages = async () => {
    throw new Error("simulated push failure");
  };

  await assert.rejects(
    service.syncTopicsAndMessages({}),
    /simulated push failure/,
  );
  assert.deepEqual(await fs.readJson(historyPath), originalHistory);
});

test("sync completes with a visible warning when attachment repair is pending", async () => {
  const service = createService();
  const hash = "f".repeat(64);
  const socket = { close() {} };
  service.syncFullConfigs = async () => {};
  service.openWebSocket = async () => socket;
  service.wsRequest = async () => ({
    type: "VERSION_ACK",
    pluginVersion: "1.1.0",
    protocolVersion: "1.1",
  });
  service.syncTopicsAndMessages = async () => ({
    missingAttachmentHashes: [hash],
  });
  service.syncAvatars = async () => {};

  const status = await service.runNow("manual");

  assert.equal(status.state, "success");
  assert.match(status.message, /1 个附件.*等待其他设备补传/);
  assert.deepEqual(status.missingAttachmentHashes, [hash]);
});

test("sync status reports pulled desktop data for renderer refresh", async () => {
  const service = createService();
  const socket = { close() {} };
  service.syncFullConfigs = async () => ({ pulledConfigIds: ["agent:agent-1"] });
  service.openWebSocket = async () => socket;
  service.wsRequest = async () => ({
    type: "VERSION_ACK",
    pluginVersion: "1.1.0",
    protocolVersion: "1.1",
  });
  service.syncTopicsAndMessages = async () => ({
    pulledTopicIds: ["topic-2"],
    pulledMessageTopicIds: ["topic-1"],
    deletedTopicIds: ["topic-old"],
    skippedTopics: [],
    missingAttachmentHashes: [],
  });
  service.syncAvatars = async () => ({ pulledAvatarIds: ["agent:agent-1"] });

  const status = await service.runNow("manual");

  assert.equal(status.state, "success");
  assert.equal(status.dataChanged, true);
  assert.deepEqual(status.pulledTopicIds, ["topic-2"]);
  assert.deepEqual(status.pulledMessageTopicIds, ["topic-1"]);
  assert.deepEqual(status.deletedTopicIds, ["topic-old"]);
});
