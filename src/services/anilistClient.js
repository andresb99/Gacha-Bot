const axios = require("axios");

const ANILIST_API_URL = "https://graphql.anilist.co";
const ANILIST_REQUEST_TIMEOUT_MS = 15000;
const PAGE_SIZE = 50;
const ANILIST_MAX_RETRIES = 4;
const ANILIST_RETRY_BASE_MS = 800;
const ANILIST_RANDOM_TOP_PAGE_LIMIT = 300;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shuffle(items) {
  const array = [...(items || [])];
  for (let index = array.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [array[index], array[swapIndex]] = [array[swapIndex], array[index]];
  }
  return array;
}

function buildPagePlan(lastPage, pagesNeeded) {
  const safeLastPage = Math.max(1, Math.floor(Number(lastPage || 1)));
  const safePagesNeeded = Math.max(1, Math.floor(Number(pagesNeeded || 1)));
  const plan = [];
  const seen = new Set();

  function pushPage(page) {
    const safePage = Math.max(1, Math.min(safeLastPage, Math.floor(Number(page || 1))));
    if (seen.has(safePage)) return;
    seen.add(safePage);
    plan.push(safePage);
  }

  // Seed with high-popularity pages to ensure quality and avoid ultra-obscure-only pools.
  pushPage(1);
  if (safeLastPage >= 6) pushPage(6);

  const randomWindowLastPage = Math.max(
    1,
    Math.min(safeLastPage, ANILIST_RANDOM_TOP_PAGE_LIMIT)
  );
  const randomCandidates = [];
  for (let page = 1; page <= randomWindowLastPage; page += 1) {
    if (seen.has(page)) continue;
    randomCandidates.push(page);
  }

  for (const page of shuffle(randomCandidates)) {
    if (plan.length >= safePagesNeeded) break;
    pushPage(page);
  }

  if (plan.length < safePagesNeeded) {
    const remaining = [];
    for (let page = randomWindowLastPage + 1; page <= safeLastPage; page += 1) {
      if (seen.has(page)) continue;
      remaining.push(page);
    }
    for (const page of shuffle(remaining)) {
      if (plan.length >= safePagesNeeded) break;
      pushPage(page);
    }
  }

  return plan.slice(0, safePagesNeeded);
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function hasTextMatch(candidate, query) {
  const normalizedCandidate = normalizeText(candidate);
  const normalizedQuery = normalizeText(query);
  if (!normalizedCandidate || !normalizedQuery) return false;
  return (
    normalizedCandidate === normalizedQuery ||
    normalizedCandidate.includes(normalizedQuery) ||
    normalizedQuery.includes(normalizedCandidate)
  );
}

function preferredAnimeTitle(titleNode) {
  return titleNode?.english || titleNode?.romaji || titleNode?.native || "";
}

function pickAnimeTitleFromMediaNodes(mediaNodes) {
  for (const media of mediaNodes || []) {
    const title = preferredAnimeTitle(media?.title);
    if (String(title || "").trim()) {
      return title;
    }
  }
  return "Anime desconocido";
}

function mapAniListCharacter(rawCharacter, popularityRank) {
  const imageUrl = rawCharacter?.image?.large || rawCharacter?.image?.medium || null;
  const animeTitle = pickAnimeTitleFromMediaNodes(rawCharacter?.media?.nodes);
  const anilistId = Number(rawCharacter?.id || 0);

  return {
    id: `anilist_${anilistId}`,
    source: "anilist",
    sourceIds: { anilistId },
    name: rawCharacter?.name?.full || rawCharacter?.name?.native || "Personaje desconocido",
    anime: animeTitle,
    imageUrl,
    imageUrls: imageUrl ? [imageUrl] : [],
    favorites: Number(rawCharacter?.favourites || 0),
    popularityRank: Number(popularityRank || 0),
  };
}

async function requestAniList(query, variables) {
  function isRetriableError(error) {
    if (!error) return false;
    if (error.retriable === true) return true;

    const status = Number(error?.response?.status || 0);
    if (status === 429 || status >= 500) return true;

    const code = String(error?.code || "").toUpperCase();
    if (["ETIMEDOUT", "ECONNABORTED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN"].includes(code)) {
      return true;
    }

    const message = String(error?.message || "").toLowerCase();
    if (message.includes("rate limit") || message.includes("too many requests")) return true;
    return false;
  }

  function retryDelayMs(error, attempt) {
    const retryAfterHeader = error?.response?.headers?.["retry-after"];
    const retryAfterSeconds = Number.parseInt(String(retryAfterHeader || ""), 10);
    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
      return retryAfterSeconds * 1000;
    }

    return Math.min(10000, ANILIST_RETRY_BASE_MS * Math.pow(2, Math.max(0, attempt - 1)));
  }

  let lastError = null;
  for (let attempt = 1; attempt <= ANILIST_MAX_RETRIES; attempt += 1) {
    try {
      const response = await axios.post(
        ANILIST_API_URL,
        { query, variables },
        {
          timeout: ANILIST_REQUEST_TIMEOUT_MS,
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "User-Agent": "gacha-bot/1.0",
          },
        }
      );

      if (Array.isArray(response.data?.errors) && response.data.errors.length > 0) {
        const message = response.data.errors[0].message || "AniList request failed";
        const graphError = new Error(message);
        graphError.retriable =
          /rate limit|too many requests|internal|temporarily unavailable/i.test(String(message));
        throw graphError;
      }

      return response.data?.data || {};
    } catch (error) {
      lastError = error;
      const shouldRetry = attempt < ANILIST_MAX_RETRIES && isRetriableError(error);
      if (!shouldRetry) {
        throw error;
      }
      await sleep(retryDelayMs(error, attempt));
    }
  }

  throw lastError || new Error("AniList request failed");
}

const TOP_CHARACTERS_QUERY = `
  query TopCharacters($page: Int!, $perPage: Int!) {
    Page(page: $page, perPage: $perPage) {
      pageInfo {
        currentPage
        lastPage
        hasNextPage
      }
      characters(sort: [FAVOURITES_DESC]) {
        id
        name {
          full
          native
        }
        image {
          large
          medium
        }
        favourites
        media(perPage: 3, type: ANIME, sort: [POPULARITY_DESC]) {
          nodes {
            title {
              romaji
              english
              native
            }
          }
        }
      }
    }
  }
`;

async function fetchTopCharactersFromAniList(targetCount) {
  const safeTarget = Math.max(1, Math.floor(Number(targetCount || 1)));
  const result = [];
  const seenCharacterIds = new Set();
  const perPage = Math.max(1, Math.min(PAGE_SIZE, safeTarget));

  let metadata;
  try {
    metadata = await requestAniList(TOP_CHARACTERS_QUERY, {
      page: 1,
      perPage: 1,
    });
  } catch (error) {
    throw error;
  }

  const lastPage = Math.max(1, Number(metadata?.Page?.pageInfo?.lastPage || 1));
  const pagesNeeded = Math.max(1, Math.ceil(safeTarget / perPage));
  const primaryPlan = buildPagePlan(lastPage, pagesNeeded);
  const fetchedPages = new Set();

  async function consumePage(page) {
    const safePage = Math.max(1, Math.floor(Number(page || 1)));
    if (fetchedPages.has(safePage) || result.length >= safeTarget) return;
    fetchedPages.add(safePage);

    let data;
    try {
      data = await requestAniList(TOP_CHARACTERS_QUERY, {
        page: safePage,
        perPage,
      });
    } catch (error) {
      if (result.length > 0) {
        console.warn(
          `[AniList] top characters interrupted on page ${safePage}. Returning partial (${result.length}). Reason: ${error.message}`
        );
        return;
      }
      throw error;
    }

    const list = data?.Page?.characters || [];
    if (!Array.isArray(list) || list.length === 0) return;

    for (let listIndex = 0; listIndex < list.length; listIndex += 1) {
      const rawCharacter = list[listIndex];
      const characterId = Number(rawCharacter?.id || 0);
      if (!characterId || seenCharacterIds.has(characterId)) continue;
      seenCharacterIds.add(characterId);
      const globalRank = (safePage - 1) * perPage + listIndex + 1;
      result.push(mapAniListCharacter(rawCharacter, globalRank));
      if (result.length >= safeTarget) break;
    }
  }

  for (const page of primaryPlan) {
    await consumePage(page);
    if (result.length >= safeTarget) break;
    await sleep(350);
  }

  if (result.length < safeTarget && fetchedPages.size < lastPage) {
    const remainingPages = [];
    for (let page = 1; page <= lastPage; page += 1) {
      if (fetchedPages.has(page)) continue;
      remainingPages.push(page);
    }

    const missingPagesEstimate = Math.max(1, Math.ceil((safeTarget - result.length) / perPage));
    const fallbackPlan = shuffle(remainingPages).slice(0, missingPagesEstimate + 2);

    for (const page of fallbackPlan) {
      await consumePage(page);
      if (result.length >= safeTarget) break;
      await sleep(350);
    }
  }

  return result.slice(0, safeTarget);
}

const SEARCH_TOP_CHARACTERS_QUERY = `
  query SearchTopCharacters($search: String!, $page: Int!, $perPage: Int!) {
    Page(page: $page, perPage: $perPage) {
      characters(search: $search, sort: [FAVOURITES_DESC]) {
        id
        name {
          full
          native
        }
        image {
          large
          medium
        }
        favourites
        media(perPage: 3, type: ANIME, sort: [POPULARITY_DESC]) {
          nodes {
            title {
              romaji
              english
              native
            }
          }
        }
      }
    }
  }
`;

async function searchCharactersFromAniList(query, limit = 25) {
  const safeQuery = String(query || "").trim();
  if (!safeQuery) return [];

  const safeLimit = Math.max(1, Math.min(Number(limit || 25), 50));
  const data = await requestAniList(SEARCH_TOP_CHARACTERS_QUERY, {
    search: safeQuery,
    page: 1,
    perPage: safeLimit,
  });

  const list = data?.Page?.characters || [];
  const result = [];
  const unique = new Set();
  for (const rawCharacter of list) {
    if (!rawCharacter?.id) continue;
    const id = `anilist_${rawCharacter.id}`;
    if (unique.has(id)) continue;
    unique.add(id);
    result.push(mapAniListCharacter(rawCharacter, result.length + 1));
    if (result.length >= safeLimit) break;
  }

  return result;
}

const SEARCH_CHARACTER_QUERY = `
  query SearchCharacters($search: String!, $page: Int!, $perPage: Int!) {
    Page(page: $page, perPage: $perPage) {
      characters(search: $search, sort: [FAVOURITES_DESC]) {
        name {
          full
          native
        }
        image {
          large
          medium
        }
        media(perPage: 3, type: ANIME, sort: [POPULARITY_DESC]) {
          nodes {
            title {
              romaji
              english
              native
            }
          }
        }
      }
    }
  }
`;

function matchesCharacterAndAnime(rawCharacter, name, animeName) {
  const nameMatch =
    hasTextMatch(rawCharacter?.name?.full, name) || hasTextMatch(rawCharacter?.name?.native, name);
  if (!nameMatch) return false;

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

  const animeTitles = (rawCharacter?.media?.nodes || [])
    .flatMap((media) => [media?.title?.english, media?.title?.romaji, media?.title?.native])
    .filter(Boolean);
  if (!animeTitles.length) return false;

  return animeTitles.some((title) => hasTextMatch(title, normalizedAnime));
}

async function searchCharacterImagesFromAniList(name, limit = 24, animeName = "") {
  const safeName = String(name || "").trim();
  if (!safeName) return [];

  const perPage = Math.max(1, Math.min(limit, 25));
  const data = await requestAniList(SEARCH_CHARACTER_QUERY, {
    search: safeName,
    page: 1,
    perPage,
  });

  const list = data?.Page?.characters || [];
  const links = [];
  const seen = new Set();

  for (const character of list) {
    if (!matchesCharacterAndAnime(character, safeName, animeName)) {
      continue;
    }

    const candidates = [character?.image?.large, character?.image?.medium];
    for (const candidate of candidates) {
      const url = String(candidate || "").trim();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      links.push({ url, source: "AniList" });
      if (links.length >= limit) return links;
    }
  }

  return links;
}

module.exports = {
  fetchTopCharactersFromAniList,
  searchCharactersFromAniList,
  searchCharacterImagesFromAniList,
};
