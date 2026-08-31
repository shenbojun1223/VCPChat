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
const {
  listMessageDeletions,
  recordMessageDeletions,
} = require("../modules/services/desktopSync/messageTombstones");

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
    messageStates: {
      "message-1": { messageHash: "c".repeat(64), updatedAt: 123 },
    },
    messages: [{ id: "message-1", role: "user", content: "hello", timestamp: 123 }],
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
      pluginVersion: "1.4.0",
      protocolVersion: "1.4",
    };
  };
  service.syncTopicsAndMessages = async () => frames.push({ type: "TOPICS" });
  service.syncAvatars = async () => frames.push({ type: "AVATARS" });

  const status = await service.runNow("manual");
  assert.equal(status.state, "success");
  assert.deepEqual(frames[0], {
    type: "VERSION_CHECK",
    mobileVersion: "vcpchat-desktop-sync-1.4",
    protocolVersion: "1.4",
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
    pluginVersion: "1.4.0",
    protocolVersion: "1.4",
  });
  service.syncTopicsAndMessages = async () => ({});
  service.syncAvatars = async () => ({});

  const status = await service.runNow("manual");

  assert.equal(status.state, "success");
  assert.equal(status.running, false);
  assert.ok(warnings.length >= 2);
});

test("topic manifest and message diff carry Wire 1.4 compound identity", async () => {
  const service = createService();
  const topic = topicFixture();
  const frames = [];
  service.buildTopicState = async () => [topic];
  service.wsRequest = async (_socket, payload) => {
    frames.push(payload);
    if (payload.type === "SYNC_MANIFEST_REQUEST") return { results: [] };
    return {
      results: [{
        topicId: "topic-1",
        ownerType: "agent",
        ownerId: "agent-1",
        ok: true,
        pullMessageIds: [],
        pushTopic: false,
        deleteMessages: [],
      }],
    };
  };

  await service.syncTopicsAndMessages({});

  assert.deepEqual(frames[0], {
    type: "SYNC_MANIFEST_REQUEST",
    manifestType: "topic",
    targetedOwners: [{ ownerType: "agent", ownerId: "agent-1" }],
    items: [{
      topicId: "topic-1",
      configHash: "a".repeat(64),
      contentHash: "b".repeat(64),
      updatedAt: 123,
      ownerType: "agent",
      ownerId: "agent-1",
    }],
  });
  assert.deepEqual(frames[1].topics[0], {
    topicId: "topic-1",
    ownerType: "agent",
    ownerId: "agent-1",
    contentHash: "b".repeat(64),
    messages: {
      "message-1": { messageHash: "c".repeat(64), updatedAt: 123 },
    },
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
    return { results: [] };
  };

  await service.syncTopicsAndMessages({});

  assert.equal(manifest.type, "SYNC_MANIFEST_REQUEST");
  assert.deepEqual(manifest.targetedOwners, [
    { ownerType: "agent", ownerId: "agent-1" },
    { ownerType: "group", ownerId: "group-1" },
  ]);
  assert.deepEqual(manifest.items, []);
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
  const frames = [];
  service.wsSend = async (_ws, payload) => frames.push(payload);
  service.confirmPriorFrames = async (_ws, phase) => frames.push({ barrier: phase });

  const uploaded = await service.flushTopicTombstones({});

  assert.deepEqual(uploaded, ["topic-deleted"]);
  assert.deepEqual(frames, [{
    type: "SYNC_ENTITY_DELETE",
    targetType: "topic",
    ownerType: "agent",
    ownerId: "agent-1",
    topicId: tombstone.id,
    deletedAt: tombstone.deletedAt,
  }, {
    barrier: "topic_metadata",
  }]);
  assert.deepEqual(await listTopicDeletions(userDataDir), []);
});

test("topic metadata is re-advertised when local topics change before message diff", async () => {
  const service = createService();
  const first = topicFixture();
  const second = {
    ...topicFixture(),
    id: "topic-2",
    configHash: "d".repeat(64),
    contentHash: "",
    messageHashes: { "message-2": "e".repeat(64) },
    messageStates: {
      "message-2": { messageHash: "e".repeat(64), updatedAt: 123 },
    },
    messages: [{ id: "message-2", content: "new topic" }],
  };
  let buildCount = 0;
  service.buildTopicState = async () => {
    buildCount += 1;
    return buildCount === 1 ? [first] : [first, second];
  };
  service.listConfigs = async () => [{ id: "agent-1", type: "agent" }];
  const manifests = [];
  let messageDiff;
  service.wsRequest = async (_socket, payload) => {
    if (payload.type === "SYNC_MANIFEST_REQUEST") {
      manifests.push(payload);
      return manifests.length === 1
        ? { results: [] }
        : { results: [{ topicId: "topic-2", action: "PUSH", ownerId: "agent-1", ownerType: "agent" }] };
    }
    messageDiff = payload;
    return {
      results: ["topic-1", "topic-2"].map(topicId => ({
        topicId,
        ownerType: "agent",
        ownerId: "agent-1",
        ok: true,
        pullMessageIds: [],
        pushTopic: false,
        deleteMessages: [],
      })),
    };
  };
  const pushed = [];
  service.pushTopics = async (actions) => pushed.push(...actions.map(action => action.topicId));

  await service.syncTopicsAndMessages({});

  assert.equal(manifests.length, 2);
  assert.deepEqual(manifests[0].items.map(item => item.topicId), ["topic-1"]);
  assert.deepEqual(manifests[1].items.map(item => item.topicId), ["topic-1", "topic-2"]);
  assert.deepEqual(pushed, ["topic-2"]);
  assert.deepEqual(messageDiff.topics.map(item => item.topicId).sort(), ["topic-1", "topic-2"]);
});

test("message diff topic errors fail the desktop sync instead of being skipped", async () => {
  const service = createService();
  const topic = topicFixture();
  service.buildTopicState = async () => [topic];
  service.listConfigs = async () => [{ id: "agent-1", type: "agent" }];
  service.wsRequest = async (_socket, payload) => payload.type === "SYNC_MANIFEST_REQUEST"
    ? { results: [] }
    : {
      results: [{
          topicId: "topic-1",
          ownerType: "agent",
          ownerId: "agent-1",
          ok: false,
          error: { code: "TOPIC_NOT_FOUND", message: "topic missing" },
      }],
    };

  await assert.rejects(
    service.syncTopicsAndMessages({}),
    /消息差异同步失败.*topic missing/,
  );
});

test("corrupt history aborts sync instead of being advertised as empty", async (t) => {
  const appDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "vcpchat-corrupt-history-"));
  t.after(() => fs.remove(appDataPath));
  const agentId = "agent-1";
  const topicId = "topic-broken";
  await fs.outputJson(path.join(appDataPath, "Agents", agentId, "config.json"), {
    name: "Agent",
    topics: [{ id: topicId, name: "Broken", createdAt: 1 }],
  });
  await fs.outputFile(
    path.join(appDataPath, "UserData", agentId, "topics", topicId, "history.json"),
    '[{"id":"cut-off"',
  );
  const service = new DesktopSyncService({
    appDataPath,
    logger: { error() {}, warn() {} },
  });

  await assert.rejects(
    service.buildTopicState(),
    /聊天历史损坏或不可读.*topic-broken/,
  );
});

test("pending owner tombstones are confirmed before config manifest", async (t) => {
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
  const frames = [];
  service.wsSend = async (_ws, payload) => frames.push(payload);
  service.confirmPriorFrames = async (_ws, phase) => frames.push({ barrier: phase });
  service.wsRequest = async (_ws, payload) => {
    frames.push(payload);
    return { results: [] };
  };
  service.listConfigs = async () => [];

  await service.flushOwnerTombstones({});
  await service.syncFullConfigs({});

  assert.deepEqual(frames[0], {
    type: "SYNC_ENTITY_DELETE",
    targetType: "owner",
    ownerType: "group",
    ownerId: "group-deleted",
    deletedAt: 1700000000000,
  });
  assert.deepEqual(frames[1], { barrier: "owner_metadata" });
  assert.equal(frames[2].type, "SYNC_MANIFEST_REQUEST");
  assert.deepEqual(await listOwnerDeletions(userDataDir), []);
});

test("pending message tombstones require a processed-frame barrier", async (t) => {
  const appDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "vcpchat-desktop-sync-"));
  t.after(() => fs.remove(appDataPath));
  const userDataDir = path.join(appDataPath, "UserData");
  const service = new DesktopSyncService({
    appDataPath,
    logger: { error() {}, warn() {} },
  });
  const [tombstone] = await recordMessageDeletions(userDataDir, [{
    ownerType: "agent",
    ownerId: "agent-1",
    topicId: "topic-1",
    msgId: "message-deleted",
    deletedAt: 1700000000010,
  }]);
  const frames = [];
  service.wsSend = async (_ws, payload) => frames.push(payload);
  service.confirmPriorFrames = async (_ws, phase) => frames.push({ barrier: phase });

  assert.deepEqual(
    await service.flushMessageTombstones({}),
    ["topic-1:message-deleted"],
  );
  assert.deepEqual(frames, [{
    type: "SYNC_ENTITY_DELETE",
    targetType: "message",
    ownerType: "agent",
    ownerId: "agent-1",
    topicId: "topic-1",
    msgId: "message-deleted",
    deletedAt: tombstone.deletedAt,
  }, { barrier: "topic_metadata" }]);
  assert.deepEqual(await listMessageDeletions(userDataDir), []);

  await recordMessageDeletions(userDataDir, [tombstone]);
  service.confirmPriorFrames = async () => { throw new Error("offline"); };
  await assert.rejects(
    service.flushMessageTombstones({}),
    /offline/,
  );
  assert.deepEqual(await listMessageDeletions(userDataDir), [tombstone]);
});

test("server message tombstones remove local rows without queuing a local delete", async (t) => {
  const appDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "vcpchat-desktop-sync-"));
  t.after(() => fs.remove(appDataPath));
  const userDataDir = path.join(appDataPath, "UserData");
  const historyPath = path.join(
    userDataDir,
    "agent-1",
    "topics",
    "topic-1",
    "history.json",
  );
  await fs.outputJson(historyPath, [
    { id: "message-deleted", content: "remove me" },
    { id: "message-kept", content: "keep me" },
  ]);
  const service = new DesktopSyncService({
    appDataPath,
    logger: { error() {}, warn() {} },
  });

  const deleted = await service.applyRemoteMessageDeletions(
    new Map([["agent\0agent-1\0topic-1", {
        topicId: "topic-1",
        ownerType: "agent",
        ownerId: "agent-1",
        ok: true,
        pullMessageIds: [],
        pushTopic: false,
        deleteMessages: [{ msgId: "message-deleted", deletedAt: 1 }],
    }]]),
    [{ ...topicFixture(), historyPath }],
  );

  assert.deepEqual(deleted, ["topic-1:message-deleted"]);
  assert.deepEqual(
    await fs.readJson(historyPath),
    [{ id: "message-kept", content: "keep me" }],
  );
  assert.deepEqual(await listMessageDeletions(userDataDir), []);
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
  service.listConfigs = async () => [];
  service.wsRequest = async () => ({
    results: [{ ownerId: groupId, ownerType: "group", action: "PULL_DELETE", deletedAt: 1 }],
  });

  const result = await service.syncFullConfigs({});

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
  service.wsSend = async () => {
    throw new Error("offline");
  };

  await assert.rejects(service.flushTopicTombstones({}), /offline/);
  assert.deepEqual(await listTopicDeletions(userDataDir), [{
    id: "topic-retry",
    ownerId: "group-1",
    ownerType: "group",
    deletedAt: 1700000000001,
  }]);
});

test("server PULL_DELETE removes the local topic config and history", async (t) => {
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
    topicId: "topic-deleted",
    action: "PULL_DELETE",
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
    new Map([["agent\0agent-1\0topic-1", {
      pullMessageIds: ["message-1"],
    }]]),
    [topic],
  );
  assert.deepEqual(calls[0], {
    pathname: "/messages/pull",
    options: {
      method: "POST",
      body: {
        topics: [{
          topicId: "topic-1",
          ownerType: "agent",
          ownerId: "agent-1",
          messageIds: ["message-1"],
        }],
      },
    },
  });

  await service.pushMessages(new Map([["agent\0agent-1\0topic-1", {
    pushTopic: true,
  }]]), [topic]);
  const pushedFrame = JSON.parse(calls[1].options.body.trim());
  assert.equal(pushedFrame.ownerType, "agent");
  assert.equal(pushedFrame.ownerId, "agent-1");

  service.buildAvatarManifest = async () => [{
    id: "agent:agent-1",
    type: "agent",
    ownerId: "agent-1",
    hash: "d".repeat(64),
    ts: 456,
  }];
  let avatarFrame;
  service.wsRequest = async (_socket, payload) => {
    avatarFrame = payload;
    return { results: [] };
  };
  await service.syncAvatars({});
  assert.equal(avatarFrame.type, "SYNC_MANIFEST_REQUEST");
  assert.equal(avatarFrame.manifestType, "avatar");
  assert.deepEqual(avatarFrame.items[0], {
    ownerType: "agent",
    ownerId: "agent-1",
    binaryHash: "d".repeat(64),
    updatedAt: 456,
  });
});

test("missing remote attachment becomes a placeholder without failing message sync", async (t) => {
  const appDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "vcpchat-desktop-sync-"));
  t.after(() => fs.remove(appDataPath));

  const service = new DesktopSyncService({
    appDataPath,
    logger: { error() {}, warn() {} },
  });
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

test("Wire 1.4 remote attachments do not call removed binary endpoints", async (t) => {
  const appDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "vcpchat-desktop-sync-"));
  t.after(() => fs.remove(appDataPath));
  const service = new DesktopSyncService({
    appDataPath,
    logger: { error() {}, warn() {} },
  });
  service.api = async () => { throw new Error("attachment endpoint must not be called"); };

  const message = await service.normalizeRemoteMessage({
    id: "message-with-server-error",
    attachments: [{ hash: "e".repeat(64), name: "broken.txt", type: "text/plain" }],
  });
  assert.equal(message.attachments[0].status, "missing");
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

  const result = await service.pushMessages(new Map([["agent\0agent-1\0topic-1", {
    pushTopic: true,
  }]]), [topic]);

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
    assert.equal(pathname, "/messages/push");
    pushedFrame = JSON.parse(options.body.trim());
    return {
      text: async () => JSON.stringify({
        kind: "topic",
        topicId: "topic-1",
        ownerType: "agent",
        ownerId: "agent-1",
        ok: true,
      }),
    };
  };

  await service.pushMessages(new Map([["agent\0agent-1\0topic-1", {
    pushTopic: true,
  }]]), [topic]);

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
      kind: "topic",
      topicId: "topic-1",
      ownerType: "agent",
      ownerId: "agent-1",
      ok: true,
      messages: [{
        id: "assistant-1",
        role: "assistant",
        content: "",
        contentHash: "a".repeat(64),
        timestamp: 20,
      }],
    }),
  });
  const result = { pullMessageIds: ["assistant-1"], pushTopic: false };
  const results = new Map([["agent\0agent-1\0topic-1", result]]);
  const topic = {
    ...topicFixture(),
    historyPath,
    messages: [],
  };

  await service.pullMessages(results, [topic]);

  assert.deepEqual(await fs.readJson(historyPath), [localMessage]);
  assert.equal(result.pushTopic, true);
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
  service.wsRequest = async (_ws, payload) => payload.type === "SYNC_MANIFEST_REQUEST"
    ? { results: [] }
    : { results: [{
      topicId: "topic-1",
      ownerType: "agent",
      ownerId: "agent-1",
      ok: true,
      pullMessageIds: ["remote-1"],
      pushTopic: true,
      deleteMessages: [],
    }] };
  service.api = async () => ({
    text: async () => JSON.stringify({
      kind: "topic",
      topicId: "topic-1",
      ownerType: "agent",
      ownerId: "agent-1",
      ok: true,
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
    pluginVersion: "1.4.0",
    protocolVersion: "1.4",
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
    pluginVersion: "1.4.0",
    protocolVersion: "1.4",
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
