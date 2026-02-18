const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
} = require("discord.js");
const { RARITY_LABELS, RARITY_MARKERS } = require("../gacha/engine");
const { formatDuration } = require("../utils/time");

const TRADE_STATUS_LABELS = {
  pending: "Pendiente",
  accepted: "Aceptado",
  rejected: "Rechazado",
  cancelled: "Cancelado",
  expired: "Expirado",
};

const TRADE_STATUS_COLORS = {
  pending: 0xf1c40f,
  accepted: 0x2ecc71,
  rejected: 0xe74c3c,
  cancelled: 0x95a5a6,
  expired: 0x7f8c8d,
};

const DEFAULT_TRADE_CARD_TIMEOUT_MS = 30 * 60 * 1000;
const MIN_TRADE_CARD_TIMEOUT_MS = 15 * 1000;
const MAX_TRADE_CARD_TIMEOUT_MS = 6 * 60 * 60 * 1000;

function rarityText(rarity) {
  const normalized = String(rarity || "").toLowerCase();
  return `${RARITY_MARKERS[normalized] || "[?]"} ${RARITY_LABELS[normalized] || "Desconocido"}`;
}

function formatTradeCharacter(character, fallbackId = "") {
  const safeCharacter = character && typeof character === "object" ? character : {};
  const name = String(safeCharacter.name || "").trim() || "Desconocido";
  const anime = String(safeCharacter.anime || "").trim() || "Anime desconocido";
  const id = String(safeCharacter.id || fallbackId || "").trim() || "N/A";

  return [
    `**${name}**`,
    `Anime: ${anime}`,
    `Rareza: ${rarityText(safeCharacter.rarity)}`,
    `ID: \`${id}\``,
  ].join("\n");
}

function formatExpiryText(expiresAt) {
  if (!expiresAt || Number.isNaN(Date.parse(expiresAt))) return null;
  const msRemaining = Date.parse(expiresAt) - Date.now();
  if (msRemaining <= 0) return "Expirada";
  return `Expira en ${formatDuration(msRemaining)}`;
}

function buildTradeActionRow(idPrefix, sessionId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${idPrefix}:${sessionId}:accept`)
      .setLabel("Aceptar")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`${idPrefix}:${sessionId}:reject`)
      .setLabel("Rechazar")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  );
}

function buildTradeOfferEmbed(offer, options = {}) {
  const safeOffer = offer && typeof offer === "object" ? offer : {};
  const status = String(options.status || safeOffer.status || "pending").toLowerCase();
  const statusLabel = TRADE_STATUS_LABELS[status] || "Desconocido";
  const statusColor = TRADE_STATUS_COLORS[status] || 0x95a5a6;
  const expiryText = formatExpiryText(safeOffer.expiresAt);
  const note = String(options.note || "").trim();

  const embed = new EmbedBuilder()
    .setTitle(`Trade ${statusLabel}`)
    .setColor(statusColor)
    .setDescription(
      [
        `<@${safeOffer.proposerId}> propone un intercambio con <@${safeOffer.targetId}>.`,
        status === "pending" && expiryText ? `\n${expiryText}` : null,
        note ? `\n${note}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    )
    .addFields(
      {
        name: `Te Ofrece (${rarityText(safeOffer?.offeredCharacter?.rarity)})`,
        value: formatTradeCharacter(safeOffer.offeredCharacter, safeOffer.offeredCharacterId),
        inline: true,
      },
      {
        name: `Te Pide (${rarityText(safeOffer?.requestedCharacter?.rarity)})`,
        value: formatTradeCharacter(safeOffer.requestedCharacter, safeOffer.requestedCharacterId),
        inline: true,
      }
    )
    .setFooter({
      text: `Trade ID: ${safeOffer.id || "N/A"}`,
    });

  const offeredImage = String(safeOffer?.offeredCharacter?.imageUrl || "").trim();
  const requestedImage = String(safeOffer?.requestedCharacter?.imageUrl || "").trim();
  if (offeredImage) {
    embed.setThumbnail(offeredImage);
  }
  if (requestedImage) {
    embed.setImage(requestedImage);
  }

  return embed;
}

function buildInteractionMeta(interaction) {
  return {
    username: interaction?.user?.username || null,
    displayName:
      interaction?.member?.displayName ||
      interaction?.user?.globalName ||
      interaction?.user?.username ||
      null,
  };
}

function resolveTradeCardTimeoutMs(offer) {
  const expiresAtMs = Date.parse(String(offer?.expiresAt || ""));
  if (Number.isNaN(expiresAtMs)) return DEFAULT_TRADE_CARD_TIMEOUT_MS;
  const msRemaining = Math.max(0, expiresAtMs - Date.now());
  return Math.min(
    MAX_TRADE_CARD_TIMEOUT_MS,
    Math.max(MIN_TRADE_CARD_TIMEOUT_MS, msRemaining || DEFAULT_TRADE_CARD_TIMEOUT_MS)
  );
}

async function sendTradeOfferCard({ message, offer, engine, prefix }) {
  const sessionId = Date.now().toString(36);
  const idPrefix = "gtrade";
  const acceptId = `${idPrefix}:${sessionId}:accept`;
  const rejectId = `${idPrefix}:${sessionId}:reject`;
  let currentOffer = offer;
  let resolved = false;

  const response = await message.reply({
    embeds: [buildTradeOfferEmbed(currentOffer, { status: "pending" })],
    components: [buildTradeActionRow(idPrefix, sessionId, false)],
  });

  const collector = response.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: resolveTradeCardTimeoutMs(currentOffer),
  });

  collector.on("collect", async (interaction) => {
    if (interaction.customId !== acceptId && interaction.customId !== rejectId) return;

    if (interaction.user.id !== currentOffer.targetId) {
      await interaction.reply({
        content: "Solo el usuario al que se le ofrecio este trade puede aceptarlo o rechazarlo.",
        ephemeral: true,
      });
      return;
    }

    if (interaction.customId === acceptId) {
      const accepted = await engine.acceptTradeOffer(
        currentOffer.id,
        interaction.user.id,
        buildInteractionMeta(interaction)
      );
      if (accepted.error) {
        await interaction.reply({ content: accepted.error, ephemeral: true });
        return;
      }

      currentOffer = accepted.offer;
      resolved = true;
      await interaction.update({
        embeds: [
          buildTradeOfferEmbed(currentOffer, {
            status: "accepted",
            note: `Intercambio completado. <@${currentOffer.proposerId}> y <@${currentOffer.targetId}> recibieron sus unidades.`,
          }),
        ],
        components: [buildTradeActionRow(idPrefix, sessionId, true)],
      });
      collector.stop("resolved");
      return;
    }

    const rejected = await engine.rejectTradeOffer(
      currentOffer.id,
      interaction.user.id,
      buildInteractionMeta(interaction)
    );
    if (rejected.error) {
      await interaction.reply({ content: rejected.error, ephemeral: true });
      return;
    }

    currentOffer = rejected.offer;
    resolved = true;
    await interaction.update({
      embeds: [
        buildTradeOfferEmbed(currentOffer, {
          status: "rejected",
          note: `El trade fue rechazado por <@${currentOffer.targetId}>.`,
        }),
      ],
      components: [buildTradeActionRow(idPrefix, sessionId, true)],
    });
    collector.stop("resolved");
  });

  collector.on("end", async () => {
    if (resolved) return;
    try {
      const latest = await engine.getTradeOfferById(currentOffer.id);
      if (latest) {
        currentOffer = latest;
      }

      const stillPending = String(currentOffer?.status || "pending") === "pending";
      const note = stillPending
        ? `Botones desactivados por tiempo. Usa \`${prefix}gacha trade accept ${currentOffer.id}\` o \`${prefix}gacha trade reject ${currentOffer.id}\`.`
        : "";

      await response.edit({
        embeds: [
          buildTradeOfferEmbed(currentOffer, {
            status: currentOffer.status || "pending",
            note,
          }),
        ],
        components: [buildTradeActionRow(idPrefix, sessionId, true)],
      });
    } catch (error) {
      // Message may be deleted or no longer editable.
    }
  });

  return response;
}

module.exports = {
  sendTradeOfferCard,
};
