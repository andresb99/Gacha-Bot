const test = require("node:test");
const assert = require("node:assert/strict");
const { ChannelType } = require("discord.js");

const { startMaintenanceJobs } = require("../src/bot/scheduler");

function createFakeResponse() {
  return {
    createMessageComponentCollector() {
      return {
        on() {
          return undefined;
        },
      };
    },
    async edit() {
      return undefined;
    },
  };
}

function createGuildWithChannel(channel) {
  return {
    name: "TestGuild",
    channels: {
      cache: {
        find(predicate) {
          return predicate(channel) ? channel : null;
        },
      },
    },
  };
}

test("scheduler publica board automaticamente en #gacha-bot al detectar cambio", async (t) => {
  const sentPayloads = [];
  const targetChannel = {
    name: "gacha-bot",
    type: ChannelType.GuildText,
    async send(payload) {
      sentPayloads.push(payload);
      return createFakeResponse();
    },
  };
  const client = {
    guilds: {
      cache: new Map([["1", createGuildWithChannel(targetChannel)]]),
    },
  };

  const engine = {
    gachaState: { boardUpdatedAt: "2026-02-17T00:00:00.000Z" },
    ensureBoardCalls: 0,
    ensureMythicCalls: 0,
    async ensureBoard() {
      this.ensureBoardCalls += 1;
      this.gachaState.boardUpdatedAt = "2026-02-17T00:01:00.000Z";
    },
    async ensureMythicCatalog() {
      this.ensureMythicCalls += 1;
    },
    getBoardCharacters() {
      return [
        {
          id: "m1",
          name: "Mythic",
          anime: "Test",
          imageUrl: "https://example.com/m1.jpg",
          imageUrls: ["https://example.com/m1.jpg"],
          favorites: 1000,
          popularityRank: 1,
          rarity: "mythic",
          dropWeight: 0.5,
          source: "anilist",
          sources: ["anilist"],
          sourceIds: { anilist: "m1" },
        },
      ];
    },
    getBoardDate() {
      return "17/02/2026, 00:01";
    },
  };

  const originalSetInterval = global.setInterval;
  global.setInterval = () => ({ unref() {} });
  t.after(() => {
    global.setInterval = originalSetInterval;
  });

  startMaintenanceJobs(engine, 1, { client, channelName: "gacha-bot" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(engine.ensureBoardCalls, 1);
  assert.equal(engine.ensureMythicCalls, 1);
  assert.equal(sentPayloads.length, 1);
  assert.ok(sentPayloads[0].embeds);
});

test("scheduler no publica cuando boardUpdatedAt no cambia", async (t) => {
  const sentPayloads = [];
  const targetChannel = {
    name: "gacha-bot",
    type: ChannelType.GuildText,
    async send(payload) {
      sentPayloads.push(payload);
      return createFakeResponse();
    },
  };
  const client = {
    guilds: {
      cache: new Map([["1", createGuildWithChannel(targetChannel)]]),
    },
  };

  const engine = {
    gachaState: { boardUpdatedAt: "2026-02-17T00:00:00.000Z" },
    async ensureBoard() {},
    async ensureMythicCatalog() {},
    getBoardCharacters() {
      return [];
    },
    getBoardDate() {
      return "17/02/2026, 00:00";
    },
  };

  const originalSetInterval = global.setInterval;
  global.setInterval = () => ({ unref() {} });
  t.after(() => {
    global.setInterval = originalSetInterval;
  });

  startMaintenanceJobs(engine, 1, { client, channelName: "gacha-bot" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(sentPayloads.length, 0);
});
