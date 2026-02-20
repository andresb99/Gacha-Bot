const {
  buildInventoryEmbed,
  buildInventoryCarouselEmbed,
} = require("./embeds");
const { sendImageCarousel } = require("./imageCarousel");

const INVENTORY_LIST_PAGE_SIZE = 10;

async function sendInventoryCarousel(message, entries, ownerLabel) {
  await sendImageCarousel({
    message,
    ownerId: message.author.id,
    idPrefix: "ginv",
    totalItems: Array.isArray(entries) ? entries.length : 0,
    buildSlideEmbed: (index) => buildInventoryCarouselEmbed(entries, ownerLabel, index),
    buildListEmbed: (pagination) => buildInventoryEmbed(entries || [], ownerLabel, pagination),
    buildEmptyEmbed: () => buildInventoryEmbed([], ownerLabel),
    listPageSize: INVENTORY_LIST_PAGE_SIZE,
  });
}

module.exports = {
  sendInventoryCarousel,
};
