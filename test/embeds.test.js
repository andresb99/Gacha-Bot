const test = require("node:test");
const assert = require("node:assert/strict");

const { buildRollEmbed, buildProfileEmbed } = require("../src/presentation/embeds");

function createCharacter() {
  return {
    id: "m1",
    name: "Violet Evergarden",
    anime: "Violet Evergarden",
    rarity: "mythic",
    popularityRank: 25,
    imageUrl: "https://example.com/violet.jpg",
  };
}

test("buildRollEmbed muestra soft pity cuando aplica bonus", () => {
  const embed = buildRollEmbed(createCharacter(), "tester", 5, {
    pityCounter: 120,
    pitySoftThreshold: 100,
    pityThreshold: 200,
    pitySoftBonusPercent: 0.5,
  });

  const description = String(embed?.data?.description || "");
  assert.match(description, /Pity mitica:/);
  assert.match(description, /soft \+0\.50%/);
  assert.match(description, /soft 100/);
});

test("buildRollEmbed muestra hard pity cuando se activa", () => {
  const embed = buildRollEmbed(createCharacter(), "tester", 5, {
    pityCounter: 0,
    pitySoftThreshold: 100,
    pityThreshold: 200,
    pityHardTriggered: true,
  });

  const description = String(embed?.data?.description || "");
  assert.match(description, /hard activado/);
});

test("buildProfileEmbed muestra thresholds de pity mitica", () => {
  const profileEmbed = buildProfileEmbed(
    {
      rollsLeft: 8,
      totalRolls: 100,
      uniqueCount: 10,
      totalCopies: 50,
      lastReset: "2026-02-17",
      mythicPityCounter: 33,
      mythicPitySoftThreshold: 700,
      mythicPityHardThreshold: 1000,
    },
    "tester"
  );

  const fields = Array.isArray(profileEmbed?.data?.fields) ? profileEmbed.data.fields : [];
  const pityField = fields.find((field) => field.name === "Pity mitica");
  assert.ok(pityField);
  assert.equal(pityField.value, "33/1000 (soft 700)");
});
