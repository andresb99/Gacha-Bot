const {
  fetchCharacterImagesFromJikan,
  FALLBACK_CHARACTERS,
} = require("./jikanClient");
const {
  fetchTopCharactersFromAniList,
  searchCharactersFromAniList,
  searchCharacterImagesFromAniList,
} = require("./anilistClient");

function toUniqueUrls(urls) {
  const seen = new Set();
  const result = [];
  for (const entry of urls || []) {
    const url = String(entry || "").trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    result.push(url);
  }
  return result;
}

function sanitizeCharacter(character) {
  const imageUrls = toUniqueUrls([character?.imageUrl, ...(character?.imageUrls || [])]);
  return {
    id: String(character?.id || ""),
    source: String(character?.source || "unknown"),
    sourceIds:
      character?.sourceIds && typeof character.sourceIds === "object" ? character.sourceIds : {},
    sources: Array.isArray(character?.sources)
      ? character.sources.filter(Boolean)
      : [String(character?.source || "unknown")],
    name: String(character?.name || "Personaje desconocido"),
    anime: String(character?.anime || "Anime desconocido"),
    imageUrl: imageUrls[0] || null,
    imageUrls,
    favorites: Number(character?.favorites || 0),
    popularityRank: Number(character?.popularityRank || 0),
  };
}

function hasKnownAnime(character) {
  const anime = String(character?.anime || "")
    .trim()
    .toLowerCase();
  if (!anime) return false;
  return !["anime desconocido", "unknown anime", "desconocido", "unknown"].includes(anime);
}

async function fetchCharacterPool(targetCount) {
  const safeTarget = Math.max(1, Number(targetCount || 1));
  try {
    const fetchTarget = Math.max(safeTarget, Math.min(5000, safeTarget * 2));
    const anilistCharacters = await fetchTopCharactersFromAniList(fetchTarget);
    const normalized = (anilistCharacters || [])
      .map((character) => sanitizeCharacter(character))
      .filter((character) => character?.id);
    const withKnownAnime = normalized.filter((character) => hasKnownAnime(character));
    if (withKnownAnime.length > 0) return withKnownAnime.slice(0, safeTarget);
    if (normalized.length > 0) return normalized.slice(0, safeTarget);
  } catch (error) {
    console.warn(`[Catalog] AniList pool fetch failed: ${error.message}`);
  }

  return FALLBACK_CHARACTERS.slice(0, safeTarget).map((character) => sanitizeCharacter(character));
}

function sortByRanking(characters) {
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

async function fetchTopRankedCharacters(limit = 250) {
  const safeLimit = Math.max(1, Math.min(250, Number(limit || 250)));
  try {
    const anilistCharacters = await fetchTopCharactersFromAniList(safeLimit);
    const normalized = (anilistCharacters || [])
      .map((character) => sanitizeCharacter(character))
      .filter((character) => character?.id);
    return sortByRanking(normalized).slice(0, safeLimit);
  } catch (error) {
    console.warn(`[Catalog] AniList top ranked fetch failed: ${error.message}`);
    return [];
  }
}

async function searchCharactersByQuery(query, limit = 20) {
  const safeQuery = String(query || "").trim();
  if (!safeQuery) return [];

  const safeLimit = Math.max(1, Number(limit || 20));
  const anilistLimit = Math.max(safeLimit, Math.min(50, safeLimit * 2));
  try {
    const anilistMatches = await searchCharactersFromAniList(safeQuery, anilistLimit);
    const normalized = (anilistMatches || [])
      .map((character) => sanitizeCharacter(character))
      .filter((character) => character?.id);
    const withKnownAnime = normalized.filter((character) => hasKnownAnime(character));
    const prioritized = withKnownAnime.length > 0 ? withKnownAnime : normalized;
    return prioritized.slice(0, safeLimit);
  } catch (error) {
    console.warn(`[Catalog] AniList search failed for "${safeQuery}": ${error.message}`);
    return [];
  }
}

async function fetchCharacterGallery(character, limit = 24) {
  const safeLimit = Math.max(1, Number(limit || 1));
  const links = [];
  const seen = new Set();

  function addLinks(inputLinks) {
    for (const entry of inputLinks || []) {
      const url = String(entry?.url || "").trim();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      links.push({
        url,
        source: String(entry?.source || "Fuente desconocida"),
      });
      if (links.length >= safeLimit) break;
    }
  }

  addLinks([
    ...(character?.imageUrls || []).map((url) => ({ url, source: "Pool" })),
    character?.imageUrl ? { url: character.imageUrl, source: "Pool" } : null,
  ]);

  const [jikanResult, anilistResult] = await Promise.allSettled([
    fetchCharacterImagesFromJikan(character, safeLimit),
    searchCharacterImagesFromAniList(character?.name || "", safeLimit, character?.anime || ""),
  ]);

  if (jikanResult.status === "fulfilled") addLinks(jikanResult.value);
  if (anilistResult.status === "fulfilled") addLinks(anilistResult.value);

  return links.slice(0, safeLimit);
}

module.exports = {
  fetchCharacterPool,
  fetchTopRankedCharacters,
  searchCharactersByQuery,
  fetchCharacterGallery,
};
