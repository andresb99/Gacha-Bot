const test = require("node:test");
const assert = require("node:assert/strict");

const { GachaEngine } = require("../src/gacha/engine");
const { InMemoryStore } = require("../testUtils/inMemoryStore");

function createConfig(overrides = {}) {
  return {
    timezone: "UTC",
    rollsPerDay: 20,
    dailyRollBonus: 5,
    dailyCooldownMinutes: 60,
    boardSize: 50,
    boardRefreshMinutes: 60,
    boardPrefetchMinutes: 5,
    mythicCatalogRefreshMinutes: 1440,
    poolSize: 500,
    mythicSoftPityRolls: 3,
    mythicHardPityRolls: 5,
    mythicSoftPityRateStepPercent: 0.5,
    featuredBoardBoostPercent: 40,
    pityRolls: 80,
    contractCommonCost: 100,
    contractRareCost: 50,
    contractEpicCost: 20,
    contractLegendaryCost: 5,
    contractMaxPerCommand: 10,
    ...overrides,
  };
}

function createCharacter(id, rarity, dropWeight) {
  return {
    id,
    name: `${rarity}_${id}`,
    anime: "Test Anime",
    imageUrl: "https://example.com/test.jpg",
    imageUrls: ["https://example.com/test.jpg"],
    favorites: 100,
    popularityRank: rarity === "mythic" ? 1 : 1000,
    rarity,
    dropWeight,
    source: "anilist",
    sources: ["anilist"],
    sourceIds: { anilist: id },
  };
}

function createBoardState(boardCharacters) {
  return {
    boardCharacters,
    boardCharacterIds: boardCharacters.map((character) => character.id),
    boardUpdatedAt: new Date().toISOString(),
    poolUpdatedAt: null,
    mythicCharacters: [],
    mythicCatalogUpdatedAt: null,
  };
}

test("rollMany aplica hard pity mitica y garantiza resultado mythic", async () => {
  const mythic = createCharacter("m1", "mythic", 0.5);
  const rare = createCharacter("r1", "rare", 27);
  const store = new InMemoryStore({
    gachaState: createBoardState([mythic, rare]),
    users: {
      user1: {
        username: "u1",
        displayName: "U1",
        lastReset: "2026-02-17",
        rollsLeft: 1,
        totalRolls: 10,
        pityCounter: 4,
        mythicPityCounter: 4,
        inventory: {},
        lastRollAt: null,
        lastDailyClaimAt: null,
      },
    },
  });
  const engine = new GachaEngine(store, createConfig());
  engine.gachaState = createBoardState([mythic, rare]);

  const result = await engine.rollMany("user1", 1, { username: "u1", displayName: "U1" });

  assert.equal(result.error, undefined);
  assert.equal(result.executed, 1);
  assert.equal(result.results[0].character.rarity, "mythic");
  assert.equal(result.mythicHardPityTriggeredCount, 1);
  assert.equal(result.pityCounter, 0);

  const savedUser = await store.getUser("user1");
  assert.equal(savedUser.mythicPityCounter, 0);
  assert.equal(savedUser.pityCounter, 0);
});

test("rollMany marca soft pity activo antes del hard pity", async () => {
  const mythic = createCharacter("m1", "mythic", 0.5);
  const rare = createCharacter("r1", "rare", 27);
  const store = new InMemoryStore({
    gachaState: createBoardState([mythic, rare]),
    users: {
      user2: {
        username: "u2",
        displayName: "U2",
        lastReset: "2026-02-17",
        rollsLeft: 1,
        totalRolls: 0,
        pityCounter: 2,
        mythicPityCounter: 2,
        inventory: {},
        lastRollAt: null,
        lastDailyClaimAt: null,
      },
    },
  });
  const engine = new GachaEngine(store, createConfig());
  engine.gachaState = createBoardState([mythic, rare]);

  const result = await engine.rollMany("user2", 1, { username: "u2", displayName: "U2" });

  assert.equal(result.error, undefined);
  assert.equal(result.mythicHardPityTriggeredCount, 0);
  assert.equal(result.mythicSoftPityActiveCount, 1);
  assert.ok(result.results[0].softPityBonusPercent > 0);
  assert.ok(result.pityCounter >= 0 && result.pityCounter <= 4);
});

test("syncUser migra pity legacy a mythicPityCounter", async () => {
  const store = new InMemoryStore({
    gachaState: createBoardState([createCharacter("r1", "rare", 27)]),
    users: {
      legacy: {
        username: "legacyUser",
        displayName: "Legacy",
        lastReset: "2026-02-17",
        rollsLeft: 5,
        totalRolls: 100,
        pityCounter: 7,
        inventory: {},
        lastRollAt: null,
        lastDailyClaimAt: null,
      },
    },
  });
  const engine = new GachaEngine(store, createConfig({ mythicHardPityRolls: 10 }));
  engine.gachaState = createBoardState([createCharacter("r1", "rare", 27)]);

  const { user, changed } = await engine.syncUser("legacy", {
    username: "legacyUser",
    displayName: "Legacy",
  });

  assert.equal(changed, true);
  assert.equal(user.mythicPityCounter, 7);
  assert.equal(user.pityCounter, 7);
});

test("getProfile expone thresholds de pity mitica", async () => {
  const store = new InMemoryStore({
    gachaState: createBoardState([createCharacter("r1", "rare", 27)]),
    users: {
      profileUser: {
        username: "profile",
        displayName: "Profile",
        lastReset: "2026-02-17",
        rollsLeft: 8,
        totalRolls: 30,
        pityCounter: 2,
        mythicPityCounter: 2,
        inventory: {},
        lastRollAt: null,
        lastDailyClaimAt: null,
      },
    },
  });
  const engine = new GachaEngine(
    store,
    createConfig({ mythicSoftPityRolls: 11, mythicHardPityRolls: 22 })
  );
  engine.gachaState = createBoardState([createCharacter("r1", "rare", 27)]);

  const profile = await engine.getProfile("profileUser", {
    username: "profile",
    displayName: "Profile",
  });

  assert.equal(profile.mythicPityCounter, 2);
  assert.equal(profile.mythicPitySoftThreshold, 11);
  assert.equal(profile.mythicPityHardThreshold, 22);
  assert.equal(profile.pityCounter, 2);
  assert.equal(profile.pityThreshold, 22);
});
