const { buildBoardEmbed, buildBoardCarouselEmbed } = require("./embeds");
const { sendImageCarousel } = require("./imageCarousel");

async function sendBoardCarousel(message, board, boardDate) {
  await sendImageCarousel({
    message,
    ownerId: message.author.id,
    idPrefix: "gbrd",
    totalItems: Array.isArray(board) ? board.length : 0,
    buildSlideEmbed: (index) => buildBoardCarouselEmbed(board, boardDate, index),
    buildListEmbed: () => buildBoardEmbed(board || [], boardDate),
    buildEmptyEmbed: () => buildBoardEmbed([], boardDate),
  });
}

module.exports = {
  sendBoardCarousel,
};
