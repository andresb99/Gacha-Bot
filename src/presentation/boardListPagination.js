const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const { buildBoardListPageEmbed } = require("./embeds");

const LIST_PAGE_SIZE = 10;
const LIST_TIMEOUT_MS = 3 * 60 * 1000;

function buildControls(sessionId, currentPage, totalPages, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`glist:${sessionId}:prev`)
      .setLabel("Anterior")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled || currentPage <= 0),
    new ButtonBuilder()
      .setCustomId(`glist:${sessionId}:next`)
      .setLabel("Siguiente")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled || currentPage >= totalPages - 1)
  );
}

async function sendBoardListPagination(message, board, boardDate, prefix) {
  const entries = Array.isArray(board) ? board : [];
  const safePrefix = prefix || "!";
  if (!entries.length) {
    await message.reply({
      embeds: [buildBoardListPageEmbed([], boardDate, 0, LIST_PAGE_SIZE, safePrefix)],
    });
    return;
  }

  const sessionId = Date.now().toString(36);
  const totalPages = Math.max(1, Math.ceil(entries.length / LIST_PAGE_SIZE));
  let currentPage = 0;

  const response = await message.reply({
    embeds: [buildBoardListPageEmbed(entries, boardDate, currentPage, LIST_PAGE_SIZE, safePrefix)],
    components: [buildControls(sessionId, currentPage, totalPages)],
  });

  const collector = response.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: LIST_TIMEOUT_MS,
  });

  collector.on("collect", async (interaction) => {
    if (interaction.user.id !== message.author.id) {
      await interaction.reply({
        content: "Solo quien ejecuto el comando puede usar esta lista.",
        ephemeral: true,
      });
      return;
    }

    if (interaction.customId === `glist:${sessionId}:prev`) {
      currentPage = Math.max(0, currentPage - 1);
      await interaction.update({
        embeds: [buildBoardListPageEmbed(entries, boardDate, currentPage, LIST_PAGE_SIZE, safePrefix)],
        components: [buildControls(sessionId, currentPage, totalPages)],
      });
      return;
    }

    if (interaction.customId === `glist:${sessionId}:next`) {
      currentPage = Math.min(totalPages - 1, currentPage + 1);
      await interaction.update({
        embeds: [buildBoardListPageEmbed(entries, boardDate, currentPage, LIST_PAGE_SIZE, safePrefix)],
        components: [buildControls(sessionId, currentPage, totalPages)],
      });
    }
  });

  collector.on("end", async () => {
    try {
      await response.edit({
        components: [buildControls(sessionId, currentPage, totalPages, true)],
      });
    } catch (error) {
      // Message may be deleted or no longer editable.
    }
  });
}

module.exports = {
  sendBoardListPagination,
};
