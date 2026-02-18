const { todayKey } = require("../utils/date");
const {
  fetchCharacterPool,
  fetchTopRankedCharacters,
  searchCharactersByQuery,
  fetchCharacterGallery,
} = require("../services/characterCatalog");

const RARITY_ORDER = ["mythic", "legendary", "epic", "rare", "common"];
const RARITY_LABELS = {
  common: "Comun",
  rare: "Raro",
  epic: "Epico",
  legendary: "Legendario",
  mythic: "Mitico",
};

const RARITY_MARKERS = {
  common: "[C]",
  rare: "[R]",
  epic: "[E]",
  legendary: "[L]",
  mythic: "[M]",
};

const RARITY_COLORS = {
  common: 0x95a5a6,
  rare: 0x2ecc71,
  epic: 0x3498db,
  legendary: 0xf1c40f,
  mythic: 0xe74c3c,
};

const RARITY_BASE_WEIGHTS = {
  common: 60,
  rare: 27,
  epic: 10,
  legendary: 2.5,
  mythic: 0.5,
};

const POPULARITY_RANK_THRESHOLDS = {
  mythic: 200,
  legendary: 1000,
  epic: 2500,
  rare: 6000,
};

const FAVORITES_THRESHOLDS = {
  mythic: 75000,
  legendary: 25000,
  epic: 7000,
  rare: 1500,
};

const CONTRACT_RARITY_CHAIN = ["common", "rare", "epic", "legendary", "mythic"];
const CONTRACT_SOURCE_RARITIES = CONTRACT_RARITY_CHAIN.slice(0, -1);
const MYTHIC_CATALOG_LIMIT = 250;
const FEATURED_RARITIES = ["epic", "legendary", "mythic"];
const TRADE_PENDING_STATUS = "pending";
const TRADE_RESOLVED_STATUSES = new Set(["accepted", "rejected", "cancelled", "expired"]);
const TRADE_VALID_STATUSES = new Set([TRADE_PENDING_STATUS, ...TRADE_RESOLVED_STATUSES]);
const TRADE_DEFAULT_EXPIRY_MINUTES = 120;
const TRADE_MAX_RESOLVED_HISTORY = 200;
const TRADE_MAX_PENDING_PER_USER = 15;

const DEFAULT_GACHA_STATE = {
  boardCharacters: [],
  boardCharacterIds: [],
  boardUpdatedAt: null,
  poolUpdatedAt: null,
  mythicCharacters: [],
  mythicCatalogUpdatedAt: null,
  tradeOffers: [],
};

function shuffle(items) {
  const array = [...items];
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function weightedPick(items, getWeight) {
  const total = items.reduce((sum, item) => sum + Math.max(0, getWeight(item)), 0);
  if (total <= 0) return items[Math.floor(Math.random() * items.length)];

  let threshold = Math.random() * total;
  for (const item of items) {
    threshold -= Math.max(0, getWeight(item));
    if (threshold <= 0) return item;
  }
  return items[items.length - 1];
}

function buildSoftPityBonusPercent(counter, softThreshold, stepPercent) {
  const safeCounter = Math.max(0, Math.floor(Number(counter || 0)));
  const safeSoftThreshold = Math.max(1, Math.floor(Number(softThreshold || 1)));
  const safeStep = Math.max(0, Number(stepPercent || 0));
  const firstSoftCounter = safeSoftThreshold - 1;
  if (safeCounter < firstSoftCounter || safeStep <= 0) return 0;
  const steps = safeCounter - firstSoftCounter + 1;
  return steps * safeStep;
}

function chanceByPredicate(items, getWeight, predicate) {
  const safeItems = Array.isArray(items) ? items : [];
  if (!safeItems.length) return 0;
  let totalWeight = 0;
  let targetWeight = 0;
  for (const item of safeItems) {
    const weight = Math.max(0, Number(getWeight(item) || 0));
    totalWeight += weight;
    if (predicate(item)) targetWeight += weight;
  }
  if (totalWeight <= 0 || targetWeight <= 0) return 0;
  return targetWeight / totalWeight;
}

function applyChanceBoostToSubset(items, baseWeights, predicate, additionalChancePercent) {
  const safeItems = Array.isArray(items) ? items : [];
  const safeBonus = Math.max(0, Number(additionalChancePercent || 0)) / 100;
  if (!safeItems.length || safeBonus <= 0) return baseWeights;

  const currentChance = chanceByPredicate(safeItems, (item) => baseWeights.get(item) || 0, predicate);
  if (currentChance <= 0) return baseWeights;

  const targetChance = Math.min(0.99, currentChance + safeBonus);
  if (targetChance <= currentChance) return baseWeights;

  const multiplier = targetChance / currentChance;
  for (const item of safeItems) {
    if (!predicate(item)) continue;
    const base = Math.max(0, Number(baseWeights.get(item) || 0));
    baseWeights.set(item, base * multiplier);
  }
  return baseWeights;
}

function applyFeaturedBoost(board, boostPercent) {
  const safeBoard = Array.isArray(board) ? board : [];
  if (!safeBoard.length) return [];

  const boostMultiplier = 1 + Math.max(0, Number(boostPercent || 0)) / 100;
  const result = safeBoard.map((character) => ({
    ...character,
    featured: false,
    featuredRarity: null,
  }));

  for (const rarity of FEATURED_RARITIES) {
    const candidates = [];
    for (let index = 0; index < result.length; index += 1) {
      if (String(result[index]?.rarity || "") === rarity) {
        candidates.push(index);
      }
    }
    if (!candidates.length) continue;

    const pickedIndex = candidates[Math.floor(Math.random() * candidates.length)];
    const picked = result[pickedIndex];
    const nextWeight = Math.max(0.05, Number((Number(picked?.dropWeight || 1) * boostMultiplier).toFixed(4)));
    result[pickedIndex] = {
      ...picked,
      dropWeight: nextWeight,
      featured: true,
      featuredRarity: rarity,
    };
  }

  return result;
}

function rarityFromPopularity(character) {
  const popularityRank = Math.max(0, Math.floor(Number(character?.popularityRank || 0)));
  const favorites = Math.max(0, Math.floor(Number(character?.favorites || 0)));

  if (popularityRank > 0) {
    if (popularityRank <= POPULARITY_RANK_THRESHOLDS.mythic) return "mythic";
    if (popularityRank <= POPULARITY_RANK_THRESHOLDS.legendary) return "legendary";
    if (popularityRank <= POPULARITY_RANK_THRESHOLDS.epic) return "epic";
    if (popularityRank <= POPULARITY_RANK_THRESHOLDS.rare) return "rare";
    return "common";
  }

  if (favorites >= FAVORITES_THRESHOLDS.mythic) return "mythic";
  if (favorites >= FAVORITES_THRESHOLDS.legendary) return "legendary";
  if (favorites >= FAVORITES_THRESHOLDS.epic) return "epic";
  if (favorites >= FAVORITES_THRESHOLDS.rare) return "rare";
  return "common";
}

function assignRarityAndWeight(characters) {
  const sorted = [...characters].sort((a, b) => {
    const rankA = Math.max(0, Number(a?.popularityRank || 0));
    const rankB = Math.max(0, Number(b?.popularityRank || 0));
    if (rankA > 0 && rankB > 0 && rankA !== rankB) return rankA - rankB;

    const favDiff = Number(b?.favorites || 0) - Number(a?.favorites || 0);
    if (favDiff !== 0) return favDiff;

    return String(a?.name || "").localeCompare(String(b?.name || ""));
  });

  return sorted.map((character) => {
    const rarity = rarityFromPopularity(character);
    const baseWeight = Number(RARITY_BASE_WEIGHTS[rarity] || 1);
    const dropWeight = Math.max(0.05, Number(baseWeight.toFixed(4)));

    return {
      ...character,
      rarity,
      dropWeight,
    };
  });
}

function createRarityPlan(size) {
  const boardSize = Math.max(0, Math.floor(Number(size || 0)));
  const mythicTarget = boardSize > 0 ? 1 : 0;
  const legendaryTarget =
    boardSize >= 30 ? 3 : boardSize >= 20 ? 2 : boardSize >= 10 ? 1 : 0;
  const counts = {
    common: 0,
    rare: 0,
    epic: 0,
    legendary: legendaryTarget,
    mythic: mythicTarget,
  };

  let remaining = Math.max(0, boardSize - counts.legendary - counts.mythic);
  counts.epic = Math.floor(remaining * 0.22);
  counts.rare = Math.floor(remaining * 0.3);
  counts.common = Math.max(0, remaining - counts.epic - counts.rare);

  if (boardSize >= 20 && counts.epic === 0 && counts.common > 0) {
    counts.epic = 1;
    counts.common -= 1;
  }

  if (boardSize >= 12 && counts.rare === 0 && counts.common > 0) {
    counts.rare = 1;
    counts.common -= 1;
  }

  remaining = boardSize - Object.values(counts).reduce((sum, value) => sum + value, 0);
  while (remaining > 0) {
    counts.common += 1;
    remaining -= 1;
  }

  return counts;
}

function pickUniqueByRarity(charactersByRarity, rarity, quantity, selectedIds) {
  if (quantity <= 0) return [];
  const candidates = (charactersByRarity[rarity] || []).filter(
    (character) => !selectedIds.has(String(character.id))
  );
  return shuffle(candidates).slice(0, quantity);
}

function generateBoard(characters, size) {
  const boardSize = Math.min(size, characters.length);
  const plan = createRarityPlan(boardSize);
  const mythicCap = Math.max(0, Number(plan.mythic || 0));
  const charactersByRarity = {
    common: [],
    rare: [],
    epic: [],
    legendary: [],
    mythic: [],
  };

  for (const character of characters) {
    charactersByRarity[character.rarity]?.push(character);
  }

  const board = [];
  const selectedIds = new Set();
  let mythicCount = 0;

  function tryAddCharacter(character) {
    if (!character) return false;
    const id = String(character.id);
    if (!id || selectedIds.has(id)) return false;

    const rarity = String(character.rarity || "");
    if (rarity === "mythic" && mythicCount >= mythicCap) return false;

    selectedIds.add(id);
    board.push(character);
    if (rarity === "mythic") mythicCount += 1;
    return true;
  }

  for (const rarity of [...RARITY_ORDER].reverse()) {
    const picks = pickUniqueByRarity(charactersByRarity, rarity, plan[rarity], selectedIds);
    for (const character of picks) {
      tryAddCharacter(character);
    }
  }

  if (board.length < boardSize) {
    const fillOrder = ["common", "rare", "epic", "legendary", "mythic"];
    for (const rarity of fillOrder) {
      if (board.length >= boardSize) break;
      const remainingByRarity = shuffle(charactersByRarity[rarity] || []).filter(
        (character) => !selectedIds.has(String(character.id))
      );
      for (const character of remainingByRarity) {
        if (board.length >= boardSize) break;
        tryAddCharacter(character);
      }
    }
  }

  if (board.length < boardSize) {
    const remaining = shuffle(characters).filter(
      (character) => !selectedIds.has(String(character.id))
    );
    for (const character of remaining) {
      if (board.length >= boardSize) break;
      tryAddCharacter(character);
    }
  }

  return board.sort(compareBoardCharacters);
}

function rarityScore(rarity) {
  return RARITY_ORDER.length - RARITY_ORDER.indexOf(rarity);
}

function rarityOrderIndex(rarity) {
  const index = RARITY_ORDER.indexOf(String(rarity || ""));
  return index >= 0 ? index : RARITY_ORDER.length;
}

function compareBoardCharacters(a, b) {
  const rarityDiff = rarityOrderIndex(a?.rarity) - rarityOrderIndex(b?.rarity);
  if (rarityDiff !== 0) return rarityDiff;

  const weightDiff = Number(a?.dropWeight || 0) - Number(b?.dropWeight || 0);
  if (weightDiff !== 0) return weightDiff;

  const favDiff = Number(b?.favorites || 0) - Number(a?.favorites || 0);
  if (favDiff !== 0) return favDiff;

  return String(a?.name || "").localeCompare(String(b?.name || ""));
}

function isMythic(rarity) {
  return rarity === "mythic";
}

function isValidDateString(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isTimestampOlderThan(isoDate, ageMs) {
  if (!isValidDateString(isoDate)) return true;
  const parsed = Date.parse(isoDate);
  if (Number.isNaN(parsed)) return true;
  return Date.now() - parsed >= Math.max(0, Number(ageMs || 0));
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function toUniqueUrls(urls) {
  const result = [];
  const seen = new Set();
  for (const input of urls || []) {
    const url = String(input || "").trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    result.push(url);
  }
  return result;
}

function cloneCharacterSnapshot(rawCharacter) {
  if (!rawCharacter || typeof rawCharacter !== "object") return null;
  const imageUrls = toUniqueUrls([rawCharacter.imageUrl, ...(rawCharacter.imageUrls || [])]);

  return {
    id: String(rawCharacter.id || ""),
    name: String(rawCharacter.name || "Personaje desconocido"),
    anime: String(rawCharacter.anime || "Anime desconocido"),
    imageUrl: imageUrls[0] || null,
    imageUrls,
    favorites: Number(rawCharacter.favorites || 0),
    popularityRank: Number(rawCharacter.popularityRank || 0),
    rarity: String(rawCharacter.rarity || "common"),
    dropWeight: Number(rawCharacter.dropWeight || 1),
    source: String(rawCharacter.source || "unknown"),
    sources: Array.isArray(rawCharacter.sources) ? rawCharacter.sources.filter(Boolean) : [],
    featured: Boolean(rawCharacter.featured),
    featuredRarity: rawCharacter.featuredRarity ? String(rawCharacter.featuredRarity) : null,
    sourceIds:
      rawCharacter.sourceIds && typeof rawCharacter.sourceIds === "object"
        ? rawCharacter.sourceIds
        : {},
  };
}

function mergeCharacterSnapshot(primary, fallback) {
  const first = cloneCharacterSnapshot(primary);
  const second = cloneCharacterSnapshot(fallback);
  const mergedImageUrls = toUniqueUrls([
    ...(first?.imageUrls || []),
    first?.imageUrl,
    ...(second?.imageUrls || []),
    second?.imageUrl,
  ]);

  return {
    id: first?.id || second?.id || "",
    name: first?.name || second?.name || "Personaje desconocido",
    anime: first?.anime || second?.anime || "Anime desconocido",
    imageUrl: mergedImageUrls[0] || null,
    imageUrls: mergedImageUrls,
    favorites: Math.max(first?.favorites || 0, second?.favorites || 0),
    popularityRank: Math.max(first?.popularityRank || 0, second?.popularityRank || 0),
    rarity: first?.rarity || second?.rarity || "common",
    dropWeight: first?.dropWeight || second?.dropWeight || 1,
    source: first?.source || second?.source || "unknown",
    sources: Array.from(new Set([...(first?.sources || []), ...(second?.sources || [])])),
    featured: Boolean(first?.featured || second?.featured),
    featuredRarity: first?.featuredRarity || second?.featuredRarity || null,
    sourceIds: {
      ...(second?.sourceIds || {}),
      ...(first?.sourceIds || {}),
    },
  };
}

function normalizeUserMeta(userMeta) {
  const username =
    typeof userMeta?.username === "string" && userMeta.username.trim()
      ? userMeta.username.trim()
      : null;
  const displayName =
    typeof userMeta?.displayName === "string" && userMeta.displayName.trim()
      ? userMeta.displayName.trim()
      : username;

  return {
    username,
    displayName,
  };
}

function readInventoryCount(entry) {
  if (typeof entry === "number") return Math.max(0, Math.floor(entry));
  if (entry && typeof entry === "object") return Math.max(0, Math.floor(Number(entry.count || 0)));
  return 0;
}

function summarizeInventory(inventory) {
  let uniqueCount = 0;
  let totalCopies = 0;

  for (const entry of Object.values(inventory || {})) {
    const count = readInventoryCount(entry);
    if (count <= 0) continue;
    uniqueCount += 1;
    totalCopies += count;
  }

  return { uniqueCount, totalCopies };
}

function upsertInventoryEntry(inventory, character) {
  const key = String(character.id);
  const snapshot = cloneCharacterSnapshot(character);
  const previous = inventory[key];

  if (typeof previous === "number") {
    inventory[key] = {
      count: Math.max(0, Math.floor(previous)) + 1,
      character: snapshot,
    };
    return;
  }

  if (previous && typeof previous === "object") {
    const previousCount = Math.max(0, Math.floor(Number(previous.count || 0)));
    inventory[key] = {
      count: previousCount + 1,
      character: mergeCharacterSnapshot(snapshot, previous.character),
    };
    return;
  }

  inventory[key] = {
    count: 1,
    character: snapshot,
  };
}

function buildInventoryEntries(inventory, byId) {
  const safeInventory =
    inventory && typeof inventory === "object" && !Array.isArray(inventory) ? inventory : {};
  const normalizedInventory = {};
  const entries = [];
  let changed = false;

  for (const [rawId, rawEntry] of Object.entries(safeInventory)) {
    const id = String(rawId);
    const count = readInventoryCount(rawEntry);
    if (count <= 0) {
      changed = true;
      continue;
    }

    const poolCharacter = byId.get(id);
    const storedCharacter =
      rawEntry && typeof rawEntry === "object" ? cloneCharacterSnapshot(rawEntry.character) : null;
    const character = mergeCharacterSnapshot(storedCharacter, poolCharacter || { id });

    normalizedInventory[id] = {
      count,
      character,
    };
    entries.push({ character, count });

    const isLegacyNumber = typeof rawEntry === "number";
    const missingCharacterPayload = !(rawEntry && typeof rawEntry === "object" && rawEntry.character);
    const nonNumericCount = !(rawEntry && typeof rawEntry === "object" && typeof rawEntry.count === "number");
    if (isLegacyNumber || missingCharacterPayload || nonNumericCount) {
      changed = true;
    }
  }

  return {
    entries,
    normalizedInventory,
    changed,
  };
}

function findBestCharacterMatch(query, characters) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return null;

  let bestMatch = null;
  for (const character of characters || []) {
    const normalizedName = normalizeText(character?.name);
    const normalizedAnime = normalizeText(character?.anime);
    let score = 0;

    if (normalizedName === normalizedQuery) score += 500;
    else if (normalizedName.startsWith(normalizedQuery)) score += 350;
    else if (normalizedName.includes(normalizedQuery)) score += 250;

    if (normalizedAnime.includes(normalizedQuery)) score += 80;
    if (normalizeText(character?.id) === normalizedQuery) score += 500;
    if (score <= 0) continue;

    if (
      !bestMatch ||
      score > bestMatch.score ||
      (score === bestMatch.score && Number(character?.favorites || 0) > bestMatch.character.favorites)
    ) {
      bestMatch = { character, score };
    }
  }

  return bestMatch?.character || null;
}

function buildCharacterByIdMap(characters) {
  return new Map((characters || []).map((character) => [String(character.id), character]));
}

function sortCharactersForPool(characters) {
  return [...(characters || [])].sort((a, b) => {
    const favDiff = Number(b?.favorites || 0) - Number(a?.favorites || 0);
    if (favDiff !== 0) return favDiff;

    const rankA = Number(a?.popularityRank || 0) || Number.MAX_SAFE_INTEGER;
    const rankB = Number(b?.popularityRank || 0) || Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;

    return String(a?.name || "").localeCompare(String(b?.name || ""));
  });
}

function sortCharactersByRanking(characters) {
  return [...(characters || [])].sort((a, b) => {
    const rankA = Math.max(0, Math.floor(Number(a?.popularityRank || 0)));
    const rankB = Math.max(0, Math.floor(Number(b?.popularityRank || 0)));
    if (rankA > 0 && rankB > 0 && rankA !== rankB) return rankA - rankB;
    if (rankA > 0 && rankB <= 0) return -1;
    if (rankB > 0 && rankA <= 0) return 1;

    const favDiff = Number(b?.favorites || 0) - Number(a?.favorites || 0);
    if (favDiff !== 0) return favDiff;

    return String(a?.name || "").localeCompare(String(b?.name || ""));
  });
}

function mergeCharacterListsById(...lists) {
  const byId = new Map();

  for (const list of lists) {
    for (const character of list || []) {
      const snapshot = cloneCharacterSnapshot(character);
      if (!snapshot?.id) continue;

      if (!byId.has(snapshot.id)) {
        byId.set(snapshot.id, snapshot);
        continue;
      }

      byId.set(snapshot.id, mergeCharacterSnapshot(snapshot, byId.get(snapshot.id)));
    }
  }

  return [...byId.values()];
}

function buildContractRules(config) {
  const costs = {
    common: Math.max(1, Number(config?.contractCommonCost || 100)),
    rare: Math.max(1, Number(config?.contractRareCost || 50)),
    epic: Math.max(1, Number(config?.contractEpicCost || 20)),
    legendary: Math.max(1, Number(config?.contractLegendaryCost || 5)),
  };

  return CONTRACT_SOURCE_RARITIES.map((fromRarity, index) => ({
    from: fromRarity,
    to: CONTRACT_RARITY_CHAIN[index + 1],
    cost: costs[fromRarity] || 1,
  }));
}

function buildContractRuleMap(rules) {
  return new Map((rules || []).map((rule) => [String(rule.from), rule]));
}

function summarizeInventoryCountsByRarity(entries) {
  const counts = {
    common: 0,
    rare: 0,
    epic: 0,
    legendary: 0,
    mythic: 0,
  };

  for (const entry of entries || []) {
    const rarity = String(entry?.character?.rarity || "common");
    const count = Math.max(0, Math.floor(Number(entry?.count || 0)));
    if (count <= 0) continue;
    if (!Object.prototype.hasOwnProperty.call(counts, rarity)) {
      counts[rarity] = 0;
    }
    counts[rarity] += count;
  }

  return counts;
}

function collectContractCandidates(inventory, sourceRarity) {
  const candidates = [];

  for (const [id, entry] of Object.entries(inventory || {})) {
    if (!entry || typeof entry !== "object") continue;
    const count = readInventoryCount(entry);
    if (count <= 0) continue;

    const character = cloneCharacterSnapshot(entry.character);
    const rarity = String(character?.rarity || "common");
    if (rarity !== sourceRarity) continue;

    candidates.push({
      id: String(id),
      count,
      favorites: Number(character?.favorites || 0),
      name: String(character?.name || ""),
    });
  }

  return candidates.sort((a, b) => {
    const hasDuplicatesA = a.count > 1 ? 1 : 0;
    const hasDuplicatesB = b.count > 1 ? 1 : 0;
    if (hasDuplicatesA !== hasDuplicatesB) return hasDuplicatesB - hasDuplicatesA;
    if (a.count !== b.count) return b.count - a.count;
    if (a.favorites !== b.favorites) return a.favorites - b.favorites;
    return a.name.localeCompare(b.name);
  });
}

function applyContractConsumption(inventory, sourceRarity, copiesToConsume) {
  let remaining = Math.max(0, Math.floor(Number(copiesToConsume || 0)));
  let consumed = 0;
  const candidates = collectContractCandidates(inventory, sourceRarity);
  const consumedById = [];

  for (const preserveOneCopy of [true, false]) {
    if (remaining <= 0) break;

    for (const candidate of candidates) {
      if (remaining <= 0) break;
      const currentEntry = inventory[candidate.id];
      if (!currentEntry || typeof currentEntry !== "object") continue;

      const currentCount = readInventoryCount(currentEntry);
      if (currentCount <= 0) continue;

      const removable = preserveOneCopy ? Math.max(0, currentCount - 1) : currentCount;
      if (removable <= 0) continue;

      const take = Math.min(removable, remaining);
      const nextCount = currentCount - take;
      if (nextCount <= 0) {
        delete inventory[candidate.id];
      } else {
        inventory[candidate.id] = {
          count: nextCount,
          character: cloneCharacterSnapshot(currentEntry.character),
        };
      }

      consumed += take;
      remaining -= take;
      consumedById.push({
        id: candidate.id,
        count: take,
        character: cloneCharacterSnapshot(currentEntry.character),
      });
    }
  }

  return {
    ok: remaining === 0,
    consumed,
    remaining,
    consumedById,
  };
}

function normalizeContractMaterialSelection(rawSelection) {
  if (!Array.isArray(rawSelection)) return [];

  const byId = new Map();
  const order = [];
  for (const entry of rawSelection) {
    if (!entry || typeof entry !== "object") continue;
    const id = String(entry.id || "")
      .trim()
      .toLowerCase();
    if (!id) continue;
    const count = Math.max(1, Math.floor(Number(entry.count || 1)));

    if (!byId.has(id)) {
      order.push(id);
      byId.set(id, count);
      continue;
    }
    byId.set(id, byId.get(id) + count);
  }

  return order.map((id) => ({ id, count: byId.get(id) }));
}

function applySelectedContractConsumption(inventory, sourceRarity, copiesToConsume, rawSelection) {
  const requiredCopies = Math.max(0, Math.floor(Number(copiesToConsume || 0)));
  const selection = normalizeContractMaterialSelection(rawSelection);
  if (requiredCopies <= 0) {
    return {
      ok: true,
      consumed: 0,
      remaining: 0,
      consumedById: [],
    };
  }

  if (!selection.length) {
    return applyContractConsumption(inventory, sourceRarity, requiredCopies);
  }

  let selectedCopies = 0;
  for (const item of selection) {
    const currentEntry = inventory[item.id];
    if (!currentEntry || typeof currentEntry !== "object") {
      return {
        ok: false,
        consumed: 0,
        remaining: requiredCopies,
        consumedById: [],
        error: `No tienes el personaje con ID \`${item.id}\` en inventario.`,
      };
    }

    const currentCount = readInventoryCount(currentEntry);
    if (currentCount <= 0) {
      return {
        ok: false,
        consumed: 0,
        remaining: requiredCopies,
        consumedById: [],
        error: `No tienes copias disponibles para \`${item.id}\`.`,
      };
    }

    const character = cloneCharacterSnapshot(currentEntry.character);
    const rarity = String(character?.rarity || "common");
    if (rarity !== sourceRarity) {
      return {
        ok: false,
        consumed: 0,
        remaining: requiredCopies,
        consumedById: [],
        error: `\`${item.id}\` no es de rareza ${RARITY_LABELS[sourceRarity] || sourceRarity}.`,
      };
    }

    if (item.count > currentCount) {
      return {
        ok: false,
        consumed: 0,
        remaining: requiredCopies,
        consumedById: [],
        error: `\`${item.id}\` solo tiene ${currentCount} copia(s), pediste ${item.count}.`,
      };
    }

    selectedCopies += item.count;
  }

  if (selectedCopies < requiredCopies) {
    return {
      ok: false,
      consumed: 0,
      remaining: requiredCopies,
      consumedById: [],
      error: `Seleccionaste ${selectedCopies} copia(s), pero necesitas ${requiredCopies}.`,
    };
  }

  let remaining = requiredCopies;
  let consumed = 0;
  const consumedById = [];
  for (const item of selection) {
    if (remaining <= 0) break;

    const currentEntry = inventory[item.id];
    if (!currentEntry || typeof currentEntry !== "object") continue;

    const currentCount = readInventoryCount(currentEntry);
    if (currentCount <= 0) continue;

    const take = Math.min(item.count, currentCount, remaining);
    if (take <= 0) continue;

    const nextCount = currentCount - take;
    if (nextCount <= 0) {
      delete inventory[item.id];
    } else {
      inventory[item.id] = {
        count: nextCount,
        character: cloneCharacterSnapshot(currentEntry.character),
      };
    }

    consumed += take;
    remaining -= take;
    consumedById.push({
      id: item.id,
      count: take,
      character: cloneCharacterSnapshot(currentEntry.character),
    });
  }

  return {
    ok: remaining === 0,
    consumed,
    remaining,
    consumedById,
  };
}

function normalizeTradeStatus(rawStatus) {
  const status = String(rawStatus || "")
    .trim()
    .toLowerCase();
  return TRADE_VALID_STATUSES.has(status) ? status : TRADE_PENDING_STATUS;
}

function createTradeOfferId() {
  const timestamp = Date.now().toString(36);
  const randomSuffix = Math.random().toString(36).slice(2, 8);
  return `tr_${timestamp}_${randomSuffix}`;
}

function normalizeTradeOffer(rawOffer) {
  if (!rawOffer || typeof rawOffer !== "object") return null;

  const id = String(rawOffer.id || "").trim();
  const proposerId = String(rawOffer.proposerId || "").trim();
  const targetId = String(rawOffer.targetId || "").trim();
  const offeredCharacterId = String(rawOffer.offeredCharacterId || "").trim();
  const requestedCharacterId = String(rawOffer.requestedCharacterId || "").trim();
  if (!id || !proposerId || !targetId || !offeredCharacterId || !requestedCharacterId) {
    return null;
  }

  const status = normalizeTradeStatus(rawOffer.status);
  const createdAt = isValidDateString(rawOffer.createdAt)
    ? new Date(rawOffer.createdAt).toISOString()
    : "1970-01-01T00:00:00.000Z";
  const expiresAt = isValidDateString(rawOffer.expiresAt)
    ? new Date(rawOffer.expiresAt).toISOString()
    : null;
  const resolvedAt = isValidDateString(rawOffer.resolvedAt)
    ? new Date(rawOffer.resolvedAt).toISOString()
    : null;

  const proposerUsername =
    typeof rawOffer.proposerUsername === "string" && rawOffer.proposerUsername.trim()
      ? rawOffer.proposerUsername.trim()
      : null;
  const proposerDisplayName =
    typeof rawOffer.proposerDisplayName === "string" && rawOffer.proposerDisplayName.trim()
      ? rawOffer.proposerDisplayName.trim()
      : proposerUsername;
  const targetUsername =
    typeof rawOffer.targetUsername === "string" && rawOffer.targetUsername.trim()
      ? rawOffer.targetUsername.trim()
      : null;
  const targetDisplayName =
    typeof rawOffer.targetDisplayName === "string" && rawOffer.targetDisplayName.trim()
      ? rawOffer.targetDisplayName.trim()
      : targetUsername;

  return {
    id,
    proposerId,
    proposerUsername,
    proposerDisplayName,
    targetId,
    targetUsername,
    targetDisplayName,
    offeredCharacterId,
    requestedCharacterId,
    offeredCharacter: mergeCharacterSnapshot(rawOffer.offeredCharacter, { id: offeredCharacterId }),
    requestedCharacter: mergeCharacterSnapshot(rawOffer.requestedCharacter, { id: requestedCharacterId }),
    status,
    createdAt,
    expiresAt,
    resolvedAt,
  };
}

function sortTradeOffers(rawOffers) {
  return [...(rawOffers || [])].sort((a, b) => {
    const createdAtA = Date.parse(a?.createdAt || 0) || 0;
    const createdAtB = Date.parse(b?.createdAt || 0) || 0;
    if (createdAtA !== createdAtB) return createdAtB - createdAtA;
    return String(a?.id || "").localeCompare(String(b?.id || ""));
  });
}

function normalizeTradeOffers(rawOffers) {
  return sortTradeOffers((rawOffers || []).map((offer) => normalizeTradeOffer(offer)).filter(Boolean));
}

function expirePendingTradeOffers(rawOffers, nowIso = new Date().toISOString()) {
  const nowMs = Date.parse(nowIso);
  let changed = false;
  const offers = normalizeTradeOffers(rawOffers).map((offer) => ({ ...offer }));

  const next = offers.map((offer) => {
    if (offer.status !== TRADE_PENDING_STATUS) return offer;
    if (!offer.expiresAt || Number.isNaN(Date.parse(offer.expiresAt))) return offer;
    if (Date.parse(offer.expiresAt) > nowMs) return offer;

    changed = true;
    return {
      ...offer,
      status: "expired",
      resolvedAt: nowIso,
    };
  });

  return {
    offers: sortTradeOffers(next),
    changed,
  };
}

function trimResolvedTradeOffers(rawOffers, maxResolved = TRADE_MAX_RESOLVED_HISTORY) {
  const pending = [];
  const resolved = [];
  for (const offer of rawOffers || []) {
    if (String(offer?.status || "") === TRADE_PENDING_STATUS) {
      pending.push(offer);
    } else {
      resolved.push(offer);
    }
  }

  const sortedResolved = [...resolved].sort((a, b) => {
    const resolvedAtA = Date.parse(a?.resolvedAt || a?.createdAt || 0) || 0;
    const resolvedAtB = Date.parse(b?.resolvedAt || b?.createdAt || 0) || 0;
    if (resolvedAtA !== resolvedAtB) return resolvedAtB - resolvedAtA;
    return String(a?.id || "").localeCompare(String(b?.id || ""));
  });
  const trimmedResolved = sortedResolved.slice(0, Math.max(0, Number(maxResolved || 0)));
  const changed = trimmedResolved.length !== resolved.length;

  return {
    offers: sortTradeOffers([...pending, ...trimmedResolved]),
    changed,
  };
}

function findInventoryEntryByQuery(entries, rawQuery) {
  const safeEntries = Array.isArray(entries) ? entries : [];
  if (!safeEntries.length) return null;

  const query = String(rawQuery || "").trim();
  if (!query) return null;
  const queryLower = query.toLowerCase();
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return null;

  for (const entry of safeEntries) {
    const id = String(entry?.character?.id || "")
      .trim()
      .toLowerCase();
    if (id && id === queryLower) return entry;
  }

  const withAnimeMatch = normalizedQuery.match(/^(.+)\s+de\s+(.+)$/i);
  const namePart = withAnimeMatch?.[1] ? normalizeText(withAnimeMatch[1]) : "";
  const animePart = withAnimeMatch?.[2] ? normalizeText(withAnimeMatch[2]) : "";

  let best = null;
  for (const entry of safeEntries) {
    const character = entry?.character || {};
    const normalizedName = normalizeText(character?.name);
    const normalizedAnime = normalizeText(character?.anime);
    const normalizedId = normalizeText(character?.id);
    const normalizedCombined = `${normalizedName} ${normalizedAnime}`.trim();
    if (!normalizedName && !normalizedAnime && !normalizedId) continue;

    let score = 0;
    if (normalizedId && normalizedId === normalizedQuery) score += 2000;
    if (normalizedName === normalizedQuery) score += 1200;
    else if (normalizedName.startsWith(normalizedQuery)) score += 900;
    else if (normalizedName.includes(normalizedQuery)) score += 700;

    if (normalizedAnime === normalizedQuery) score += 450;
    else if (normalizedAnime.includes(normalizedQuery)) score += 300;

    if (normalizedCombined.includes(normalizedQuery)) score += 250;
    if (namePart && animePart && normalizedName.includes(namePart) && normalizedAnime.includes(animePart)) {
      score += 1500;
    }

    if (score <= 0) continue;

    const rank = Number(character?.popularityRank || 0) || Number.MAX_SAFE_INTEGER;
    const favorites = Number(character?.favorites || 0);
    if (
      !best ||
      score > best.score ||
      (score === best.score && rank < best.rank) ||
      (score === best.score && rank === best.rank && favorites > best.favorites)
    ) {
      best = {
        entry,
        score,
        rank,
        favorites,
      };
    }
  }

  return best?.entry || null;
}

function consumeInventoryCopies(inventory, characterId, copies = 1) {
  const id = String(characterId || "").trim();
  const needed = Math.max(1, Math.floor(Number(copies || 1)));
  if (!id) {
    return {
      ok: false,
      error: "ID de personaje invalido.",
      character: null,
      consumed: 0,
      remaining: 0,
    };
  }

  const currentEntry = inventory?.[id];
  if (!currentEntry || typeof currentEntry !== "object") {
    return {
      ok: false,
      error: `No hay copias disponibles de \`${id}\`.`,
      character: null,
      consumed: 0,
      remaining: 0,
    };
  }

  const currentCount = readInventoryCount(currentEntry);
  if (currentCount < needed) {
    return {
      ok: false,
      error: `\`${id}\` tiene ${currentCount} copia(s), faltan ${needed}.`,
      character: cloneCharacterSnapshot(currentEntry.character),
      consumed: 0,
      remaining: currentCount,
    };
  }

  const snapshot = cloneCharacterSnapshot(currentEntry.character) || { id };
  const nextCount = currentCount - needed;
  if (nextCount <= 0) {
    delete inventory[id];
  } else {
    inventory[id] = {
      count: nextCount,
      character: snapshot,
    };
  }

  return {
    ok: true,
    error: null,
    character: snapshot,
    consumed: needed,
    remaining: Math.max(0, nextCount),
  };
}

async function persistNormalizedInventoryContext(store, userId, context) {
  if (!context || !context.user) return false;
  if (!context.userChanged && !context.inventoryChanged) return false;
  context.user.inventory = context.normalizedInventory;
  await store.saveUser(userId, context.user);
  return true;
}

function pickRandom(items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)] || null;
}

function normalizeGachaState(rawState) {
  const state = rawState && typeof rawState === "object" ? rawState : {};
  const legacyBoardDate = typeof state.boardDate === "string" ? state.boardDate : null;
  const boardUpdatedAt = isValidDateString(state.boardUpdatedAt)
    ? state.boardUpdatedAt
    : isValidDateString(legacyBoardDate)
      ? new Date(legacyBoardDate).toISOString()
      : null;

  return {
    ...DEFAULT_GACHA_STATE,
    boardCharacters: Array.isArray(state.boardCharacters)
      ? state.boardCharacters.map((character) => cloneCharacterSnapshot(character)).filter(Boolean)
      : [],
    boardCharacterIds: Array.isArray(state.boardCharacterIds) ? state.boardCharacterIds : [],
    boardUpdatedAt,
    poolUpdatedAt: isValidDateString(state.poolUpdatedAt) ? state.poolUpdatedAt : null,
    mythicCharacters: Array.isArray(state.mythicCharacters)
      ? state.mythicCharacters.map((character) => cloneCharacterSnapshot(character)).filter(Boolean)
      : [],
    mythicCatalogUpdatedAt: isValidDateString(state.mythicCatalogUpdatedAt)
      ? state.mythicCatalogUpdatedAt
      : null,
    tradeOffers: normalizeTradeOffers(state.tradeOffers),
  };
}

function formatBoardTimestamp(isoDate, timeZone) {
  if (!isoDate || !isValidDateString(isoDate)) return "sin actualizar";

  return new Intl.DateTimeFormat("es-AR", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(isoDate));
}

function formatIsoTimestamp(isoDate, timeZone) {
  if (!isoDate || !isValidDateString(isoDate)) return "desconocido";
  return new Intl.DateTimeFormat("es-AR", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(isoDate));
}

class GachaEngine {
  constructor(store, config) {
    this.store = store;
    this.config = config;
    this.gachaState = { ...DEFAULT_GACHA_STATE };
    this.catalogCharacters = [];
    this.catalogById = new Map();
    this.characters = [];
    this.characterById = this.catalogById;
    this.poolSyncPromise = null;
    this.mythicCatalogSyncPromise = null;
    this.nextBoardPrefetch = null;
    this.nextBoardPrefetchPromise = null;
  }

  async bootstrap() {
    await this.store.init();
    this.gachaState = normalizeGachaState(await this.store.getGachaState());
    const hasBoard = this.getBoardCharacters().length > 0;
    if (!hasBoard) {
      await this.ensureBoard(true);
    }

    // Warm in background so Firestore always has mythic catalog and refreshes by TTL.
    this.ensureMythicCatalog().catch((error) => {
      console.error("[Gacha] mythic catalog warmup failed:", error.message);
    });
  }

  async ensureCharacterPool(force = false) {
    if (this.poolSyncPromise && !force) {
      return this.poolSyncPromise;
    }

    const syncPromise = (async () => {
      if (!force && this.characters.length > 0) {
        return this.characters;
      }

      const configuredPoolSize = Math.max(
        1,
        Math.floor(Number(this.config.poolSize || 10000))
      );
      const boardSize = Math.max(1, Math.floor(Number(this.config.boardSize || 50)));
      const primaryTarget = Math.max(
        configuredPoolSize,
        boardSize * 2
      );
      const retryTarget = Math.max(boardSize * 2, Math.min(1000, configuredPoolSize));
      const targets = Array.from(new Set([primaryTarget, retryTarget]));

      let fetched = [];
      let hasNonFallbackCharacter = false;
      for (const target of targets) {
        try {
          const candidate = await fetchCharacterPool(target);
          console.log(
            `[Gacha] fetched ${candidate.length} characters from AniList catalog (target=${target})`
          );
          fetched = candidate;
          hasNonFallbackCharacter = candidate.some(
            (character) => String(character?.source || "").toLowerCase() !== "fallback"
          );
          if (hasNonFallbackCharacter) {
            break;
          }
          console.warn(`[Gacha] fallback-only catalog received (target=${target}), retrying...`);
        } catch (error) {
          console.error(
            `[Gacha] could not fetch characters from catalog (target=${target}):`,
            error.message
          );
        }
      }

      if (!fetched.length) return this.characters;
      if (!hasNonFallbackCharacter && this.characters.length > 0) {
        console.warn("[Gacha] fetch returned fallback-only data; keeping current pool");
        return this.characters;
      }

      const mergedCatalog = mergeCharacterListsById(fetched.slice(0, configuredPoolSize));
      this.catalogCharacters = sortCharactersForPool(mergedCatalog)
        .map((character) => cloneCharacterSnapshot(character))
        .filter(Boolean);
      this.catalogById = buildCharacterByIdMap(this.catalogCharacters);
      this.characterById = this.catalogById;
      this.characters = assignRarityAndWeight(this.catalogCharacters)
        .map((character) => cloneCharacterSnapshot(character))
        .filter(Boolean);
      this.gachaState.poolUpdatedAt = new Date().toISOString();

      await this.store.saveGachaState(this.gachaState);

      return this.characters;
    })();

    this.poolSyncPromise = syncPromise;
    try {
      return await syncPromise;
    } finally {
      if (this.poolSyncPromise === syncPromise) {
        this.poolSyncPromise = null;
      }
    }
  }

  async ensureMythicCatalog(force = false) {
    if (this.mythicCatalogSyncPromise && !force) {
      return this.mythicCatalogSyncPromise;
    }

    const syncPromise = (async () => {
      const refreshIntervalMs = this.getMythicCatalogRefreshIntervalMs();
      const cached = sortCharactersByRanking(
        (this.gachaState.mythicCharacters || [])
          .map((character) => cloneCharacterSnapshot(character))
          .filter(Boolean)
      ).slice(0, MYTHIC_CATALOG_LIMIT);
      const stale =
        !this.gachaState.mythicCatalogUpdatedAt ||
        isTimestampOlderThan(this.gachaState.mythicCatalogUpdatedAt, refreshIntervalMs);

      if (!force && cached.length >= MYTHIC_CATALOG_LIMIT && !stale) {
        console.log(`[Gacha] mythic catalog loaded from cache (${cached.length} characters)`);
        return cached;
      }

      const fetched = await fetchTopRankedCharacters(MYTHIC_CATALOG_LIMIT);
      if (!fetched.length) {
        if (cached.length > 0) return cached;
        return [];
      }

      const mythicCatalog = sortCharactersByRanking(
        fetched
          .map((character) =>
            cloneCharacterSnapshot({
              ...character,
              rarity: "mythic",
              dropWeight: RARITY_BASE_WEIGHTS.mythic,
            })
          )
          .filter(Boolean)
      ).slice(0, MYTHIC_CATALOG_LIMIT);

      if (!mythicCatalog.length) {
        if (cached.length > 0) return cached;
        return [];
      }

      this.gachaState.mythicCharacters = mythicCatalog;
      this.gachaState.mythicCatalogUpdatedAt = new Date().toISOString();
      await this.store.saveGachaState(this.gachaState);
      console.log(`[Gacha] mythic catalog saved (${mythicCatalog.length} characters)`);
      return mythicCatalog;
    })();

    this.mythicCatalogSyncPromise = syncPromise;
    try {
      return await syncPromise;
    } finally {
      if (this.mythicCatalogSyncPromise === syncPromise) {
        this.mythicCatalogSyncPromise = null;
      }
    }
  }

  getMythicCatalogRefreshIntervalMs() {
    return Math.max(10, Number(this.config.mythicCatalogRefreshMinutes || 360)) * 60 * 1000;
  }

  getBoardRefreshIntervalMs() {
    return Math.max(1, Number(this.config.boardRefreshMinutes || 60)) * 60 * 1000;
  }

  getPityRules() {
    const legacyDefault = Math.max(1, Math.floor(Number(this.config.pityRolls || 80)));
    const mythicSoftPityRolls = Math.max(
      1,
      Math.floor(Number(this.config.mythicSoftPityRolls || legacyDefault))
    );
    const mythicHardPityRolls = Math.max(
      mythicSoftPityRolls,
      Math.floor(Number(this.config.mythicHardPityRolls || legacyDefault))
    );

    return {
      mythicSoftPityRolls,
      mythicHardPityRolls,
      mythicSoftPityRateStepPercent: Math.max(
        0,
        Number(this.config.mythicSoftPityRateStepPercent || 0)
      ),
      mythicHardPityTriggerAt: Math.max(0, mythicHardPityRolls - 1),
    };
  }

  getBoardPrefetchWindowMs(refreshMs = this.getBoardRefreshIntervalMs()) {
    const prefetchMinutes = Math.max(1, Number(this.config.boardPrefetchMinutes || 5));
    return Math.min(refreshMs, prefetchMinutes * 60 * 1000);
  }

  clearPrefetchedBoard() {
    this.nextBoardPrefetch = null;
  }

  buildBoardSnapshot(characters) {
    const baseBoard = generateBoard(characters, this.config.boardSize);
    const boardWithFeatured = applyFeaturedBoost(baseBoard, this.config.featuredBoardBoostPercent);
    return boardWithFeatured
      .map((character) => cloneCharacterSnapshot(character))
      .filter(Boolean);
  }

  async saveBoardState(board) {
    const snapshots = (board || []).map((character) => cloneCharacterSnapshot(character)).filter(Boolean);
    if (!snapshots.length) return [];

    const nowIso = new Date().toISOString();
    this.gachaState.boardCharacters = snapshots;
    this.gachaState.boardCharacterIds = snapshots.map((character) => character.id);
    this.gachaState.boardUpdatedAt = nowIso;
    this.clearPrefetchedBoard();
    await this.store.saveGachaState(this.gachaState);
    return snapshots;
  }

  async prefetchNextBoardIfNeeded(baseBoardUpdatedAtIso, msRemaining) {
    if (
      typeof baseBoardUpdatedAtIso !== "string" ||
      !isValidDateString(baseBoardUpdatedAtIso) ||
      !Number.isFinite(msRemaining)
    ) {
      return null;
    }

    const prefetchWindowMs = this.getBoardPrefetchWindowMs();
    if (msRemaining <= 0 || msRemaining > prefetchWindowMs) {
      return null;
    }

    if (
      this.nextBoardPrefetch &&
      this.nextBoardPrefetch.baseBoardUpdatedAt === baseBoardUpdatedAtIso &&
      Array.isArray(this.nextBoardPrefetch.characters) &&
      this.nextBoardPrefetch.characters.length > 0
    ) {
      return this.nextBoardPrefetch.characters;
    }

    if (this.nextBoardPrefetchPromise) {
      return this.nextBoardPrefetchPromise;
    }

    const prefetchPromise = (async () => {
      const characters = await this.ensureCharacterPool();
      if (!characters.length) return null;

      const nextBoard = this.buildBoardSnapshot(characters);
      if (!nextBoard.length) return null;
      if (this.gachaState.boardUpdatedAt !== baseBoardUpdatedAtIso) return null;

      this.nextBoardPrefetch = {
        baseBoardUpdatedAt: baseBoardUpdatedAtIso,
        characters: nextBoard,
        prefetchedAt: new Date().toISOString(),
      };
      console.log(`[Gacha] prefetched next board (${nextBoard.length} characters)`);
      return nextBoard;
    })();

    this.nextBoardPrefetchPromise = prefetchPromise;
    try {
      return await prefetchPromise;
    } finally {
      if (this.nextBoardPrefetchPromise === prefetchPromise) {
        this.nextBoardPrefetchPromise = null;
      }
    }
  }

  async ensureBoard(force = false) {
    const refreshMs = this.getBoardRefreshIntervalMs();
    const boardUpdatedAtIso = this.gachaState.boardUpdatedAt;
    const boardUpdatedAtMs = boardUpdatedAtIso ? Date.parse(boardUpdatedAtIso) : 0;
    const currentBoard = this.getBoardCharacters();
    const hasBoard = currentBoard.length > 0;
    const isFallbackOnlyBoard =
      hasBoard &&
      currentBoard.every((character) => String(character?.source || "").toLowerCase() === "fallback");
    const msRemaining = boardUpdatedAtMs ? Math.max(0, refreshMs - (Date.now() - boardUpdatedAtMs)) : 0;
    const isBoardFresh = boardUpdatedAtMs && msRemaining > 0;

    if (!force && hasBoard && isBoardFresh && !isFallbackOnlyBoard) {
      this.prefetchNextBoardIfNeeded(boardUpdatedAtIso, msRemaining).catch((error) => {
        console.error("[Gacha] board prefetch failed:", error.message);
      });
      return currentBoard;
    }

    if (force) {
      this.clearPrefetchedBoard();
    }

    let seededFromCurrentBoard = false;
    if (!this.characters.length && hasBoard) {
      const snapshots = currentBoard.map((character) => cloneCharacterSnapshot(character)).filter(Boolean);
      this.catalogCharacters = sortCharactersForPool(snapshots);
      this.catalogById = buildCharacterByIdMap(this.catalogCharacters);
      this.characterById = this.catalogById;
      this.characters = assignRarityAndWeight(this.catalogCharacters)
        .map((character) => cloneCharacterSnapshot(character))
        .filter(Boolean);
      seededFromCurrentBoard = true;
    }

    const prefetchedBoard =
      !force &&
      this.nextBoardPrefetch &&
      this.nextBoardPrefetch.baseBoardUpdatedAt === boardUpdatedAtIso &&
      Array.isArray(this.nextBoardPrefetch.characters) &&
      this.nextBoardPrefetch.characters.length > 0
        ? this.nextBoardPrefetch.characters
        : null;

    let board = prefetchedBoard;
    if (prefetchedBoard) {
      console.log("[Gacha] activating prefetched board");
    } else {
      const shouldForcePoolSync = force || seededFromCurrentBoard;
      const characters = await this.ensureCharacterPool(shouldForcePoolSync);
      if (!characters.length) return currentBoard;
      board = this.buildBoardSnapshot(characters);
    }

    if (!board.length) return currentBoard;
    return this.saveBoardState(board);
  }

  getBoardCharacters() {
    const directBoard = Array.isArray(this.gachaState.boardCharacters) ? this.gachaState.boardCharacters : [];
    if (directBoard.length > 0) {
      return directBoard
        .map((character) => cloneCharacterSnapshot(character))
        .filter(Boolean)
        .sort(compareBoardCharacters);
    }

    const ids = Array.isArray(this.gachaState.boardCharacterIds) ? this.gachaState.boardCharacterIds : [];
    if (!ids.length) return [];
    return ids
      .map((id) => cloneCharacterSnapshot(this.characterById.get(String(id))))
      .filter(Boolean)
      .sort(compareBoardCharacters);
  }

  async syncUser(userId, userMeta = {}) {
    const today = todayKey(this.config.timezone);
    const safeMeta = normalizeUserMeta(userMeta);
    let changed = false;
    let user = await this.store.getUser(userId);

    if (!user) {
      user = {
        username: safeMeta.username,
        displayName: safeMeta.displayName,
        lastReset: today,
        rollsLeft: this.config.rollsPerDay,
        totalRolls: 0,
        mythicPityCounter: 0,
        pityCounter: 0,
        inventory: {},
        lastRollAt: null,
        lastDailyClaimAt: null,
      };
      changed = true;
    }

    if (typeof user.username !== "string" && user.username !== null) {
      user.username = null;
      changed = true;
    }

    if (typeof user.displayName !== "string" && user.displayName !== null) {
      user.displayName = null;
      changed = true;
    }

    if (safeMeta.username && user.username !== safeMeta.username) {
      user.username = safeMeta.username;
      changed = true;
    }

    if (safeMeta.displayName && user.displayName !== safeMeta.displayName) {
      user.displayName = safeMeta.displayName;
      changed = true;
    }

    if (!user.displayName && user.username) {
      user.displayName = user.username;
      changed = true;
    }

    if (user.lastReset !== today) {
      user.lastReset = today;
      user.rollsLeft = this.config.rollsPerDay;
      changed = true;
    }

    if (!user.inventory || typeof user.inventory !== "object" || Array.isArray(user.inventory)) {
      user.inventory = {};
      changed = true;
    }

    if (typeof user.totalRolls !== "number") {
      user.totalRolls = 0;
      changed = true;
    }

    if (typeof user.rollsLeft !== "number" || Number.isNaN(user.rollsLeft)) {
      user.rollsLeft = this.config.rollsPerDay;
      changed = true;
    }

    if (user.rollsLeft < 0) {
      user.rollsLeft = 0;
      changed = true;
    }

    const pityRules = this.getPityRules();
    const legacyPityCounter = Math.max(0, Math.floor(Number(user.pityCounter || 0)));
    if (typeof user.mythicPityCounter !== "number" || Number.isNaN(user.mythicPityCounter)) {
      user.mythicPityCounter = legacyPityCounter;
      changed = true;
    }

    user.mythicPityCounter = Math.floor(user.mythicPityCounter);
    if (user.mythicPityCounter < 0) {
      user.mythicPityCounter = 0;
      changed = true;
    }

    const pityCap = Math.max(0, Number(pityRules.mythicHardPityRolls || 80) - 1);
    if (user.mythicPityCounter > pityCap) {
      user.mythicPityCounter = pityCap;
      changed = true;
    }

    if (user.pityCounter !== user.mythicPityCounter) {
      user.pityCounter = user.mythicPityCounter;
      changed = true;
    }

    if (typeof user.lastDailyClaimAt !== "string" && user.lastDailyClaimAt !== null) {
      user.lastDailyClaimAt = null;
      changed = true;
    }

    if (
      typeof user.lastDailyClaimAt === "string" &&
      Number.isNaN(Date.parse(user.lastDailyClaimAt))
    ) {
      user.lastDailyClaimAt = null;
      changed = true;
    }

    return { user, changed };
  }

  async getBoard() {
    return this.ensureBoard();
  }

  async getCharactersByRarity(rarity) {
    await this.ensureCharacterPool();
    const targetRarity = String(rarity || "")
      .trim()
      .toLowerCase();
    if (!targetRarity) return [];

    return this.characters
      .filter((character) => String(character?.rarity || "").toLowerCase() === targetRarity)
      .map((character) => cloneCharacterSnapshot(character))
      .filter(Boolean)
      .sort((a, b) => {
        const rankA = Number(a?.popularityRank || 0) || Number.MAX_SAFE_INTEGER;
        const rankB = Number(b?.popularityRank || 0) || Number.MAX_SAFE_INTEGER;
        if (rankA !== rankB) return rankA - rankB;

        const favDiff = Number(b?.favorites || 0) - Number(a?.favorites || 0);
        if (favDiff !== 0) return favDiff;

        return String(a?.name || "").localeCompare(String(b?.name || ""));
      });
  }

  async getMythicCatalog() {
    const catalog = await this.ensureMythicCatalog();
    return sortCharactersByRanking(catalog)
      .slice(0, MYTHIC_CATALOG_LIMIT)
      .map((character) => cloneCharacterSnapshot(character))
      .filter(Boolean);
  }

  getBoardDate() {
    return formatBoardTimestamp(this.gachaState.boardUpdatedAt, this.config.timezone);
  }

  getBoardRefreshInfo() {
    const refreshMs = this.getBoardRefreshIntervalMs();
    const boardUpdatedAt = this.gachaState.boardUpdatedAt;
    const hasBoard = this.getBoardCharacters().length > 0;

    if (!hasBoard || !isValidDateString(boardUpdatedAt)) {
      return {
        hasBoard: false,
        isReady: true,
        msRemaining: 0,
        nextRefreshAt: null,
        nextRefreshAtText: "desconocido",
        boardUpdatedAt: boardUpdatedAt || null,
        boardUpdatedAtText: formatIsoTimestamp(boardUpdatedAt, this.config.timezone),
      };
    }

    const lastRefreshMs = Date.parse(boardUpdatedAt);
    const nextRefreshMs = lastRefreshMs + refreshMs;
    const msRemaining = Math.max(0, nextRefreshMs - Date.now());
    const nextRefreshAtIso = new Date(nextRefreshMs).toISOString();

    return {
      hasBoard: true,
      isReady: msRemaining <= 0,
      msRemaining,
      nextRefreshAt: nextRefreshAtIso,
      nextRefreshAtText: formatIsoTimestamp(nextRefreshAtIso, this.config.timezone),
      boardUpdatedAt,
      boardUpdatedAtText: formatIsoTimestamp(boardUpdatedAt, this.config.timezone),
    };
  }

  getContractRules() {
    return buildContractRules(this.config);
  }

  getTradeOfferExpiryMs() {
    return Math.max(1, TRADE_DEFAULT_EXPIRY_MINUTES) * 60 * 1000;
  }

  async syncTradeOffers(saveIfChanged = false) {
    const rawOffers = Array.isArray(this.gachaState.tradeOffers) ? this.gachaState.tradeOffers : [];
    const normalizedOffers = normalizeTradeOffers(rawOffers);
    let changed = rawOffers.length !== normalizedOffers.length;

    const { offers: withExpiredTrades, changed: expirationChanged } = expirePendingTradeOffers(
      normalizedOffers
    );
    changed = changed || expirationChanged;

    const { offers: trimmedOffers, changed: historyTrimmed } = trimResolvedTradeOffers(withExpiredTrades);
    changed = changed || historyTrimmed;

    this.gachaState.tradeOffers = trimmedOffers;
    if (changed && saveIfChanged) {
      await this.store.saveGachaState(this.gachaState);
    }

    return {
      offers: trimmedOffers,
      changed,
    };
  }

  async listTradeOffersForUser(userId, userMeta = {}) {
    const safeUserId = String(userId || "").trim();
    if (!safeUserId) {
      return {
        incomingPending: [],
        outgoingPending: [],
        recentResolved: [],
      };
    }

    const { user, changed: userChanged } = await this.syncUser(safeUserId, userMeta);
    if (userChanged) {
      await this.store.saveUser(safeUserId, user);
    }

    const { offers } = await this.syncTradeOffers(true);
    const related = offers.filter(
      (offer) => offer.proposerId === safeUserId || offer.targetId === safeUserId
    );
    return {
      incomingPending: related.filter(
        (offer) => offer.status === TRADE_PENDING_STATUS && offer.targetId === safeUserId
      ),
      outgoingPending: related.filter(
        (offer) => offer.status === TRADE_PENDING_STATUS && offer.proposerId === safeUserId
      ),
      recentResolved: related
        .filter((offer) => offer.status !== TRADE_PENDING_STATUS)
        .sort((a, b) => {
          const aTime = Date.parse(a?.resolvedAt || a?.createdAt || 0) || 0;
          const bTime = Date.parse(b?.resolvedAt || b?.createdAt || 0) || 0;
          return bTime - aTime;
        })
        .slice(0, 10),
    };
  }

  async getTradeOfferById(tradeId) {
    const safeTradeId = String(tradeId || "").trim();
    if (!safeTradeId) return null;
    const { offers } = await this.syncTradeOffers(true);
    return offers.find((offer) => String(offer?.id || "") === safeTradeId) || null;
  }

  async findOwnersByCharacter(query, options = {}) {
    const input = String(query || "").trim();
    if (!input) {
      return {
        error: "Debes indicar un personaje o ID.",
        query: input,
        character: null,
        owners: [],
        totalOwners: 0,
      };
    }

    if (typeof this.store.getAllUsers !== "function") {
      return {
        error: "El almacenamiento actual no soporta busqueda global de inventarios.",
        query: input,
        character: null,
        owners: [],
        totalOwners: 0,
      };
    }

    const users = await this.store.getAllUsers();
    const boardById = buildCharacterByIdMap(this.getBoardCharacters());
    const byId = new Map([...boardById, ...this.characterById]);
    const inventoryCharacterById = new Map();
    const inventoryByUser = [];

    for (const record of users || []) {
      const userId = String(record?.userId || "").trim();
      if (!userId) continue;
      const user = record?.user && typeof record.user === "object" ? record.user : {};
      const inventory =
        user?.inventory && typeof user.inventory === "object" && !Array.isArray(user.inventory)
          ? user.inventory
          : {};
      const { entries } = buildInventoryEntries(inventory, byId);
      inventoryByUser.push({
        userId,
        user,
        entries,
      });

      for (const entry of entries) {
        const snapshot = cloneCharacterSnapshot(entry?.character);
        if (!snapshot?.id) continue;
        const previous = inventoryCharacterById.get(snapshot.id);
        inventoryCharacterById.set(
          snapshot.id,
          previous ? mergeCharacterSnapshot(snapshot, previous) : snapshot
        );
      }
    }

    const inventoryCharacters = [...inventoryCharacterById.values()];
    let targetCharacter = null;
    for (const character of inventoryCharacters) {
      if (String(character?.id || "").toLowerCase() === input.toLowerCase()) {
        targetCharacter = character;
        break;
      }
    }
    if (!targetCharacter) {
      targetCharacter = findBestCharacterMatch(input, inventoryCharacters);
    }

    if (!targetCharacter?.id) {
      return {
        error: null,
        query: input,
        character: null,
        owners: [],
        totalOwners: 0,
      };
    }

    const targetCharacterId = String(targetCharacter.id);
    const owners = [];
    for (const entry of inventoryByUser) {
      const matching = entry.entries.find(
        (item) => String(item?.character?.id || "") === targetCharacterId
      );
      if (!matching) continue;
      const count = Math.max(0, Math.floor(Number(matching.count || 0)));
      if (count <= 0) continue;

      const displayName =
        entry.user?.displayName || entry.user?.username || `Usuario ${entry.userId}`;
      owners.push({
        userId: entry.userId,
        username: entry.user?.username || null,
        displayName,
        count,
      });
    }

    owners.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return String(a.displayName || "").localeCompare(String(b.displayName || ""));
    });

    const limit = Math.max(1, Math.min(100, Number(options.limit || 25)));
    return {
      error: null,
      query: input,
      character: cloneCharacterSnapshot(targetCharacter),
      owners: owners.slice(0, limit),
      totalOwners: owners.length,
    };
  }

  async createTradeOffer(params = {}) {
    const safeProposerId = String(params.proposerId || "").trim();
    const safeTargetId = String(params.targetId || "").trim();
    if (!safeProposerId || !safeTargetId) {
      return { error: "Trade invalido: faltan usuarios." };
    }
    if (safeProposerId === safeTargetId) {
      return { error: "No puedes crear un trade contigo mismo." };
    }

    const offeredQuery = String(params.offeredQuery || "").trim();
    const requestedQuery = String(params.requestedQuery || "").trim();
    if (!offeredQuery || !requestedQuery) {
      return { error: "Debes indicar que ofreces y que pides para crear un trade." };
    }

    let { offers, changed: tradeStateChanged } = await this.syncTradeOffers(false);
    const persistTradeStateIfNeeded = async () => {
      if (!tradeStateChanged) return;
      await this.store.saveGachaState(this.gachaState);
      tradeStateChanged = false;
    };

    const pendingByProposer = offers.filter(
      (offer) => offer.status === TRADE_PENDING_STATUS && offer.proposerId === safeProposerId
    );
    if (pendingByProposer.length >= TRADE_MAX_PENDING_PER_USER) {
      await persistTradeStateIfNeeded();
      return {
        error: `Ya tienes ${TRADE_MAX_PENDING_PER_USER} trades pendientes. Cancela o espera respuesta.`,
      };
    }

    const proposerContext = await this.getNormalizedInventoryContext(
      safeProposerId,
      params.proposerMeta || {}
    );
    const targetContext = await this.getNormalizedInventoryContext(safeTargetId, params.targetMeta || {});
    await persistNormalizedInventoryContext(this.store, safeProposerId, proposerContext);
    await persistNormalizedInventoryContext(this.store, safeTargetId, targetContext);

    const offeredEntry = findInventoryEntryByQuery(proposerContext.entries, offeredQuery);
    if (!offeredEntry || readInventoryCount(offeredEntry) <= 0) {
      await persistTradeStateIfNeeded();
      return {
        error:
          "No pude encontrar en tu inventario el personaje que quieres ofrecer. Usa un ID exacto o nombre.",
      };
    }

    const requestedEntry = findInventoryEntryByQuery(targetContext.entries, requestedQuery);
    if (!requestedEntry || readInventoryCount(requestedEntry) <= 0) {
      await persistTradeStateIfNeeded();
      return {
        error:
          "No pude encontrar en el inventario del usuario objetivo el personaje que estas pidiendo.",
      };
    }

    const offeredCharacter = cloneCharacterSnapshot(offeredEntry.character);
    const requestedCharacter = cloneCharacterSnapshot(requestedEntry.character);
    if (!offeredCharacter?.id || !requestedCharacter?.id) {
      await persistTradeStateIfNeeded();
      return { error: "No se pudo construir el trade porque faltan datos de personaje." };
    }

    const duplicatedOffer = offers.find(
      (offer) =>
        offer.status === TRADE_PENDING_STATUS &&
        offer.proposerId === safeProposerId &&
        offer.targetId === safeTargetId &&
        offer.offeredCharacterId === offeredCharacter.id &&
        offer.requestedCharacterId === requestedCharacter.id
    );
    if (duplicatedOffer) {
      await persistTradeStateIfNeeded();
      return {
        error: `Ya existe una oferta pendiente igual con ID \`${duplicatedOffer.id}\`.`,
        offer: duplicatedOffer,
      };
    }

    const proposerIdentity = normalizeUserMeta({
      username: proposerContext.user?.username || params.proposerMeta?.username,
      displayName: proposerContext.user?.displayName || params.proposerMeta?.displayName,
    });
    const targetIdentity = normalizeUserMeta({
      username: targetContext.user?.username || params.targetMeta?.username,
      displayName: targetContext.user?.displayName || params.targetMeta?.displayName,
    });

    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + this.getTradeOfferExpiryMs()).toISOString();
    const offer = normalizeTradeOffer({
      id: createTradeOfferId(),
      proposerId: safeProposerId,
      proposerUsername: proposerIdentity.username,
      proposerDisplayName: proposerIdentity.displayName,
      targetId: safeTargetId,
      targetUsername: targetIdentity.username,
      targetDisplayName: targetIdentity.displayName,
      offeredCharacterId: offeredCharacter.id,
      requestedCharacterId: requestedCharacter.id,
      offeredCharacter,
      requestedCharacter,
      status: TRADE_PENDING_STATUS,
      createdAt,
      expiresAt,
      resolvedAt: null,
    });

    offers = sortTradeOffers([...offers, offer]);
    this.gachaState.tradeOffers = offers;
    await this.store.saveGachaState(this.gachaState);
    return { offer };
  }

  async acceptTradeOffer(tradeId, accepterUserId, accepterMeta = {}) {
    const safeTradeId = String(tradeId || "").trim();
    const safeAccepterId = String(accepterUserId || "").trim();
    if (!safeTradeId) return { error: "Debes indicar el ID del trade." };
    if (!safeAccepterId) return { error: "Usuario invalido para aceptar trade." };

    let { offers, changed: tradeStateChanged } = await this.syncTradeOffers(false);
    const persistTradeStateIfNeeded = async () => {
      if (!tradeStateChanged) return;
      await this.store.saveGachaState(this.gachaState);
      tradeStateChanged = false;
    };

    const offer = offers.find((entry) => entry.id === safeTradeId);
    if (!offer) {
      await persistTradeStateIfNeeded();
      return { error: `No existe un trade con ID \`${safeTradeId}\`.` };
    }
    if (offer.status !== TRADE_PENDING_STATUS) {
      await persistTradeStateIfNeeded();
      return { error: `El trade \`${safeTradeId}\` ya no esta pendiente (${offer.status}).` };
    }
    if (offer.targetId !== safeAccepterId) {
      await persistTradeStateIfNeeded();
      return { error: "Solo el usuario objetivo puede aceptar este trade." };
    }

    const proposerContext = await this.getNormalizedInventoryContext(offer.proposerId, {});
    const accepterContext = await this.getNormalizedInventoryContext(offer.targetId, accepterMeta);

    const proposerHolding = findInventoryEntryByQuery(proposerContext.entries, offer.offeredCharacterId);
    const accepterHolding = findInventoryEntryByQuery(accepterContext.entries, offer.requestedCharacterId);
    if (!proposerHolding || readInventoryCount(proposerHolding) <= 0) {
      await persistNormalizedInventoryContext(this.store, offer.proposerId, proposerContext);
      await persistNormalizedInventoryContext(this.store, offer.targetId, accepterContext);
      await persistTradeStateIfNeeded();
      return {
        error: `El trade no puede completarse: <@${offer.proposerId}> ya no tiene \`${offer.offeredCharacterId}\`.`,
      };
    }
    if (!accepterHolding || readInventoryCount(accepterHolding) <= 0) {
      await persistNormalizedInventoryContext(this.store, offer.proposerId, proposerContext);
      await persistNormalizedInventoryContext(this.store, offer.targetId, accepterContext);
      await persistTradeStateIfNeeded();
      return {
        error: `El trade no puede completarse: ya no tienes \`${offer.requestedCharacterId}\`.`,
      };
    }

    const proposerInventory = proposerContext.normalizedInventory;
    const accepterInventory = accepterContext.normalizedInventory;
    const proposerCharacterId = String(proposerHolding.character?.id || offer.offeredCharacterId);
    const accepterCharacterId = String(accepterHolding.character?.id || offer.requestedCharacterId);

    const removedFromProposer = consumeInventoryCopies(proposerInventory, proposerCharacterId, 1);
    if (!removedFromProposer.ok) {
      await persistNormalizedInventoryContext(this.store, offer.proposerId, proposerContext);
      await persistNormalizedInventoryContext(this.store, offer.targetId, accepterContext);
      await persistTradeStateIfNeeded();
      return { error: removedFromProposer.error || "No se pudo consumir el personaje del oferente." };
    }

    const removedFromAccepter = consumeInventoryCopies(accepterInventory, accepterCharacterId, 1);
    if (!removedFromAccepter.ok) {
      await persistNormalizedInventoryContext(this.store, offer.proposerId, proposerContext);
      await persistNormalizedInventoryContext(this.store, offer.targetId, accepterContext);
      await persistTradeStateIfNeeded();
      return { error: removedFromAccepter.error || "No se pudo consumir el personaje del receptor." };
    }

    const offeredCharacter = mergeCharacterSnapshot(removedFromProposer.character, offer.offeredCharacter);
    const requestedCharacter = mergeCharacterSnapshot(removedFromAccepter.character, offer.requestedCharacter);
    upsertInventoryEntry(proposerInventory, requestedCharacter);
    upsertInventoryEntry(accepterInventory, offeredCharacter);

    proposerContext.user.inventory = proposerInventory;
    accepterContext.user.inventory = accepterInventory;
    await this.store.saveUser(offer.proposerId, proposerContext.user);
    await this.store.saveUser(offer.targetId, accepterContext.user);

    const proposerIdentity = normalizeUserMeta({
      username: proposerContext.user?.username,
      displayName: proposerContext.user?.displayName,
    });
    const targetIdentity = normalizeUserMeta({
      username: accepterContext.user?.username,
      displayName: accepterContext.user?.displayName,
    });
    offer.proposerUsername = proposerIdentity.username;
    offer.proposerDisplayName = proposerIdentity.displayName;
    offer.targetUsername = targetIdentity.username;
    offer.targetDisplayName = targetIdentity.displayName;
    offer.offeredCharacterId = offeredCharacter.id || offer.offeredCharacterId;
    offer.requestedCharacterId = requestedCharacter.id || offer.requestedCharacterId;
    offer.offeredCharacter = offeredCharacter;
    offer.requestedCharacter = requestedCharacter;
    offer.status = "accepted";
    offer.resolvedAt = new Date().toISOString();

    this.gachaState.tradeOffers = sortTradeOffers(offers);
    await this.store.saveGachaState(this.gachaState);
    return {
      offer,
      offeredCharacter,
      requestedCharacter,
    };
  }

  async rejectTradeOffer(tradeId, actorUserId, actorMeta = {}) {
    const safeTradeId = String(tradeId || "").trim();
    const safeActorId = String(actorUserId || "").trim();
    if (!safeTradeId) return { error: "Debes indicar el ID del trade." };
    if (!safeActorId) return { error: "Usuario invalido para rechazar trade." };

    const { user, changed: actorChanged } = await this.syncUser(safeActorId, actorMeta);
    let { offers, changed: tradeStateChanged } = await this.syncTradeOffers(false);
    const persistTradeStateIfNeeded = async () => {
      if (!tradeStateChanged) return;
      await this.store.saveGachaState(this.gachaState);
      tradeStateChanged = false;
    };

    const offer = offers.find((entry) => entry.id === safeTradeId);
    if (!offer) {
      if (actorChanged) await this.store.saveUser(safeActorId, user);
      await persistTradeStateIfNeeded();
      return { error: `No existe un trade con ID \`${safeTradeId}\`.` };
    }
    if (offer.status !== TRADE_PENDING_STATUS) {
      if (actorChanged) await this.store.saveUser(safeActorId, user);
      await persistTradeStateIfNeeded();
      return { error: `El trade \`${safeTradeId}\` ya no esta pendiente (${offer.status}).` };
    }
    if (offer.targetId !== safeActorId) {
      if (actorChanged) await this.store.saveUser(safeActorId, user);
      await persistTradeStateIfNeeded();
      return { error: "Solo el usuario objetivo puede rechazar este trade." };
    }

    const actorIdentity = normalizeUserMeta({
      username: user?.username || actorMeta?.username,
      displayName: user?.displayName || actorMeta?.displayName,
    });
    offer.targetUsername = actorIdentity.username;
    offer.targetDisplayName = actorIdentity.displayName;
    offer.status = "rejected";
    offer.resolvedAt = new Date().toISOString();

    if (actorChanged) await this.store.saveUser(safeActorId, user);
    this.gachaState.tradeOffers = sortTradeOffers(offers);
    await this.store.saveGachaState(this.gachaState);
    return { offer };
  }

  async cancelTradeOffer(tradeId, actorUserId, actorMeta = {}) {
    const safeTradeId = String(tradeId || "").trim();
    const safeActorId = String(actorUserId || "").trim();
    if (!safeTradeId) return { error: "Debes indicar el ID del trade." };
    if (!safeActorId) return { error: "Usuario invalido para cancelar trade." };

    const { user, changed: actorChanged } = await this.syncUser(safeActorId, actorMeta);
    let { offers, changed: tradeStateChanged } = await this.syncTradeOffers(false);
    const persistTradeStateIfNeeded = async () => {
      if (!tradeStateChanged) return;
      await this.store.saveGachaState(this.gachaState);
      tradeStateChanged = false;
    };

    const offer = offers.find((entry) => entry.id === safeTradeId);
    if (!offer) {
      if (actorChanged) await this.store.saveUser(safeActorId, user);
      await persistTradeStateIfNeeded();
      return { error: `No existe un trade con ID \`${safeTradeId}\`.` };
    }
    if (offer.status !== TRADE_PENDING_STATUS) {
      if (actorChanged) await this.store.saveUser(safeActorId, user);
      await persistTradeStateIfNeeded();
      return { error: `El trade \`${safeTradeId}\` ya no esta pendiente (${offer.status}).` };
    }
    if (offer.proposerId !== safeActorId) {
      if (actorChanged) await this.store.saveUser(safeActorId, user);
      await persistTradeStateIfNeeded();
      return { error: "Solo quien creo la oferta puede cancelarla." };
    }

    const actorIdentity = normalizeUserMeta({
      username: user?.username || actorMeta?.username,
      displayName: user?.displayName || actorMeta?.displayName,
    });
    offer.proposerUsername = actorIdentity.username;
    offer.proposerDisplayName = actorIdentity.displayName;
    offer.status = "cancelled";
    offer.resolvedAt = new Date().toISOString();

    if (actorChanged) await this.store.saveUser(safeActorId, user);
    this.gachaState.tradeOffers = sortTradeOffers(offers);
    await this.store.saveGachaState(this.gachaState);
    return { offer };
  }

  async getNormalizedInventoryContext(userId, userMeta = {}) {
    const { user, changed: userChanged } = await this.syncUser(userId, userMeta);
    const boardById = buildCharacterByIdMap(this.getBoardCharacters());
    const byId = new Map([...boardById, ...this.characterById]);
    const { entries, normalizedInventory, changed: inventoryChanged } = buildInventoryEntries(
      user.inventory,
      byId
    );

    if (inventoryChanged) {
      user.inventory = normalizedInventory;
    }

    return {
      user,
      userChanged,
      entries,
      normalizedInventory,
      inventoryChanged,
    };
  }

  async getContractInfo(userId, userMeta = {}) {
    await this.ensureCharacterPool();
    const rules = this.getContractRules();
    const { user, userChanged, entries, normalizedInventory, inventoryChanged } =
      await this.getNormalizedInventoryContext(userId, userMeta);
    const rarityCounts = summarizeInventoryCountsByRarity(entries);
    const maxPerCommand = Math.max(1, Number(this.config.contractMaxPerCommand || 10));

    if (userChanged || inventoryChanged) {
      user.inventory = normalizedInventory;
      await this.store.saveUser(userId, user);
    }

    return {
      user,
      rarityCounts,
      maxPerCommand,
      rules: rules.map((rule) => {
        const availableCopies = rarityCounts[rule.from] || 0;
        return {
          ...rule,
          availableCopies,
          availableContracts: Math.floor(availableCopies / rule.cost),
        };
      }),
    };
  }

  async executeContract(userId, sourceRarity, contractsRequested = 1, userMeta = {}, options = {}) {
    await this.ensureCharacterPool();
    const source = String(sourceRarity || "")
      .trim()
      .toLowerCase();
    const manualMaterials = normalizeContractMaterialSelection(options?.materials);
    const selectionUsed = manualMaterials.length > 0;
    const rules = this.getContractRules();
    const rule = buildContractRuleMap(rules).get(source);
    if (!rule) {
      return { error: "Rareza invalida para contrato.", user: null };
    }

    const requestedContracts = Math.max(1, Math.floor(Number(contractsRequested || 1)));
    const maxPerCommand = Math.max(1, Number(this.config.contractMaxPerCommand || 10));
    const { user, userChanged, entries, normalizedInventory, inventoryChanged } =
      await this.getNormalizedInventoryContext(userId, userMeta);
    const rarityCounts = summarizeInventoryCountsByRarity(entries);
    const availableSourceCopies = rarityCounts[rule.from] || 0;
    const maxByInventory = Math.floor(availableSourceCopies / rule.cost);
    const executedContracts = Math.min(requestedContracts, maxPerCommand, maxByInventory);

    if (maxByInventory <= 0) {
      if (userChanged || inventoryChanged) {
        user.inventory = normalizedInventory;
        await this.store.saveUser(userId, user);
      }
      return {
        error: `Necesitas ${rule.cost} ${RARITY_LABELS[rule.from] || rule.from} para 1 contrato. Tienes ${availableSourceCopies}.`,
        user,
      };
    }

    let rewardPool = this.characters.filter(
      (character) => String(character?.rarity || "").toLowerCase() === rule.to
    );
    if (!rewardPool.length) {
      await this.ensureCharacterPool(true);
      rewardPool = this.characters.filter(
        (character) => String(character?.rarity || "").toLowerCase() === rule.to
      );
    }

    if (!rewardPool.length) {
      if (userChanged || inventoryChanged) {
        user.inventory = normalizedInventory;
        await this.store.saveUser(userId, user);
      }
      return {
        error: `No hay personajes ${RARITY_LABELS[rule.to] || rule.to} disponibles para contratos ahora mismo.`,
        user,
      };
    }

    const copiesToConsume = executedContracts * rule.cost;
    const consumption = selectionUsed
      ? applySelectedContractConsumption(
          normalizedInventory,
          rule.from,
          copiesToConsume,
          manualMaterials
        )
      : applyContractConsumption(normalizedInventory, rule.from, copiesToConsume);
    if (!consumption.ok) {
      return {
        error: consumption.error || "No se pudieron consumir las copias necesarias para el contrato.",
        user,
      };
    }

    const rewards = [];
    for (let index = 0; index < executedContracts; index += 1) {
      const picked = pickRandom(rewardPool);
      const reward = cloneCharacterSnapshot(picked);
      if (!reward) continue;
      upsertInventoryEntry(normalizedInventory, reward);
      rewards.push(reward);
    }

    user.inventory = normalizedInventory;
    await this.store.saveUser(userId, user);

    return {
      user,
      rule,
      requestedContracts,
      executedContracts,
      maxPerCommand,
      maxByInventory,
      consumedCopies: consumption.consumed,
      availableSourceCopies,
      remainingSourceCopies: Math.max(0, availableSourceCopies - consumption.consumed),
      consumedById: consumption.consumedById || [],
      selectionUsed,
      rewards,
    };
  }

  async roll(userId, userMeta = {}) {
    const multiResult = await this.rollMany(userId, 1, userMeta);
    if (multiResult.error) {
      return { error: multiResult.error, user: multiResult.user };
    }

    const first = multiResult.results[0] || {};
    return {
      character: first.character,
      user: multiResult.user,
      pityTriggered: Boolean(first.pityTriggered),
      pityHardTriggered: Boolean(first.mythicHardPityTriggered),
      pitySoftBonusPercent: Number(first.softPityBonusPercent || 0),
      pityThreshold: multiResult.pityThreshold,
      pitySoftThreshold: multiResult.pitySoftThreshold,
      pityCounter: multiResult.pityCounter,
    };
  }

  async rollMany(userId, count = 1, userMeta = {}) {
    await this.ensureBoard();
    const { user, changed } = await this.syncUser(userId, userMeta);
    const requested = Math.max(1, Math.floor(Number(count || 1)));

    if (user.rollsLeft <= 0) {
      if (changed) await this.store.saveUser(userId, user);
      return { error: "Sin tiradas disponibles por hoy.", user, requested, executed: 0, results: [] };
    }

    const board = this.getBoardCharacters();
    if (!board.length) {
      return { error: "No hay tablero activo para tirar.", user, requested, executed: 0, results: [] };
    }

    const executed = Math.min(requested, Math.max(0, user.rollsLeft));
    if (executed <= 0) {
      if (changed) await this.store.saveUser(userId, user);
      return { error: "Sin tiradas disponibles por hoy.", user, requested, executed: 0, results: [] };
    }

    const pityRules = this.getPityRules();
    const mythicSoftPityRolls = pityRules.mythicSoftPityRolls;
    const mythicHardPityRolls = pityRules.mythicHardPityRolls;
    const mythicHardPityTriggerAt = pityRules.mythicHardPityTriggerAt;
    const mythicSoftPityRateStepPercent = pityRules.mythicSoftPityRateStepPercent;
    const mythicPool = board.filter((item) => isMythic(item?.rarity));
    const results = [];
    let mythicHardPityTriggeredCount = 0;
    let mythicSoftPityActiveCount = 0;

    for (let index = 0; index < executed; index += 1) {
      const mythicPityCounterBefore = Math.max(0, Math.floor(Number(user.mythicPityCounter || 0)));
      const mythicHardPityTriggered =
        mythicPityCounterBefore >= mythicHardPityTriggerAt && mythicPool.length > 0;
      const softPityBonusPercent = mythicHardPityTriggered
        ? 0
        : buildSoftPityBonusPercent(
            mythicPityCounterBefore,
            mythicSoftPityRolls,
            mythicSoftPityRateStepPercent
          );

      let character = null;
      if (mythicHardPityTriggered) {
        mythicHardPityTriggeredCount += 1;
        character = weightedPick(mythicPool, (item) => item.dropWeight || 1);
      } else {
        const weightedBoard = new Map();
        for (const item of board) {
          weightedBoard.set(item, Math.max(0.05, Number(item?.dropWeight || 1)));
        }
        if (softPityBonusPercent > 0) {
          mythicSoftPityActiveCount += 1;
          applyChanceBoostToSubset(
            board,
            weightedBoard,
            (item) => isMythic(item?.rarity),
            softPityBonusPercent
          );
        }
        character = weightedPick(board, (item) => weightedBoard.get(item) || item.dropWeight || 1);
      }

      user.rollsLeft -= 1;
      user.totalRolls += 1;
      if (isMythic(character?.rarity)) {
        user.mythicPityCounter = 0;
      } else {
        user.mythicPityCounter = Math.min(
          mythicHardPityTriggerAt,
          Math.max(0, Math.floor(Number(user.mythicPityCounter || 0))) + 1
        );
      }
      user.pityCounter = user.mythicPityCounter;
      upsertInventoryEntry(user.inventory, character);
      results.push({
        character: cloneCharacterSnapshot(character),
        pityTriggered: mythicHardPityTriggered,
        mythicHardPityTriggered,
        softPityBonusPercent,
        mythicPityBefore: mythicPityCounterBefore,
        mythicPityAfter: user.mythicPityCounter,
      });
    }

    user.lastRollAt = new Date().toISOString();
    await this.store.saveUser(userId, user);

    return {
      user,
      requested,
      executed,
      results,
      pityTriggeredCount: mythicHardPityTriggeredCount,
      pityThreshold: mythicHardPityRolls,
      pitySoftThreshold: mythicSoftPityRolls,
      pityCounter: user.mythicPityCounter,
      mythicHardPityTriggeredCount,
      mythicSoftPityActiveCount,
      mythicPityCounter: user.mythicPityCounter,
      mythicPitySoftThreshold: mythicSoftPityRolls,
      mythicPityHardThreshold: mythicHardPityRolls,
    };
  }

  async getProfile(userId, userMeta = {}) {
    const { user, changed } = await this.syncUser(userId, userMeta);
    if (changed) await this.store.saveUser(userId, user);

    const { uniqueCount, totalCopies } = summarizeInventory(user.inventory);
    const pityRules = this.getPityRules();
    return {
      ...user,
      uniqueCount,
      totalCopies,
      pityCounter: user.mythicPityCounter,
      pityThreshold: pityRules.mythicHardPityRolls,
      pitySoftThreshold: pityRules.mythicSoftPityRolls,
      mythicPityCounter: user.mythicPityCounter,
      mythicPitySoftThreshold: pityRules.mythicSoftPityRolls,
      mythicPityHardThreshold: pityRules.mythicHardPityRolls,
    };
  }

  async claimDaily(userId, userMeta = {}) {
    const { user, changed } = await this.syncUser(userId, userMeta);
    const cooldownMs = this.config.dailyCooldownMinutes * 60 * 1000;
    const nowMs = Date.now();
    const lastClaimMs = user.lastDailyClaimAt ? Date.parse(user.lastDailyClaimAt) : 0;

    if (lastClaimMs && nowMs - lastClaimMs < cooldownMs) {
      if (changed) await this.store.saveUser(userId, user);
      return {
        error: "Aun no puedes reclamar el daily.",
        user,
        msRemaining: cooldownMs - (nowMs - lastClaimMs),
        nextClaimAt: new Date(lastClaimMs + cooldownMs).toISOString(),
      };
    }

    const bonus = this.config.dailyRollBonus;
    user.rollsLeft += bonus;
    user.lastDailyClaimAt = new Date(nowMs).toISOString();
    await this.store.saveUser(userId, user);

    return {
      user,
      bonus,
      nextClaimAt: new Date(nowMs + cooldownMs).toISOString(),
    };
  }

  async getInventory(userId, userMeta = {}) {
    const { user, userChanged, entries, normalizedInventory, inventoryChanged } =
      await this.getNormalizedInventoryContext(userId, userMeta);

    if (userChanged || inventoryChanged) {
      user.inventory = normalizedInventory;
      await this.store.saveUser(userId, user);
    }

    const sortedEntries = entries.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      const rarityDiff = rarityScore(b.character.rarity) - rarityScore(a.character.rarity);
      if (rarityDiff !== 0) return rarityDiff;
      return a.character.name.localeCompare(b.character.name);
    });

    return { user, entries: sortedEntries };
  }

  async findCharacter(query) {
    const input = String(query || "").trim();
    if (!input) return null;

    const board = this.getBoardCharacters();
    if (/^\d+$/.test(input)) {
      const index = Number(input) - 1;
      if (index >= 0 && index < board.length) return board[index];
      return null;
    }

    const boardMatch = findBestCharacterMatch(input, board);
    if (boardMatch) return boardMatch;

    const searched = await searchCharactersByQuery(input, 20);
    const searchedMatch = findBestCharacterMatch(input, searched) || searched[0] || null;
    if (!searchedMatch) return null;

    return cloneCharacterSnapshot(searchedMatch);
  }

  async getCharacterDetails(query) {
    await this.ensureBoard();

    const character = await this.findCharacter(query);
    if (!character) {
      return { error: "No encontre ese personaje. Usa `!gacha list` para ver posiciones." };
    }

    let images = [];
    try {
      images = await fetchCharacterGallery(character, 24);
    } catch (error) {
      console.error("[Gacha] could not fetch character gallery:", error.message);
    }

    return { character, images };
  }

  async refreshBoard() {
    const currentBoardUpdatedAt = this.gachaState.boardUpdatedAt;
    const prefetchedBoard =
      this.nextBoardPrefetch &&
      this.nextBoardPrefetch.baseBoardUpdatedAt === currentBoardUpdatedAt &&
      Array.isArray(this.nextBoardPrefetch.characters) &&
      this.nextBoardPrefetch.characters.length > 0
        ? this.nextBoardPrefetch.characters
        : null;

    if (prefetchedBoard) {
      console.log("[Gacha] refreshboard using prefetched board");
      return this.saveBoardState(prefetchedBoard);
    }

    return this.ensureBoard(true);
  }
}

module.exports = {
  GachaEngine,
  RARITY_LABELS,
  RARITY_COLORS,
  RARITY_MARKERS,
};
