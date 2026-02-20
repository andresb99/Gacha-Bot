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
  send,
  ownerId,
  idPrefix,
  totalItems,
  buildSlideEmbed,
  buildListEmbed,
  buildEmptyEmbed,
  onSlideChange,
  listPageSize = 10,
  timeoutMs = DEFAULT_CAROUSEL_TIMEOUT_MS,
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

  const safeListPageSize = Math.max(1, Math.floor(Number(listPageSize || 10)));
  const totalListPages = Math.max(1, Math.ceil(totalItems / safeListPageSize));
  const sessionId = Date.now().toString(36);
  let currentIndex = 0;
  let listPage = 0;
  let showingList = false;

  function syncListPageFromCurrentIndex() {
    listPage = Math.max(0, Math.min(totalListPages - 1, Math.floor(currentIndex / safeListPageSize)));
  }

  function syncCurrentIndexFromListPage() {
    currentIndex = Math.max(0, Math.min(totalItems - 1, listPage * safeListPageSize));
  }

  function buildListViewEmbed() {
    const start = listPage * safeListPageSize;
    const end = Math.min(totalItems, start + safeListPageSize);
    return buildListEmbed({
      page: listPage,
      pageSize: safeListPageSize,
      totalPages: totalListPages,
      totalItems,
      start,
      end,
      currentIndex,
    });
  }

  const response = await sendFn({
    embeds: [buildSlideEmbed(currentIndex)],
    components: [buildCarouselRow(idPrefix, sessionId, { showingList })],
  });
  runSlideChangeHook(onSlideChange, currentIndex, totalItems);

  const collectorOptions = {
    componentType: ComponentType.Button,
  };
  if (Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0) {
    collectorOptions.time = Number(timeoutMs);
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
      if (showingList) {
        listPage = (listPage - 1 + totalListPages) % totalListPages;
        syncCurrentIndexFromListPage();
        await interaction.update({
          embeds: [buildListViewEmbed()],
          components: [buildCarouselRow(idPrefix, sessionId, { showingList })],
        });
      } else {
        currentIndex = (currentIndex - 1 + totalItems) % totalItems;
        runSlideChangeHook(onSlideChange, currentIndex, totalItems);
        await interaction.update({
          embeds: [buildSlideEmbed(currentIndex)],
          components: [buildCarouselRow(idPrefix, sessionId, { showingList })],
        });
      }
      return;
    }

    if (interaction.customId === nextId) {
      if (showingList) {
        listPage = (listPage + 1) % totalListPages;
        syncCurrentIndexFromListPage();
        await interaction.update({
          embeds: [buildListViewEmbed()],
          components: [buildCarouselRow(idPrefix, sessionId, { showingList })],
        });
      } else {
        currentIndex = (currentIndex + 1) % totalItems;
        runSlideChangeHook(onSlideChange, currentIndex, totalItems);
        await interaction.update({
          embeds: [buildSlideEmbed(currentIndex)],
          components: [buildCarouselRow(idPrefix, sessionId, { showingList })],
        });
      }
      return;
    }

    if (interaction.customId === listId) {
      showingList = !showingList;
      if (showingList) {
        syncListPageFromCurrentIndex();
      } else {
        runSlideChangeHook(onSlideChange, currentIndex, totalItems);
      }
      await interaction.update({
        embeds: [showingList ? buildListViewEmbed() : buildSlideEmbed(currentIndex)],
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
        syncListPageFromCurrentIndex();
      }

      const payload = {
        components: [buildCarouselRow(idPrefix, sessionId, { disabled: true, showingList })],
      };
      if (endedByTimeout) {
        payload.embeds = [buildListViewEmbed()];
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
