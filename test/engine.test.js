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

function createCharacter(id, rarity, dropWeight, overrides = {}) {
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
    ...overrides,
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
    tradeOffers: [],
  };
}

function createInventoryEntry(character, count = 1) {
  return {
    count,
    character: {
      ...character,
      imageUrls: Array.isArray(character.imageUrls) ? character.imageUrls : [character.imageUrl],
      sources: Array.isArray(character.sources) ? character.sources : ["anilist"],
      sourceIds: character.sourceIds || { anilist: character.id },
    },
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

test("createTradeOffer + acceptTradeOffer intercambian unidades entre usuarios", async () => {
  const shigeo = createCharacter("mob_shigeo", "mythic", 0.5, {
    name: "Shigeo Kageyama",
    anime: "Mob Psycho 100",
    popularityRank: 42,
  });
  const light = createCharacter("dn_light", "legendary", 2.5, {
    name: "Light Yagami",
    anime: "Death Note",
    popularityRank: 88,
  });
  const store = new InMemoryStore({
    gachaState: createBoardState([shigeo, light]),
    users: {
      alice: {
        username: "alice",
        displayName: "Alice",
        lastReset: "2026-02-17",
        rollsLeft: 8,
        totalRolls: 12,
        pityCounter: 0,
        mythicPityCounter: 0,
        inventory: {
          [shigeo.id]: createInventoryEntry(shigeo, 1),
        },
        lastRollAt: null,
        lastDailyClaimAt: null,
      },
      bob: {
        username: "bob",
        displayName: "Bob",
        lastReset: "2026-02-17",
        rollsLeft: 8,
        totalRolls: 7,
        pityCounter: 0,
        mythicPityCounter: 0,
        inventory: {
          [light.id]: createInventoryEntry(light, 1),
        },
        lastRollAt: null,
        lastDailyClaimAt: null,
      },
    },
  });
  const engine = new GachaEngine(store, createConfig());
  engine.gachaState = createBoardState([shigeo, light]);

  const created = await engine.createTradeOffer({
    proposerId: "alice",
    targetId: "bob",
    offeredQuery: "Shigeo Kageyama de Mob Psycho",
    requestedQuery: "Light Yagami de Death Note",
    proposerMeta: { username: "alice", displayName: "Alice" },
    targetMeta: { username: "bob", displayName: "Bob" },
  });
  assert.equal(created.error, undefined);
  assert.ok(created.offer?.id);

  const accepted = await engine.acceptTradeOffer(created.offer.id, "bob", {
    username: "bob",
    displayName: "Bob",
  });
  assert.equal(accepted.error, undefined);
  assert.equal(accepted.offer.status, "accepted");

  const aliceAfter = await store.getUser("alice");
  const bobAfter = await store.getUser("bob");
  assert.equal(aliceAfter.inventory?.[light.id]?.count, 1);
  assert.equal(aliceAfter.inventory?.[shigeo.id], undefined);
  assert.equal(bobAfter.inventory?.[shigeo.id]?.count, 1);
  assert.equal(bobAfter.inventory?.[light.id], undefined);
});

test("acceptTradeOffer falla si el oferente ya no tiene la unidad", async () => {
  const shigeo = createCharacter("mob_shigeo", "mythic", 0.5, {
    name: "Shigeo Kageyama",
    anime: "Mob Psycho 100",
  });
  const light = createCharacter("dn_light", "legendary", 2.5, {
    name: "Light Yagami",
    anime: "Death Note",
  });
  const store = new InMemoryStore({
    gachaState: createBoardState([shigeo, light]),
    users: {
      alice: {
        username: "alice",
        displayName: "Alice",
        lastReset: "2026-02-17",
        rollsLeft: 8,
        totalRolls: 12,
        pityCounter: 0,
        mythicPityCounter: 0,
        inventory: {
          [shigeo.id]: createInventoryEntry(shigeo, 1),
        },
        lastRollAt: null,
        lastDailyClaimAt: null,
      },
      bob: {
        username: "bob",
        displayName: "Bob",
        lastReset: "2026-02-17",
        rollsLeft: 8,
        totalRolls: 7,
        pityCounter: 0,
        mythicPityCounter: 0,
        inventory: {
          [light.id]: createInventoryEntry(light, 1),
        },
        lastRollAt: null,
        lastDailyClaimAt: null,
      },
    },
  });
  const engine = new GachaEngine(store, createConfig());
  engine.gachaState = createBoardState([shigeo, light]);

  const created = await engine.createTradeOffer({
    proposerId: "alice",
    targetId: "bob",
    offeredQuery: shigeo.id,
    requestedQuery: light.id,
    proposerMeta: { username: "alice", displayName: "Alice" },
    targetMeta: { username: "bob", displayName: "Bob" },
  });
  assert.equal(created.error, undefined);
  assert.ok(created.offer?.id);

  const proposerUser = await store.getUser("alice");
  proposerUser.inventory = {};
  await store.saveUser("alice", proposerUser);

  const accepted = await engine.acceptTradeOffer(created.offer.id, "bob", {
    username: "bob",
    displayName: "Bob",
  });
  assert.match(String(accepted.error || ""), /ya no tiene/i);

  const stateAfter = await store.getGachaState();
  const tradeAfter = (stateAfter.tradeOffers || []).find((entry) => entry.id === created.offer.id);
  assert.equal(tradeAfter.status, "pending");
});

test("listTradeOffersForUser separa pendientes y resueltos", async () => {
  const shigeo = createCharacter("mob_shigeo", "mythic", 0.5, {
    name: "Shigeo Kageyama",
    anime: "Mob Psycho 100",
  });
  const light = createCharacter("dn_light", "legendary", 2.5, {
    name: "Light Yagami",
    anime: "Death Note",
  });
  const store = new InMemoryStore({
    gachaState: createBoardState([shigeo, light]),
    users: {
      alice: {
        username: "alice",
        displayName: "Alice",
        lastReset: "2026-02-17",
        rollsLeft: 8,
        totalRolls: 12,
        pityCounter: 0,
        mythicPityCounter: 0,
        inventory: {
          [shigeo.id]: createInventoryEntry(shigeo, 1),
        },
        lastRollAt: null,
        lastDailyClaimAt: null,
      },
      bob: {
        username: "bob",
        displayName: "Bob",
        lastReset: "2026-02-17",
        rollsLeft: 8,
        totalRolls: 7,
        pityCounter: 0,
        mythicPityCounter: 0,
        inventory: {
          [light.id]: createInventoryEntry(light, 1),
        },
        lastRollAt: null,
        lastDailyClaimAt: null,
      },
    },
  });
  const engine = new GachaEngine(store, createConfig());
  engine.gachaState = createBoardState([shigeo, light]);

  const created = await engine.createTradeOffer({
    proposerId: "alice",
    targetId: "bob",
    offeredQuery: shigeo.id,
    requestedQuery: light.id,
    proposerMeta: { username: "alice", displayName: "Alice" },
    targetMeta: { username: "bob", displayName: "Bob" },
  });
  assert.equal(created.error, undefined);

  const bobPending = await engine.listTradeOffersForUser("bob", { username: "bob", displayName: "Bob" });
  assert.equal(bobPending.incomingPending.length, 1);
  assert.equal(bobPending.outgoingPending.length, 0);
  assert.equal(bobPending.recentResolved.length, 0);

  const rejected = await engine.rejectTradeOffer(created.offer.id, "bob", {
    username: "bob",
    displayName: "Bob",
  });
  assert.equal(rejected.error, undefined);
  assert.equal(rejected.offer.status, "rejected");

  const bobAfter = await engine.listTradeOffersForUser("bob", { username: "bob", displayName: "Bob" });
  assert.equal(bobAfter.incomingPending.length, 0);
  assert.equal(bobAfter.recentResolved.length, 1);
  assert.equal(bobAfter.recentResolved[0].id, created.offer.id);
  assert.equal(bobAfter.recentResolved[0].status, "rejected");
});
