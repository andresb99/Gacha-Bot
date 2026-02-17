const {
  buildInventoryEmbed,
  buildInventoryCarouselEmbed,
} = require("./embeds");
const { sendImageCarousel } = require("./imageCarousel");

async function sendInventoryCarousel(message, entries, ownerLabel) {
  await sendImageCarousel({
    message,
    ownerId: message.author.id,
    idPrefix: "ginv",
    totalItems: Array.isArray(entries) ? entries.length : 0,
    buildSlideEmbed: (index) => buildInventoryCarouselEmbed(entries, ownerLabel, index),
    buildListEmbed: () => buildInventoryEmbed(entries || [], ownerLabel),
    buildEmptyEmbed: () => buildInventoryEmbed([], ownerLabel),
  });
}

module.exports = {
  sendInventoryCarousel,
};
