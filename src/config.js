const path = require("path");
require("dotenv").config();

function parseIntInRange(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseFloatInRange(value, fallback, min, max) {
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

module.exports = {
  token: process.env.DISCORD_TOKEN || "",
  prefix: process.env.PREFIX || "!",
  rollsPerDay: parseIntInRange(process.env.ROLLS_PER_DAY, 8, 1, 50),
  dailyRollBonus: parseIntInRange(process.env.DAILY_ROLL_BONUS, 5, 1, 100),
  dailyCooldownMinutes: parseIntInRange(process.env.DAILY_COOLDOWN_MINUTES, 10, 1, 1440),
  boardSize: parseIntInRange(process.env.BOARD_SIZE, 50, 10, 100),
  boardRefreshMinutes: parseIntInRange(
    process.env.BOARD_REFRESH_MINUTES,
    parseIntInRange(process.env.BOARD_REFRESH_HOURS, 1, 1, 24) * 60,
    1,
    1440
  ),
  boardPrefetchMinutes: parseIntInRange(process.env.BOARD_PREFETCH_MINUTES, 5, 1, 60),
  mythicCatalogRefreshMinutes: parseIntInRange(
    process.env.MYTHIC_CATALOG_REFRESH_MINUTES,
    1440,
    10,
    10080
  ),
  poolSize: parseIntInRange(process.env.POOL_SIZE, 10000, 100, 10000),
  mythicSoftPityRolls: parseIntInRange(process.env.MYTHIC_SOFT_PITY_ROLLS, 700, 1, 10000),
  mythicHardPityRolls: parseIntInRange(process.env.MYTHIC_HARD_PITY_ROLLS, 1000, 1, 10000),
  mythicSoftPityRateStepPercent: parseFloatInRange(
    process.env.MYTHIC_SOFT_PITY_RATE_STEP_PERCENT,
    0.05,
    0,
    10
  ),
  featuredBoardBoostPercent: parseFloatInRange(process.env.FEATURED_BOARD_BOOST_PERCENT, 40, 0, 300),
  pityRolls: parseIntInRange(process.env.PITY_ROLLS, 80, 1, 500),
  contractCommonCost: parseIntInRange(process.env.CONTRACT_COMMON_COST, 100, 1, 10000),
  contractRareCost: parseIntInRange(process.env.CONTRACT_RARE_COST, 50, 1, 10000),
  contractEpicCost: parseIntInRange(process.env.CONTRACT_EPIC_COST, 20, 1, 10000),
  contractLegendaryCost: parseIntInRange(process.env.CONTRACT_LEGENDARY_COST, 5, 1, 10000),
  contractMaxPerCommand: parseIntInRange(process.env.CONTRACT_MAX_PER_COMMAND, 10, 1, 50),
  gachaAdminUserId: String(process.env.GACHA_ADMIN_USER_ID || "").trim(),
  timezone: process.env.BOT_TIMEZONE || "UTC",
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID || "",
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL || "",
    privateKey: process.env.FIREBASE_PRIVATE_KEY || "",
    databaseURL: process.env.FIREBASE_DATABASE_URL || "",
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "",
    serviceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH
      ? path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT_PATH)
      : "",
  },
};
