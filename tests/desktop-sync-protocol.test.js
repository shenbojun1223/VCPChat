"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const { DesktopSyncService } = require("../modules/services/desktopSync");

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
