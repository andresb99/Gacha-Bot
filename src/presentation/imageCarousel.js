const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");

const DEFAULT_CAROUSEL_TIMEOUT_MS = 3 * 60 * 1000;

function buildCarouselRow(prefix, sessionId, options = {}) {
  const disabled = Boolean(options?.disabled);
  const showingList = Boolean(options?.showingList);
  const toggleLabel = showingList ? "Carrusel" : "Lista";
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${prefix}:${sessionId}:prev`)
      .setLabel("Anterior")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`${prefix}:${sessionId}:next`)
      .setLabel("Siguiente")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`${prefix}:${sessionId}:list`)
      .setLabel(toggleLabel)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled)
  );
}

function runSlideChangeHook(onSlideChange, index, totalItems) {
  if (typeof onSlideChange !== "function") return;
  try {
    const maybePromise = onSlideChange({ index, totalItems });
    if (maybePromise && typeof maybePromise.catch === "function") {
      maybePromise.catch(() => null);
    }
  } catch (error) {
    // Ignore preload hook failures so carousel navigation keeps working.
  }
}

async function sendImageCarousel({
  message,
  ownerId,
  idPrefix,
  totalItems,
  buildSlideEmbed,
  buildListEmbed,
  buildEmptyEmbed,
  onSlideChange,
  timeoutMs = DEFAULT_CAROUSEL_TIMEOUT_MS,
}) {
  if (!totalItems || totalItems <= 0) {
    await message.reply({ embeds: [buildEmptyEmbed()] });
    return;
  }

  const sessionId = Date.now().toString(36);
  let currentIndex = 0;
  let showingList = false;
  const response = await message.reply({
    embeds: [buildSlideEmbed(currentIndex)],
    components: [buildCarouselRow(idPrefix, sessionId, { showingList })],
  });
  runSlideChangeHook(onSlideChange, currentIndex, totalItems);

  const collector = response.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: timeoutMs,
  });

  collector.on("collect", async (interaction) => {
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "Solo quien ejecuto el comando puede usar este carrusel.",
        ephemeral: true,
      });
      return;
    }

    const prevId = `${idPrefix}:${sessionId}:prev`;
    const nextId = `${idPrefix}:${sessionId}:next`;
    const listId = `${idPrefix}:${sessionId}:list`;

    if (interaction.customId === prevId) {
      showingList = false;
      currentIndex = (currentIndex - 1 + totalItems) % totalItems;
      runSlideChangeHook(onSlideChange, currentIndex, totalItems);
      await interaction.update({
        embeds: [buildSlideEmbed(currentIndex)],
        components: [buildCarouselRow(idPrefix, sessionId, { showingList })],
      });
      return;
    }

    if (interaction.customId === nextId) {
      showingList = false;
      currentIndex = (currentIndex + 1) % totalItems;
      runSlideChangeHook(onSlideChange, currentIndex, totalItems);
      await interaction.update({
        embeds: [buildSlideEmbed(currentIndex)],
        components: [buildCarouselRow(idPrefix, sessionId, { showingList })],
      });
      return;
    }

    if (interaction.customId === listId) {
      showingList = !showingList;
      if (!showingList) {
        runSlideChangeHook(onSlideChange, currentIndex, totalItems);
      }
      await interaction.update({
        embeds: [showingList ? buildListEmbed() : buildSlideEmbed(currentIndex)],
        components: [buildCarouselRow(idPrefix, sessionId, { showingList })],
      });
    }
  });

  collector.on("end", async () => {
    try {
      await response.edit({
        components: [buildCarouselRow(idPrefix, sessionId, { disabled: true, showingList })],
      });
    } catch (error) {
      // Message may be deleted or no longer editable.
    }
  });
}

module.exports = {
  sendImageCarousel,
};
