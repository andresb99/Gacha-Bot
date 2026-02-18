const fs = require("fs/promises");
const admin = require("firebase-admin");

const DEFAULT_GACHA_STATE = {
  boardCharacters: [],
  boardCharacterIds: [],
  boardUpdatedAt: null,
  poolUpdatedAt: null,
  mythicCharacters: [],
  mythicCatalogUpdatedAt: null,
  tradeOffers: [],
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
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

function mergeCharacterSnapshots(current, incoming) {
  const existing = normalizeCharacterSnapshot(current);
  const next = normalizeCharacterSnapshot(incoming);
  if (!existing) return next;
  if (!next) return existing;

  const imageUrls = toUniqueUrls([
    ...(existing.imageUrls || []),
    existing.imageUrl,
    ...(next.imageUrls || []),
    next.imageUrl,
  ]);
  const sources = Array.from(new Set([...(existing.sources || []), ...(next.sources || [])]));
  const sourceIds = {
    ...(existing.sourceIds || {}),
    ...(next.sourceIds || {}),
  };

  return {
    ...existing,
    ...next,
    imageUrl: imageUrls[0] || existing.imageUrl || next.imageUrl || null,
    imageUrls,
    favorites: Math.max(existing.favorites || 0, next.favorites || 0),
    popularityRank:
      Math.max(existing.popularityRank || 0, next.popularityRank || 0) ||
      Number(existing.popularityRank || next.popularityRank || 0),
    sources,
    sourceIds,
  };
}

function normalizeCharacterSnapshot(rawCharacter) {
  if (!rawCharacter || typeof rawCharacter !== "object") return null;
  const imageUrls = toUniqueUrls([rawCharacter.imageUrl, ...(rawCharacter.imageUrls || [])]);
  const id = String(rawCharacter.id || "").trim();
  if (!id) return null;

  return {
    id,
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

function normalizeInventory(rawInventory) {
  if (!rawInventory || typeof rawInventory !== "object" || Array.isArray(rawInventory)) return {};

  const normalized = {};
  for (const [id, value] of Object.entries(rawInventory)) {
    const key = String(id);

    if (typeof value === "number") {
      const count = Math.max(0, Math.floor(value));
      if (count > 0) normalized[key] = count;
      continue;
    }

    if (!value || typeof value !== "object") {
      continue;
    }

    const count = Math.max(0, Math.floor(Number(value.count || 0)));
    if (count <= 0) continue;

    normalized[key] = {
      count,
      character: normalizeCharacterSnapshot(value.character),
    };
  }

  return normalized;
}

function normalizeUser(rawUser) {
  if (!rawUser || typeof rawUser !== "object") return null;
  const legacyPityCounter = Math.max(0, Math.floor(Number(rawUser.pityCounter || 0)));
  const legendaryPityCounter = Math.max(
    0,
    Math.floor(Number(rawUser.legendaryPityCounter ?? legacyPityCounter))
  );
  const mythicPityCounter = Math.max(
    0,
    Math.floor(Number(rawUser.mythicPityCounter ?? legacyPityCounter))
  );
  return {
    username:
      typeof rawUser.username === "string" && rawUser.username.trim()
        ? rawUser.username.trim()
        : null,
    displayName:
      typeof rawUser.displayName === "string" && rawUser.displayName.trim()
        ? rawUser.displayName.trim()
        : null,
    lastReset: rawUser.lastReset || null,
    rollsLeft: Number(rawUser.rollsLeft || 0),
    totalRolls: Number(rawUser.totalRolls || 0),
    pityCounter: mythicPityCounter,
    legendaryPityCounter,
    mythicPityCounter,
    inventory: normalizeInventory(rawUser.inventory),
    lastRollAt: rawUser.lastRollAt || null,
    lastDailyClaimAt: rawUser.lastDailyClaimAt || null,
  };
}

function normalizePrivateKey(value) {
  if (!value || typeof value !== "string") return "";

  let key = value.trim();
  const wrappedInDoubleQuotes = key.startsWith('"') && key.endsWith('"');
  const wrappedInSingleQuotes = key.startsWith("'") && key.endsWith("'");

  if (wrappedInDoubleQuotes || wrappedInSingleQuotes) {
    key = key.slice(1, -1);
  }

  // Support keys serialized as \\n (double escaped) and \n (single escaped).
  key = key.replace(/\\\\n/g, "\n");
  key = key.replace(/\\n/g, "\n");
  key = key.replace(/\\r/g, "\r");

  return key;
}

class FirestoreStore {
  constructor(firebaseConfig) {
    this.firebaseConfig = firebaseConfig;
    this.db = null;
    this.gachaStateRef = null;
    this.usersCollectionRef = null;
    this.userCache = new Map();
  }

  async init() {
    await this.initApp();
    this.db = admin.firestore();
    this.gachaStateRef = this.db.collection("gacha").doc("state");
    this.usersCollectionRef = this.db.collection("gacha_users");

    await this.ensureDoc(this.gachaStateRef, DEFAULT_GACHA_STATE);
  }

  async initApp() {
    if (admin.apps.length > 0) return;

    const credential = await this.resolveCredential();
    const options = {};
    if (credential) options.credential = credential;
    if (this.firebaseConfig.projectId) options.projectId = this.firebaseConfig.projectId;
    if (this.firebaseConfig.databaseURL) options.databaseURL = this.firebaseConfig.databaseURL;
    if (this.firebaseConfig.storageBucket) options.storageBucket = this.firebaseConfig.storageBucket;

    admin.initializeApp(options);
  }

  async resolveCredential() {
    if (this.firebaseConfig.serviceAccountPath) {
      try {
        const serviceAccountRaw = await fs.readFile(this.firebaseConfig.serviceAccountPath, "utf8");
        const serviceAccount = JSON.parse(serviceAccountRaw);
        return admin.credential.cert(serviceAccount);
      } catch (error) {
        throw new Error(`No se pudo leer FIREBASE_SERVICE_ACCOUNT_PATH: ${error.message}`);
      }
    }

    if (
      this.firebaseConfig.projectId &&
      this.firebaseConfig.clientEmail &&
      this.firebaseConfig.privateKey
    ) {
      return admin.credential.cert({
        projectId: this.firebaseConfig.projectId,
        clientEmail: this.firebaseConfig.clientEmail,
        privateKey: normalizePrivateKey(this.firebaseConfig.privateKey),
      });
    }

    return admin.credential.applicationDefault();
  }

  async ensureDoc(docRef, defaultValue) {
    const snapshot = await docRef.get();
    if (!snapshot.exists) {
      await docRef.set(defaultValue, { merge: false });
    }
  }

  async getGachaState() {
    const snapshot = await this.gachaStateRef.get();
    const data = snapshot.exists ? snapshot.data() : {};
    return {
      ...DEFAULT_GACHA_STATE,
      ...(data || {}),
    };
  }

  async saveGachaState(gachaState) {
    await this.gachaStateRef.set(gachaState, { merge: false });
  }

  async getUser(userId) {
    const key = String(userId);
    if (this.userCache.has(key)) {
      return clone(this.userCache.get(key));
    }

    const snapshot = await this.usersCollectionRef.doc(key).get();
    if (!snapshot.exists) return null;

    const user = normalizeUser(snapshot.data());
    this.userCache.set(key, clone(user));
    return clone(user);
  }

  async saveUser(userId, user) {
    const key = String(userId);
    const normalized = normalizeUser(user);
    this.userCache.set(key, clone(normalized));
    await this.usersCollectionRef.doc(key).set(normalized, { merge: false });
  }

  async getAllUsers() {
    const snapshot = await this.usersCollectionRef.get();
    const users = [];

    snapshot.forEach((doc) => {
      const userId = String(doc.id);
      const normalized = normalizeUser(doc.data());
      this.userCache.set(userId, clone(normalized));
      users.push({
        userId,
        user: clone(normalized),
      });
    });

    return users;
  }

  async getInventoryCharacterSnapshots() {
    const snapshot = await this.usersCollectionRef.get();
    const byId = new Map();

    snapshot.forEach((doc) => {
      const user = normalizeUser(doc.data());
      const inventory = user?.inventory || {};
      for (const value of Object.values(inventory)) {
        if (!value || typeof value !== "object") continue;
        const snapshotCharacter = normalizeCharacterSnapshot(value.character);
        if (!snapshotCharacter) continue;

        const existing = byId.get(snapshotCharacter.id);
        byId.set(
          snapshotCharacter.id,
          existing ? mergeCharacterSnapshots(existing, snapshotCharacter) : snapshotCharacter
        );
      }
    });

    return [...byId.values()];
  }
}

module.exports = {
  FirestoreStore,
};
