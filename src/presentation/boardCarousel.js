const { buildBoardEmbed, buildBoardCarouselEmbed } = require("./embeds");
const { sendImageCarousel } = require("./imageCarousel");

const BOARD_LIST_PAGE_SIZE = 10;

async function sendBoardCarousel(message, board, boardDate, options = {}) {
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
    typeof options?.ownerId === "string" || options?.ownerId === null
      ? options.ownerId
      : message && message.author && typeof message.author.id === "string"
        ? message.author.id
        : null;
  await sendImageCarousel({
    send: sendFn,
    ownerId,
    idPrefix: "gbrd",
    totalItems: Array.isArray(board) ? board.length : 0,
    buildSlideEmbed: (index) => buildBoardCarouselEmbed(board, boardDate, index),
    buildListEmbed: (pagination) => buildBoardEmbed(board || [], boardDate, pagination),
    buildEmptyEmbed: () => buildBoardEmbed([], boardDate),
    listPageSize: BOARD_LIST_PAGE_SIZE,
    timeoutMs: options?.timeoutMs,
    disableOnEnd: options?.disableOnEnd,
  });
}

module.exports = {
  sendBoardCarousel,
};
