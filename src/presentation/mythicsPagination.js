const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const { buildMythicsPageEmbed } = require("./embeds");

const MYTHICS_PAGE_SIZE = 20;
const MYTHICS_TIMEOUT_MS = 3 * 60 * 1000;

function buildControls(sessionId, currentPage, totalPages, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`gmyth:${sessionId}:prev`)
      .setLabel("Anterior")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled || currentPage <= 0),
    new ButtonBuilder()
      .setCustomId(`gmyth:${sessionId}:next`)
      .setLabel("Siguiente")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled || currentPage >= totalPages - 1)
  );
}

async function sendMythicsPagination(message, mythics, prefix = "!", startPage = 1) {
  const entries = Array.isArray(mythics) ? mythics : [];
  if (!entries.length) {
    await message.reply("No hay personajes miticos en el catalogo actual.");
    return;
  }

  const sessionId = Date.now().toString(36);
  const totalPages = Math.max(1, Math.ceil(entries.length / MYTHICS_PAGE_SIZE));
  const requestedPage = Math.max(1, Math.floor(Number(startPage || 1)));
  let currentPage = Math.max(0, Math.min(totalPages - 1, requestedPage - 1));

  const response = await message.reply({
    embeds: [buildMythicsPageEmbed(entries, currentPage, MYTHICS_PAGE_SIZE, prefix)],
    components: [buildControls(sessionId, currentPage, totalPages)],
  });

  const collector = response.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: MYTHICS_TIMEOUT_MS,
  });

  collector.on("collect", async (interaction) => {
    if (interaction.user.id !== message.author.id) {
      await interaction.reply({
        content: "Solo quien ejecuto el comando puede usar esta lista.",
        ephemeral: true,
      });
      return;
    }

    if (interaction.customId === `gmyth:${sessionId}:prev`) {
      currentPage = Math.max(0, currentPage - 1);
      await interaction.update({
        embeds: [buildMythicsPageEmbed(entries, currentPage, MYTHICS_PAGE_SIZE, prefix)],
        components: [buildControls(sessionId, currentPage, totalPages)],
      });
      return;
    }

    if (interaction.customId === `gmyth:${sessionId}:next`) {
      currentPage = Math.min(totalPages - 1, currentPage + 1);
      await interaction.update({
        embeds: [buildMythicsPageEmbed(entries, currentPage, MYTHICS_PAGE_SIZE, prefix)],
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
  sendMythicsPagination,
};
