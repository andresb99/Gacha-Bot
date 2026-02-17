const { buildBoardEmbed, buildBoardCarouselEmbed } = require("./embeds");
const { sendImageCarousel } = require("./imageCarousel");

async function sendBoardCarousel(message, board, boardDate) {
  const sendFn =
    message && typeof message.reply === "function"
      ? (payload) => message.reply(payload)
      : message && typeof message.send === "function"
        ? (payload) => message.send(payload)
        : null;
  if (!sendFn) {
    throw new Error("sendBoardCarousel requiere un destino con .reply() o .send().");
  }

  const ownerId =
    message && message.author && typeof message.author.id === "string" ? message.author.id : null;
  await sendImageCarousel({
    send: sendFn,
    ownerId,
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
