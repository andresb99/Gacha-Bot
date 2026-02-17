const { sendImageCarousel } = require("./imageCarousel");
const {
  buildRollResultsListEmbed,
  buildRollResultsCarouselEmbed,
} = require("./embeds");

function groupRollResults(results) {
  const grouped = [];
  const byId = new Map();

  for (const entry of results || []) {
    const character = entry?.character || {};
    const characterId = String(character?.id || "").trim() || `unknown_${grouped.length + 1}`;
    const rollNumber = Math.max(0, Number(entry?.rollNumber || 0));
    const existingIndex = byId.get(characterId);

    if (typeof existingIndex === "number") {
      const target = grouped[existingIndex];
      target.count += 1;
      if (entry?.pityTriggered) target.pityCount += 1;
      if (rollNumber > 0) target.rollNumbers.push(rollNumber);
      continue;
    }

    const nextGroup = {
      character,
      count: 1,
      pityCount: entry?.pityTriggered ? 1 : 0,
      rollNumbers: rollNumber > 0 ? [rollNumber] : [],
    };
    byId.set(characterId, grouped.length);
    grouped.push(nextGroup);
  }

  return grouped;
}

async function sendRollResultsPagination(message, results, summary = {}) {
  const rawEntries = Array.isArray(results) ? results : [];
  const entries = groupRollResults(rawEntries);
  await sendImageCarousel({
    message,
    ownerId: message.author.id,
    idPrefix: "grollr",
    totalItems: entries.length,
    buildSlideEmbed: (index) => buildRollResultsCarouselEmbed(entries, index, summary),
    buildListEmbed: () => buildRollResultsListEmbed(entries, summary),
    buildEmptyEmbed: () => buildRollResultsListEmbed([], summary),
  });
}

module.exports = {
  sendRollResultsPagination,
};
