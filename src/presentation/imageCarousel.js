const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");

const DEFAULT_CAROUSEL_IDLE_TIMEOUT_MS = 15 * 60 * 1000;

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
  send,
  ownerId,
  idPrefix,
  totalItems,
  buildSlideEmbed,
  buildListEmbed,
  buildEmptyEmbed,
  onSlideChange,
  timeoutMs = DEFAULT_CAROUSEL_IDLE_TIMEOUT_MS,
  disableOnEnd = true,
}) {
  const sendFn =
    typeof send === "function"
      ? send
      : message && typeof message.reply === "function"
        ? (payload) => message.reply(payload)
        : message && typeof message.send === "function"
          ? (payload) => message.send(payload)
          : null;
  if (!sendFn) {
    throw new Error("sendImageCarousel requiere `message` con .reply/.send o un callback `send`.");
  }

  const restrictedOwnerId =
    typeof ownerId === "string" && ownerId.trim().length > 0 ? ownerId.trim() : null;

  if (!totalItems || totalItems <= 0) {
    await sendFn({ embeds: [buildEmptyEmbed()] });
    return;
  }

  const sessionId = Date.now().toString(36);
  let currentIndex = 0;
  let showingList = false;
  const response = await sendFn({
    embeds: [buildSlideEmbed(currentIndex)],
    components: [buildCarouselRow(idPrefix, sessionId, { showingList })],
  });
  runSlideChangeHook(onSlideChange, currentIndex, totalItems);

  const collectorOptions = {
    componentType: ComponentType.Button,
  };
  const normalizedTimeoutMs = Number(timeoutMs);
  if (Number.isFinite(normalizedTimeoutMs) && normalizedTimeoutMs > 0) {
    // Use inactivity timeout instead of absolute timeout so active users can keep navigating.
    collectorOptions.idle = normalizedTimeoutMs;
  }

  const collector = response.createMessageComponentCollector(collectorOptions);

  collector.on("collect", async (interaction) => {
    if (restrictedOwnerId && interaction.user.id !== restrictedOwnerId) {
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

  collector.on("end", async (_collected, reason) => {
    if (!disableOnEnd) return;
    try {
      const endedByTimeout = reason === "time" || reason === "idle";
      if (endedByTimeout) {
        showingList = true;
      }

      const payload = {
        components: [buildCarouselRow(idPrefix, sessionId, { disabled: true, showingList })],
      };
      if (endedByTimeout) {
        payload.embeds = [buildListEmbed()];
      }

      await response.edit({
        ...payload,
      });
    } catch (error) {
      // Message may be deleted or no longer editable.
    }
  });
}

module.exports = {
  sendImageCarousel,
};
