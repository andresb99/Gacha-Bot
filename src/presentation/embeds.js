const { EmbedBuilder } = require("discord.js");
const { RARITY_LABELS, RARITY_COLORS, RARITY_MARKERS } = require("../gacha/engine");

function rarityText(rarity) {
  return `${RARITY_MARKERS[rarity] || "[?]"} ${RARITY_LABELS[rarity] || "Desconocido"}`;
}

function buildChanceMap(board) {
  const safeBoard = Array.isArray(board) ? board : [];
  const map = new Map();
  if (!safeBoard.length) return map;

  const weights = safeBoard.map((character) => Math.max(0, Number(character?.dropWeight || 0)));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);

  if (totalWeight <= 0) {
    const uniformChance = 100 / safeBoard.length;
    for (const character of safeBoard) {
      map.set(String(character.id), uniformChance);
    }
    return map;
  }

  safeBoard.forEach((character, index) => {
    map.set(String(character.id), (weights[index] / totalWeight) * 100);
  });
  return map;
}

function formatChance(chance) {
  const value = Number(chance || 0);
  if (!Number.isFinite(value) || value <= 0) return "0.00%";
  if (value >= 10) return `${value.toFixed(1)}%`;
  if (value >= 1) return `${value.toFixed(2)}%`;
  return `${value.toFixed(3)}%`;
}

function rankingText(character) {
  const rank = Math.max(0, Math.floor(Number(character?.popularityRank || 0)));
  return rank > 0 ? `#${rank}` : "N/A";
}

function resolvePagination(totalItems, options = {}, defaultPageSize = 10) {
  const safeTotalItems = Math.max(0, Math.floor(Number(totalItems || 0)));
  const parsedPageSize = Number(options?.pageSize);
  const safePageSize = Math.max(
    1,
    Math.floor(Number.isFinite(parsedPageSize) && parsedPageSize > 0 ? parsedPageSize : defaultPageSize)
  );
  const totalPages = Math.max(1, Math.ceil(safeTotalItems / safePageSize));
  const parsedPage = Number(options?.page);
  const safePage = Math.max(
    0,
    Math.min(totalPages - 1, Math.floor(Number.isFinite(parsedPage) ? parsedPage : 0))
  );
  const start = Math.max(0, Math.min(safeTotalItems, safePage * safePageSize));
  const end = Math.max(start, Math.min(safeTotalItems, start + safePageSize));

  return {
    page: safePage,
    pageSize: safePageSize,
    totalPages,
    start,
    end,
  };
}

function buildHelpEmbed(prefix) {
  return new EmbedBuilder()
    .setTitle("Gacha Anime - Comandos")
    .setColor(0x1abc9c)
    .setDescription(
      [
        `\`${prefix}gacha help\` - Muestra esta ayuda`,
        `\`${prefix}gacha board\` - Muestra el tablero en carrusel`,
        `\`${prefix}gacha list\` - Lista paginada del tablero`,
        `\`${prefix}gacha mythics [pagina]\` - Lista top 250 miticos del catalogo`,
        `\`${prefix}gacha character <name|number>\` - Ver personaje y su galeria`,
        `\`${prefix}gacha roll [cantidad]\` - Hace una o varias tiradas`,
        `\`${prefix}gacha daily\` - Reclama tiradas extra por cooldown`,
        `\`${prefix}gacha timer\` - Tiempo restante para refresh del board`,
        `\`${prefix}gacha owners <personaje|id>\` - Muestra que usuarios tienen ese personaje y cuantas copias`,
        `\`${prefix}gacha contract [rareza] [cantidad] [--pick id[:copias],...]\` - Convierte personajes por rareza`,
        `\`${prefix}gacha trade @user <lo_tuyo> por <lo_que_pides>\` - Crea trade con tarjeta y botones`,
        `\`${prefix}gacha trade list|accept|reject|cancel\` - Gestiona tus trades pendientes`,
        `\`${prefix}gacha profile\` - Muestra tus stats`,
        `\`${prefix}gacha inventory [@user]\` - Muestra inventario`,
        `\`${prefix}gacha refreshboard\` - Regenera tablero (solo admin configurado)`,
      ].join("\n")
    )
    .setFooter({ text: "Pity mitica con soft/hard configurable | Usa !gacha profile para ver progreso" });
}

function buildBoardEmbed(board, boardDate, options = {}) {
  const safeBoard = Array.isArray(board) ? board : [];
  const chanceById = buildChanceMap(safeBoard);
  const pagination = resolvePagination(
    safeBoard.length,
    options,
    Math.max(1, safeBoard.length || Number(options?.pageSize) || 10)
  );
  const pageEntries = safeBoard.slice(pagination.start, pagination.end);
  const lines = pageEntries.map((character, index) => {
    const chance = formatChance(chanceById.get(String(character.id)));
    const absoluteIndex = pagination.start + index + 1;
    return `\`${String(absoluteIndex).padStart(2, "0")}\` ${rarityText(character.rarity)} **${
      character.name
    }** - ${character.anime} (${chance})`;
  });

  const footerParts = [];
  if (pagination.totalPages > 1) {
    footerParts.push(`Pagina ${pagination.page + 1}/${pagination.totalPages}`);
  }
  footerParts.push(`Total: ${safeBoard.length}`);
  footerParts.push("Usa !gacha roll para tirar");

  return new EmbedBuilder()
    .setTitle(`Tablero (${boardDate || "sin actualizar"})`)
    .setColor(0x5865f2)
    .setDescription(lines.join("\n") || "No hay personajes en el tablero.")
    .setFooter({ text: footerParts.join(" | ") });
}

function buildBoardListPageEmbed(board, boardDate, page = 0, pageSize = 10, prefix = "!") {
  const safeBoard = Array.isArray(board) ? board : [];
  const chanceById = buildChanceMap(safeBoard);
  const safePageSize = Math.max(1, Number(pageSize || 10));
  const totalPages = Math.max(1, Math.ceil(safeBoard.length / safePageSize));
  const safePage = Math.max(0, Math.min(totalPages - 1, page));
  const start = safePage * safePageSize;
  const end = start + safePageSize;
  const pageEntries = safeBoard.slice(start, end);

  const lines = pageEntries.map(
    (character, index) => {
      const chance = formatChance(chanceById.get(String(character.id)));
      return `\`${String(start + index + 1).padStart(2, "0")}\` ${rarityText(character.rarity)} **${
        character.name
      }** - ${character.anime} (${chance})`;
    }
  );

  return new EmbedBuilder()
    .setTitle(`Lista del Tablero (${boardDate || "sin actualizar"})`)
    .setColor(0x5865f2)
    .setDescription(lines.join("\n") || "No hay personajes en el tablero.")
    .setFooter({
      text: `Pagina ${safePage + 1}/${totalPages} | Total: ${safeBoard.length} | Usa ${prefix}gacha character <number>`,
    });
}

function buildMythicsPageEmbed(mythics, page = 0, pageSize = 20, prefix = "!") {
  const safeMythics = Array.isArray(mythics) ? mythics : [];
  const safePageSize = Math.max(1, Number(pageSize || 20));
  const totalPages = Math.max(1, Math.ceil(safeMythics.length / safePageSize));
  const safePage = Math.max(0, Math.min(totalPages - 1, page));
  const start = safePage * safePageSize;
  const end = start + safePageSize;
  const pageItems = safeMythics.slice(start, end);

  const lines = pageItems.map((character, index) => {
    const absolutePosition = start + index + 1;
    return `\`${String(absolutePosition).padStart(3, "0")}\` **${character?.name || "Desconocido"}** - ${
      character?.anime || "Anime desconocido"
    } | Rank ${rankingText(character)} | \`${character?.id || "N/A"}\``;
  });

  return new EmbedBuilder()
    .setTitle("Miticos del catalogo")
    .setColor(RARITY_COLORS.mythic || 0xe74c3c)
    .setDescription(lines.join("\n") || "No hay personajes miticos en el catalogo actual.")
    .setFooter({
      text: `Pagina ${safePage + 1}/${totalPages} | Top ${safeMythics.length} rankeados | ${prefix}gacha mythics`,
    });
}

function buildRollSummaryLine(summary = {}) {
  const pityCounter = Math.max(0, Number(summary?.mythicPityCounter ?? summary?.pityCounter ?? 0));
  const pitySoftThreshold = Math.max(
    1,
    Number(summary?.mythicPitySoftThreshold ?? summary?.pitySoftThreshold ?? 700)
  );
  const pityHardThreshold = Math.max(
    pitySoftThreshold,
    Number(summary?.mythicPityHardThreshold ?? summary?.pityThreshold ?? 1000)
  );

  return `Tiradas ${Math.max(0, Number(summary?.executed || 0))}/${Math.max(
    0,
    Number(summary?.requested || 0)
  )} | Pity M ${Math.min(pityCounter, pityHardThreshold - 1)}/${pityHardThreshold} (soft ${pitySoftThreshold}) | Restantes ${Math.max(
    0,
    Number(summary?.rollsLeft || 0)
  )}`;
}

function groupRollResultsByCharacter(results) {
  const grouped = [];
  const byId = new Map();
  for (const entry of results || []) {
    const character = entry?.character || {};
    const characterId = String(character?.id || "").trim() || `unknown_${grouped.length + 1}`;
    const rollNumber = Math.max(0, Number(entry?.rollNumber || 0));
    const existingIndex = byId.get(characterId);
    if (typeof existingIndex === "number") {
      const target = grouped[existingIndex];
      target.count += 1;
      if (entry?.pityTriggered) target.pityCount += 1;
      if (rollNumber > 0) target.rollNumbers.push(rollNumber);
      continue;
    }

    const nextGroup = {
      character,
      count: 1,
      pityCount: entry?.pityTriggered ? 1 : 0,
      rollNumbers: rollNumber > 0 ? [rollNumber] : [],
    };
    byId.set(characterId, grouped.length);
    grouped.push(nextGroup);
  }
  return grouped;
}

function normalizeGroupedRollResults(results) {
  const safeResults = Array.isArray(results) ? results : [];
  const alreadyGrouped = safeResults.some(
    (entry) => entry && typeof entry === "object" && entry.character && typeof entry.count === "number"
  );
  if (!alreadyGrouped) {
    return groupRollResultsByCharacter(safeResults);
  }

  return safeResults
    .map((entry) => ({
      character: entry?.character || {},
      count: Math.max(1, Math.floor(Number(entry?.count || 1))),
      pityCount: Math.max(
        0,
        Math.floor(Number(entry?.pityCount || (entry?.pityTriggered ? 1 : 0)))
      ),
      rollNumbers: Array.isArray(entry?.rollNumbers)
        ? entry.rollNumbers
            .map((value) => Math.max(0, Math.floor(Number(value || 0))))
            .filter((value) => value > 0)
        : [],
    }))
    .filter((entry) => entry?.character);
}

function buildRollResultsListEmbed(results, summary = {}, options = {}) {
  const grouped = normalizeGroupedRollResults(results);
  const useExplicitPagination =
    Number.isFinite(Number(options?.pageSize)) || Number.isFinite(Number(options?.page));
  const pagination = resolvePagination(grouped.length, options, useExplicitPagination ? 12 : 60);
  const totalRolls = grouped.reduce((sum, entry) => sum + Math.max(0, Number(entry?.count || 0)), 0);
  const summaryLine = buildRollSummaryLine(summary);
  const pageEntries = grouped.slice(pagination.start, pagination.end);
  const lines = pageEntries.map((group, index) => {
    const character = group.character || {};
    const pityTag = group.pityCount > 0 ? ` | Pity x${group.pityCount}` : "";
    const absoluteIndex = pagination.start + index + 1;
    return `\`${String(absoluteIndex).padStart(2, "0")}\` ${rarityText(character?.rarity)} **${
      character?.name || "Desconocido"
    }** x${group.count} - ${character?.anime || "Anime desconocido"} | Rank ${rankingText(
      character
    )}${pityTag}`;
  });

  const baseHeader = [summaryLine, `Unicos: ${grouped.length} | Totales: ${totalRolls}`, ""];
  let visibleLines = lines.slice(0, 60);
  let description = [...baseHeader, ...visibleLines].join("\n");
  while (description.length > 4000 && visibleLines.length > 0) {
    visibleLines = visibleLines.slice(0, visibleLines.length - 1);
    description = [...baseHeader, ...visibleLines].join("\n");
  }

  if (visibleLines.length < lines.length) {
    const hidden = lines.length - visibleLines.length;
    const withMore = [...baseHeader, ...visibleLines, `... y ${hidden} mas`].join("\n");
    if (withMore.length <= 4000) description = withMore;
  }

  const footerParts = [];
  if (pagination.totalPages > 1) {
    footerParts.push(`Pagina ${pagination.page + 1}/${pagination.totalPages}`);
  }
  footerParts.push("Lista agrupada por personaje (xN)");
  footerParts.push("Usa Lista/Carrusel para alternar");

  return new EmbedBuilder()
    .setTitle("Resultados de Tiradas")
    .setColor(0x5865f2)
    .setDescription(description || `${summaryLine}\n\nSin resultados.`)
    .setFooter({
      text: footerParts.join(" | "),
    });
}

function buildRollResultsCarouselEmbed(results, index, summary = {}) {
  const grouped = normalizeGroupedRollResults(results);
  if (!grouped.length) {
    return buildRollResultsListEmbed([], summary);
  }

  const total = grouped.length;
  const safeIndex = Math.max(0, Math.min(total - 1, index));
  const entry = grouped[safeIndex] || {};
  const character = entry.character || {};
  const count = Math.max(1, Number(entry?.count || 1));
  const pityCount = Math.max(0, Number(entry?.pityCount || 0));
  const rollNumbers = Array.isArray(entry?.rollNumbers) ? entry.rollNumbers : [];
  const shownRollNumbers = rollNumbers.slice(0, 8);
  const hiddenRollNumbers = Math.max(0, rollNumbers.length - shownRollNumbers.length);
  const rollsText =
    shownRollNumbers.length > 0
      ? `${shownRollNumbers.join(", ")}${hiddenRollNumbers > 0 ? ` +${hiddenRollNumbers}` : ""}`
      : "N/A";

  const embed = new EmbedBuilder()
    .setTitle(`Resultado ${safeIndex + 1}/${total}`)
    .setColor(RARITY_COLORS[character?.rarity] || 0x5865f2)
    .setDescription(
      [
        buildRollSummaryLine(summary),
        "",
        `**${character?.name || "Desconocido"}**`,
        `**Anime:** ${character?.anime || "Anime desconocido"}`,
        `**Rareza:** ${rarityText(character?.rarity)}`,
        `**Ranking:** ${rankingText(character)}`,
        `**Copias obtenidas:** x${count}`,
        `**Tiradas:** ${rollsText}`,
        pityCount > 0 ? `**Pity:** x${pityCount}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    )
    .setFooter({
      text: `Carta ${safeIndex + 1}/${total} | Repetidos agrupados xN`,
    });

  if (character?.imageUrl) {
    embed.setImage(character.imageUrl);
  }

  return embed;
}

function buildBoardCarouselEmbed(board, boardDate, index) {
  const total = board.length;
  const safeIndex = Math.max(0, Math.min(total - 1, index));
  const character = board[safeIndex];
  const chanceById = buildChanceMap(board);
  const dropChance = formatChance(chanceById.get(String(character?.id)));

  const embed = new EmbedBuilder()
    .setTitle(`Tablero (${boardDate || "sin actualizar"})`)
    .setColor(RARITY_COLORS[character.rarity] || 0x5865f2)
    .setDescription(
      [
        `**${character.name}**`,
        `**Anime:** ${character.anime}`,
        `**Rareza:** ${rarityText(character.rarity)}`,
        `**Probabilidad:** ${dropChance}`,
        `**Ranking:** ${rankingText(character)}`,
      ].join("\n")
    )
    .setFooter({
      text: `Carta ${safeIndex + 1}/${total} | Usa Anterior/Siguiente para navegar`,
    });

  if (character.imageUrl) {
    embed.setImage(character.imageUrl);
  }

  return embed;
}

function buildRollEmbed(character, user, rollsLeft, options = {}) {
  const pitySoftThreshold = Math.max(
    1,
    Number(options?.pitySoftThreshold ?? options?.mythicPitySoftThreshold ?? 700)
  );
  const pityHardThreshold = Math.max(
    pitySoftThreshold,
    Number(options?.pityThreshold ?? options?.mythicPityHardThreshold ?? 1000)
  );
  const pityCounter = Math.max(0, Number(options?.pityCounter ?? options?.mythicPityCounter ?? 0));
  const pityText = `${Math.min(pityCounter, pityHardThreshold - 1)}/${pityHardThreshold}`;
  const softBonusPercent = Math.max(0, Number(options?.pitySoftBonusPercent || 0));
  const pityLine = options?.pityHardTriggered || options?.pityTriggered
    ? `**Pity mitica:** ${pityText} (hard activado)`
    : softBonusPercent > 0
      ? `**Pity mitica:** ${pityText} (soft +${softBonusPercent.toFixed(2)}% | soft ${pitySoftThreshold})`
      : `**Pity mitica:** ${pityText} (soft ${pitySoftThreshold})`;

  const embed = new EmbedBuilder()
    .setTitle(`${character.name}`)
    .setColor(RARITY_COLORS[character.rarity] || 0x95a5a6)
    .setDescription(
      [
        `**Anime:** ${character.anime}`,
        `**Rareza:** ${rarityText(character.rarity)}`,
        `**Ranking:** ${rankingText(character)}`,
        `**Tirador:** ${user}`,
        `**Tiradas restantes:** ${rollsLeft}`,
        pityLine,
      ].join("\n")
    )
    .setFooter({ text: "Gacha Anime Bot" });

  if (character.imageUrl) {
    embed.setImage(character.imageUrl);
  }

  return embed;
}

function buildProfileEmbed(profile, user) {
  const pitySoftThreshold = Math.max(
    1,
    Number(profile?.mythicPitySoftThreshold ?? profile?.pitySoftThreshold ?? 700)
  );
  const pityHardThreshold = Math.max(
    pitySoftThreshold,
    Number(profile?.mythicPityHardThreshold ?? profile?.pityThreshold ?? 1000)
  );
  const pityCounter = Math.max(0, Number(profile?.mythicPityCounter ?? profile?.pityCounter ?? 0));
  return new EmbedBuilder()
    .setTitle(`Perfil de ${user}`)
    .setColor(0x2c3e50)
    .addFields(
      { name: "Tiradas restantes", value: String(profile.rollsLeft), inline: true },
      { name: "Total tiradas", value: String(profile.totalRolls), inline: true },
      { name: "Coleccion unica", value: String(profile.uniqueCount), inline: true },
      { name: "Copias totales", value: String(profile.totalCopies), inline: true },
      {
        name: "Pity mitica",
        value: `${Math.min(pityCounter, pityHardThreshold - 1)}/${pityHardThreshold} (soft ${pitySoftThreshold})`,
        inline: true,
      },
      { name: "Ultimo reset", value: profile.lastReset || "N/A", inline: true }
    );
}

function buildInventoryEmbed(entries, user, options = {}) {
  const safeEntries = Array.isArray(entries) ? entries : [];
  const pagination = resolvePagination(
    safeEntries.length,
    options,
    Math.max(1, Math.min(20, safeEntries.length || Number(options?.pageSize) || 10))
  );
  const pageEntries = safeEntries.slice(pagination.start, pagination.end);
  const lines = pageEntries.map((entry, index) => {
    const rarity = rarityText(entry.character.rarity);
    const absoluteIndex = pagination.start + index + 1;
    return `\`${String(absoluteIndex).padStart(2, "0")}\` ${rarity} **${entry.character.name}** x${
      entry.count
    } - ${entry.character.anime} (\`${entry.character.id}\`)`;
  });

  const footerParts = [];
  if (pagination.totalPages > 1) {
    footerParts.push(`Pagina ${pagination.page + 1}/${pagination.totalPages}`);
  }
  if (safeEntries.length > 0) {
    footerParts.push(`Mostrando ${pagination.start + 1}-${pagination.end} de ${safeEntries.length}`);
  } else {
    footerParts.push("0 personajes en coleccion");
  }

  return new EmbedBuilder()
    .setTitle(`Inventario de ${user}`)
    .setColor(0x9b59b6)
    .setDescription(lines.join("\n") || "Sin personajes.")
    .setFooter({
      text: footerParts.join(" | "),
    });
}

function buildInventoryCarouselEmbed(entries, user, index) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return new EmbedBuilder()
      .setTitle(`Inventario de ${user}`)
      .setColor(0x9b59b6)
      .setDescription("Sin personajes.");
  }

  const total = entries.length;
  const safeIndex = Math.max(0, Math.min(total - 1, index));
  const entry = entries[safeIndex];
  const character = entry.character;
  const embed = new EmbedBuilder()
    .setTitle(`Inventario de ${user}`)
    .setColor(RARITY_COLORS[character.rarity] || 0x9b59b6)
    .setDescription(
      [
        `**${character.name}**`,
        `**Anime:** ${character.anime}`,
        `**Rareza:** ${rarityText(character.rarity)}`,
        `**ID:** \`${character.id}\``,
        `**Copias:** x${entry.count}`,
        `**Ranking:** ${rankingText(character)}`,
      ].join("\n")
    )
    .setFooter({
      text: `Carta ${safeIndex + 1}/${total} | Repetidos mostrados como xN`,
    });

  if (character.imageUrl) {
    embed.setImage(character.imageUrl);
  }

  return embed;
}

function buildCharacterInfoEmbed(character, images, options = {}) {
  const sourceNames = Array.isArray(character?.sources) ? character.sources.join(", ") : character?.source;
  const safeImages = Array.isArray(images) ? images : [];
  const imageCount = safeImages.length;
  const pagination = resolvePagination(
    imageCount,
    options,
    Math.max(1, Math.min(10, imageCount || Number(options?.pageSize) || 5))
  );
  const pageImages = safeImages.slice(pagination.start, pagination.end);
  const pageLines = pageImages.map((image, index) => {
    const absoluteIndex = pagination.start + index + 1;
    return `\`${String(absoluteIndex).padStart(2, "0")}\` ${image?.source || "Fuente desconocida"}`;
  });
  const description = [
    `**Anime:** ${character?.anime || "Desconocido"}`,
    `**Rareza:** ${rarityText(character?.rarity)}`,
    `**Ranking:** ${rankingText(character)}`,
    `**Fuentes:** ${sourceNames || "Desconocida"}`,
    `**Imagenes encontradas:** ${imageCount}`,
    imageCount > 0 ? `**Pagina lista:** ${pagination.page + 1}/${pagination.totalPages}` : null,
    imageCount > 0 && pageLines.length > 0 ? "" : null,
    imageCount > 0 && pageLines.length > 0 ? "**Imagenes en esta pagina:**" : null,
    imageCount > 0 && pageLines.length > 0 ? pageLines.join("\n") : null,
  ]
    .filter(Boolean)
    .join("\n");

  const footerText =
    imageCount > 0
      ? `Pagina ${pagination.page + 1}/${pagination.totalPages} | Usa Anterior/Siguiente en Lista o Carrusel para ver imagen`
      : "No se encontraron imagenes adicionales";

  const embed = new EmbedBuilder()
    .setTitle(character?.name || "Personaje")
    .setColor(RARITY_COLORS[character?.rarity] || 0x5865f2)
    .setDescription(description)
    .setFooter({
      text: footerText,
    });

  if (character?.imageUrl) {
    embed.setImage(character.imageUrl);
  }

  return embed;
}

function buildCharacterImageEmbed(character, images, index) {
  if (!Array.isArray(images) || images.length === 0) {
    return buildCharacterInfoEmbed(character, []);
  }

  const total = images.length;
  const safeIndex = Math.max(0, Math.min(total - 1, index));
  const image = images[safeIndex];

  const embed = new EmbedBuilder()
    .setTitle(character?.name || "Personaje")
    .setColor(RARITY_COLORS[character?.rarity] || 0x5865f2)
    .setDescription(
      [
        `**Anime:** ${character?.anime || "Desconocido"}`,
        `**Rareza:** ${rarityText(character?.rarity)}`,
        `**Ranking:** ${rankingText(character)}`,
        `**Fuente imagen:** ${image?.source || "Desconocida"}`,
      ].join("\n")
    )
    .setFooter({
      text: `Imagen ${safeIndex + 1}/${total}`,
    });

  if (image?.url) {
    embed.setImage(image.url);
  }

  return embed;
}

module.exports = {
  buildHelpEmbed,
  buildBoardEmbed,
  buildBoardListPageEmbed,
  buildMythicsPageEmbed,
  buildRollResultsListEmbed,
  buildRollResultsCarouselEmbed,
  buildBoardCarouselEmbed,
  buildRollEmbed,
  buildProfileEmbed,
  buildInventoryEmbed,
  buildInventoryCarouselEmbed,
  buildCharacterInfoEmbed,
  buildCharacterImageEmbed,
};
