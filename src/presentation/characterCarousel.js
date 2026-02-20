const { buildCharacterInfoEmbed, buildCharacterImageEmbed } = require("./embeds");
const { sendImageCarousel } = require("./imageCarousel");

const NEXT_IMAGE_PREFETCH_TIMEOUT_MS = 8 * 1000;
const CHARACTER_LIST_PAGE_SIZE = 5;

function createNextImagePrefetcher(gallery) {
  if (!Array.isArray(gallery) || gallery.length < 2 || typeof fetch !== "function") {
    return () => {};
  }

  const inFlight = new Map();
  const prefetched = new Set();

  function prefetchUrl(url) {
    if (!url || prefetched.has(url) || inFlight.has(url)) return;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), NEXT_IMAGE_PREFETCH_TIMEOUT_MS);
    const task = fetch(url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) return null;
        return response.arrayBuffer();
      })
      .catch(() => null)
      .finally(() => {
        clearTimeout(timeoutId);
        prefetched.add(url);
        inFlight.delete(url);
      });

    inFlight.set(url, task);
  }

  return ({ index }) => {
    const safeIndex = Math.max(0, Math.min(gallery.length - 1, Number(index) || 0));
    const nextIndex = (safeIndex + 1) % gallery.length;
    const nextImageUrl = gallery[nextIndex]?.url;
    prefetchUrl(nextImageUrl);
  };
}

async function sendCharacterCarousel(message, character, images) {
  const gallery = Array.isArray(images) ? images : [];
  const prefetchNextImage = createNextImagePrefetcher(gallery);

  await sendImageCarousel({
    message,
    ownerId: message.author.id,
    idPrefix: "gchar",
    totalItems: gallery.length,
    buildSlideEmbed: (index) => buildCharacterImageEmbed(character, gallery, index),
    buildListEmbed: (pagination) => buildCharacterInfoEmbed(character, gallery, pagination),
    buildEmptyEmbed: () => buildCharacterInfoEmbed(character, []),
    onSlideChange: prefetchNextImage,
    listPageSize: CHARACTER_LIST_PAGE_SIZE,
  });
}

module.exports = {
  sendCharacterCarousel,
};
