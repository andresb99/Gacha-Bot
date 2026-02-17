const axios = require("axios");

const JIKAN_BASE_URL = "https://api.jikan.moe/v4";
const PAGE_SIZE = 25;
const JIKAN_REQUEST_TIMEOUT_MS = 15000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractJikanImageUrl(rawImage) {
  return rawImage?.webp?.image_url || rawImage?.jpg?.image_url || null;
}

function mapCharacter(rawCharacter, fallbackRank) {
  const animeName =
    rawCharacter.anime?.[0]?.anime?.title ||
    rawCharacter.anime?.[0]?.anime?.title_english ||
    "Anime desconocido";
  const imageUrl = extractJikanImageUrl(rawCharacter.images);
  const malId = Number(rawCharacter.mal_id || 0);

  return {
    id: `mal_${malId}`,
    source: "jikan",
    sourceIds: { malId },
    name: rawCharacter.name || "Personaje desconocido",
    anime: animeName,
    imageUrl,
    imageUrls: imageUrl ? [imageUrl] : [],
    favorites: Number(rawCharacter.favorites || 0),
    popularityRank: Number(rawCharacter.rank || fallbackRank),
  };
}

async function fetchTopCharacters(targetCount) {
  const unique = new Set();
  const result = [];

  for (let page = 1; result.length < targetCount; page += 1) {
    const response = await axios.get(`${JIKAN_BASE_URL}/top/characters`, {
      params: { page, limit: PAGE_SIZE },
      timeout: JIKAN_REQUEST_TIMEOUT_MS,
    });
    const list = response.data?.data || [];
    if (!list.length) break;

    for (const rawCharacter of list) {
      if (!rawCharacter?.mal_id) continue;
      const id = `mal_${rawCharacter.mal_id}`;
      if (unique.has(id)) continue;
      unique.add(id);
      result.push(mapCharacter(rawCharacter, result.length + 1));
      if (result.length >= targetCount) break;
    }

    await sleep(450);
  }

  return result;
}

async function searchCharactersFromJikan(query, limit = 25) {
  const safeQuery = String(query || "").trim();
  if (!safeQuery) return [];

  const safeLimit = Math.max(1, Math.min(Number(limit || 25), 25));
  const response = await axios.get(`${JIKAN_BASE_URL}/characters`, {
    params: { q: safeQuery, limit: safeLimit, order_by: "favorites", sort: "desc" },
    timeout: JIKAN_REQUEST_TIMEOUT_MS,
  });

  const list = response.data?.data || [];
  const unique = new Set();
  const result = [];
  for (const rawCharacter of list) {
    if (!rawCharacter?.mal_id) continue;
    const id = `mal_${rawCharacter.mal_id}`;
    if (unique.has(id)) continue;
    unique.add(id);
    result.push(mapCharacter(rawCharacter, result.length + 1));
  }

  return result;
}

function parseMalId(character) {
  if (typeof character?.sourceIds?.malId === "number" && character.sourceIds.malId > 0) {
    return character.sourceIds.malId;
  }

  const id = String(character?.id || "");
  const match = id.match(/^mal_(\d+)$/);
  return match ? Number(match[1]) : null;
}

async function fetchCharacterPicturesByMalId(malId) {
  if (!malId) return [];

  const response = await axios.get(`${JIKAN_BASE_URL}/characters/${malId}/pictures`, {
    timeout: JIKAN_REQUEST_TIMEOUT_MS,
  });

  const list = response.data?.data || [];
  return list.map((image) => extractJikanImageUrl(image)).filter(Boolean);
}

function hasNameMatch(rawCharacter, searchName) {
  const normalizedSearch = normalizeText(searchName);
  if (!normalizedSearch) return false;
  const normalizedCandidate = normalizeText(rawCharacter?.name);
  if (!normalizedCandidate) return false;

  return (
    normalizedCandidate === normalizedSearch ||
    normalizedCandidate.includes(normalizedSearch) ||
    normalizedSearch.includes(normalizedCandidate)
  );
}

function hasAnimeMatch(rawCharacter, animeName) {
  const normalizedAnime = normalizeText(animeName);
  if (
    !normalizedAnime ||
    normalizedAnime === "anime desconocido" ||
    normalizedAnime === "unknown anime" ||
    normalizedAnime === "desconocido" ||
    normalizedAnime === "unknown"
  ) {
    return true;
  }

  const animeTitles = (rawCharacter?.anime || [])
    .flatMap((entry) => [entry?.anime?.title, entry?.anime?.title_english, entry?.anime?.title_japanese])
    .map((title) => normalizeText(title))
    .filter(Boolean);
  if (!animeTitles.length) return false;

  return animeTitles.some(
    (title) => title === normalizedAnime || title.includes(normalizedAnime) || normalizedAnime.includes(title)
  );
}

async function searchCharacterImagesByName(name, animeName, limit = 8) {
  if (!name) return [];

  const response = await axios.get(`${JIKAN_BASE_URL}/characters`, {
    params: { q: name, limit: Math.max(1, Math.min(limit, 25)), order_by: "favorites", sort: "desc" },
    timeout: JIKAN_REQUEST_TIMEOUT_MS,
  });

  const list = response.data?.data || [];
  const matches = list.filter(
    (rawCharacter) => hasNameMatch(rawCharacter, name) && hasAnimeMatch(rawCharacter, animeName)
  );
  return matches.map((rawCharacter) => extractJikanImageUrl(rawCharacter.images)).filter(Boolean);
}

async function fetchCharacterImagesFromJikan(character, limit = 24) {
  const links = [];
  const seen = new Set();

  function addLinks(urls) {
    for (const url of urls) {
      const value = String(url || "").trim();
      if (!value || seen.has(value)) continue;
      seen.add(value);
      links.push({ url: value, source: "Jikan" });
      if (links.length >= limit) break;
    }
  }

  if (character?.imageUrl) {
    addLinks([character.imageUrl]);
  }

  const malId = parseMalId(character);
  let fetchedById = false;
  if (malId && links.length < limit) {
    try {
      const idLinks = await fetchCharacterPicturesByMalId(malId);
      if (idLinks.length > 0) {
        fetchedById = true;
      }
      addLinks(idLinks);
    } catch (error) {
      // Ignore source failures and continue with remaining providers.
    }
  }

  if (!fetchedById && character?.name && links.length < limit) {
    try {
      addLinks(await searchCharacterImagesByName(character.name, character?.anime, limit));
    } catch (error) {
      // Ignore source failures and continue with remaining providers.
    }
  }

  return links;
}

const FALLBACK_CHARACTERS = [
  {
    id: "fallback_1",
    source: "fallback",
    sourceIds: {},
    name: "Saber",
    anime: "Fate/stay night",
    imageUrl: "https://placehold.co/600x900/png?text=Saber",
    imageUrls: ["https://placehold.co/600x900/png?text=Saber"],
    favorites: 120000,
    popularityRank: 1,
  },
  {
    id: "fallback_2",
    source: "fallback",
    sourceIds: {},
    name: "Lelouch Lamperouge",
    anime: "Code Geass",
    imageUrl: "https://placehold.co/600x900/png?text=Lelouch",
    imageUrls: ["https://placehold.co/600x900/png?text=Lelouch"],
    favorites: 100000,
    popularityRank: 2,
  },
  {
    id: "fallback_3",
    source: "fallback",
    sourceIds: {},
    name: "Rem",
    anime: "Re:Zero",
    imageUrl: "https://placehold.co/600x900/png?text=Rem",
    imageUrls: ["https://placehold.co/600x900/png?text=Rem"],
    favorites: 90000,
    popularityRank: 3,
  },
  {
    id: "fallback_4",
    source: "fallback",
    sourceIds: {},
    name: "Mikasa Ackerman",
    anime: "Shingeki no Kyojin",
    imageUrl: "https://placehold.co/600x900/png?text=Mikasa",
    imageUrls: ["https://placehold.co/600x900/png?text=Mikasa"],
    favorites: 80000,
    popularityRank: 4,
  },
  {
    id: "fallback_5",
    source: "fallback",
    sourceIds: {},
    name: "Gojo Satoru",
    anime: "Jujutsu Kaisen",
    imageUrl: "https://placehold.co/600x900/png?text=Gojo",
    imageUrls: ["https://placehold.co/600x900/png?text=Gojo"],
    favorites: 70000,
    popularityRank: 5,
  },
  {
    id: "fallback_6",
    source: "fallback",
    sourceIds: {},
    name: "Rias Gremory",
    anime: "High School DxD",
    imageUrl: "https://placehold.co/600x900/png?text=Rias",
    imageUrls: ["https://placehold.co/600x900/png?text=Rias"],
    favorites: 60000,
    popularityRank: 6,
  },
  {
    id: "fallback_7",
    source: "fallback",
    sourceIds: {},
    name: "Mai Sakurajima",
    anime: "Seishun Buta Yarou",
    imageUrl: "https://placehold.co/600x900/png?text=Mai",
    imageUrls: ["https://placehold.co/600x900/png?text=Mai"],
    favorites: 50000,
    popularityRank: 7,
  },
  {
    id: "fallback_8",
    source: "fallback",
    sourceIds: {},
    name: "Zero Two",
    anime: "Darling in the Franxx",
    imageUrl: "https://placehold.co/600x900/png?text=Zero+Two",
    imageUrls: ["https://placehold.co/600x900/png?text=Zero+Two"],
    favorites: 40000,
    popularityRank: 8,
  },
  {
    id: "fallback_9",
    source: "fallback",
    sourceIds: {},
    name: "Power",
    anime: "Chainsaw Man",
    imageUrl: "https://placehold.co/600x900/png?text=Power",
    imageUrls: ["https://placehold.co/600x900/png?text=Power"],
    favorites: 30000,
    popularityRank: 9,
  },
  {
    id: "fallback_10",
    source: "fallback",
    sourceIds: {},
    name: "Violet Evergarden",
    anime: "Violet Evergarden",
    imageUrl: "https://placehold.co/600x900/png?text=Violet",
    imageUrls: ["https://placehold.co/600x900/png?text=Violet"],
    favorites: 20000,
    popularityRank: 10,
  },
];

module.exports = {
  fetchTopCharacters,
  fetchTopCharactersFromJikan: fetchTopCharacters,
  searchCharactersFromJikan,
  fetchCharacterImagesFromJikan,
  FALLBACK_CHARACTERS,
};
