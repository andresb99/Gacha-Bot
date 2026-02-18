const {
  buildHelpEmbed,
  buildRollEmbed,
  buildProfileEmbed,
} = require("../presentation/embeds");
const { sendBoardCarousel } = require("../presentation/boardCarousel");
const { sendBoardListPagination } = require("../presentation/boardListPagination");
const { sendCharacterCarousel } = require("../presentation/characterCarousel");
const { sendInventoryCarousel } = require("../presentation/inventoryCarousel");
const { sendMythicsPagination } = require("../presentation/mythicsPagination");
const { sendRollResultsPagination } = require("../presentation/rollResultsPagination");
const { formatDuration } = require("../utils/time");

const MAX_ROLLS_PER_COMMAND = 50;
const MAX_CONTRACT_PREVIEW_REWARDS = 8;
const MAX_TRADE_PREVIEW_LINES = 8;
const ROLL_RARITY_ORDER = ["mythic", "legendary", "epic", "rare", "common"];
const ROLL_RARITY_LABELS = {
  common: "Comun",
  rare: "Raro",
  epic: "Epico",
  legendary: "Legendario",
  mythic: "Mitico",
};
const TRADE_STATUS_LABELS = {
  pending: "Pendiente",
  accepted: "Aceptado",
  rejected: "Rechazado",
  cancelled: "Cancelado",
  expired: "Expirado",
};
const CONTRACT_RARITY_ALIASES = {
  common: "common",
  c: "common",
  comun: "common",
  rare: "rare",
  r: "rare",
  raro: "rare",
  epic: "epic",
  e: "epic",
  legendary: "legendary",
  l: "legendary",
  legendario: "legendary",
};

function normalizeSubcommand(rawSubcommand) {
  const value = String(rawSubcommand || "help")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
  if (["help"].includes(value)) return "help";
  if (["board"].includes(value)) return "board";
  if (["list"].includes(value)) return "list";
  if (["mythic", "mythics"].includes(value)) return "mythics";
  if (["roll", "pull"].includes(value)) return "roll";
  if (["daily", "claim", "reward"].includes(value)) return "daily";
  if (["timer", "timeleft", "refreshin", "boardtimer", "nextboard"].includes(value)) {
    return "boardtimer";
  }
  if (["profile", "stats"].includes(value)) return "profile";
  if (["inv", "inventory", "collection"].includes(value)) return "inventory";
  if (["contract", "tradeup", "exchange"].includes(value)) return "contract";
  if (["trade", "trades", "swap", "intercambio"].includes(value)) return "trade";
  if (["character", "char"].includes(value)) return "character";
  if (["refreshboard", "resetboard"].includes(value)) return "refreshboard";
  return "unknown";
}

function normalizeTradeAction(rawAction) {
  const value = String(rawAction || "help")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");

  if (["help", "ayuda"].includes(value)) return "help";
  if (["list", "ls", "status", "pending", "pendings"].includes(value)) return "list";
  if (["offer", "propose", "create", "crear", "proponer"].includes(value)) return "offer";
  if (["accept", "aceptar", "ok"].includes(value)) return "accept";
  if (["reject", "rechazar", "deny", "decline"].includes(value)) return "reject";
  if (["cancel", "cancelar", "remove"].includes(value)) return "cancel";
  return "unknown";
}

function extractMentionedUserId(rawValue) {
  const token = String(rawValue || "").trim();
  const match = token.match(/^<@!?(\d+)>$/);
  return match ? String(match[1]) : null;
}

function unwrapQuotedValue(rawValue) {
  const value = String(rawValue || "").trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).trim();
  }
  return value;
}

function splitBySeparator(rawInput, separatorRegex) {
  const text = String(rawInput || "").trim();
  const regex = new RegExp(separatorRegex.source, separatorRegex.flags.replace("g", ""));
  const match = regex.exec(text);
  if (!match || typeof match.index !== "number") return null;

  const left = text.slice(0, match.index).trim();
  const right = text.slice(match.index + match[0].length).trim();
  if (!left || !right) return null;
  return [left, right];
}

function parseTradeOfferDetails(rawInput) {
  const input = String(rawInput || "").trim();
  if (!input) {
    return {
      valid: false,
      giveQuery: null,
      wantQuery: null,
      error:
        "Debes indicar que ofreces y que pides. Ejemplo: `--give \"Shigeo Kageyama\" --want \"Light Yagami\"`.",
    };
  }

  const byFlags = {};
  const flagRegex = /--(give|want)\s+("[^"]+"|'[^']+'|[\s\S]+?)(?=\s--(?:give|want)\b|$)/gi;
  let match = flagRegex.exec(input);
  while (match) {
    const key = String(match[1] || "")
      .trim()
      .toLowerCase();
    const value = unwrapQuotedValue(match[2]);
    if (key && value) {
      byFlags[key] = value;
    }
    match = flagRegex.exec(input);
  }
  if (byFlags.give && byFlags.want) {
    return {
      valid: true,
      giveQuery: byFlags.give,
      wantQuery: byFlags.want,
      error: null,
    };
  }

  for (const separator of [/\s+por\s+/i, /\s+for\s+/i, /\s*->\s*/i, /\s*=>\s*/i]) {
    const parts = splitBySeparator(input, separator);
    if (parts) {
      return {
        valid: true,
        giveQuery: unwrapQuotedValue(parts[0]),
        wantQuery: unwrapQuotedValue(parts[1]),
        error: null,
      };
    }
  }

  const quotedValues = [];
  const quotedRegex = /"([^"]+)"|'([^']+)'/g;
  let quotedMatch = quotedRegex.exec(input);
  while (quotedMatch) {
    const value = unwrapQuotedValue(quotedMatch[1] || quotedMatch[2] || "");
    if (value) quotedValues.push(value);
    quotedMatch = quotedRegex.exec(input);
  }
  if (quotedValues.length >= 2) {
    return {
      valid: true,
      giveQuery: quotedValues[0],
      wantQuery: quotedValues[1],
      error: null,
    };
  }

  const tokens = input.split(/\s+/).filter(Boolean);
  if (tokens.length === 2) {
    return {
      valid: true,
      giveQuery: unwrapQuotedValue(tokens[0]),
      wantQuery: unwrapQuotedValue(tokens[1]),
      error: null,
    };
  }

  return {
    valid: false,
    giveQuery: null,
    wantQuery: null,
    error:
      "No pude interpretar la oferta. Usa `--give <tu personaje>` y `--want <personaje objetivo>`.",
  };
}

function formatTradeCharacterLabel(character, fallbackId = "") {
  const name = String(character?.name || "").trim();
  const anime = String(character?.anime || "").trim();
  const id = String(character?.id || fallbackId || "").trim();
  if (name && anime) return `${name} (${anime})`;
  if (name) return name;
  return id || "Desconocido";
}

function formatTradeExpiry(expiresAt) {
  if (!expiresAt || Number.isNaN(Date.parse(expiresAt))) return "";
  const msRemaining = Date.parse(expiresAt) - Date.now();
  if (msRemaining <= 0) return " | expirada";
  return ` | expira en ${formatDuration(msRemaining)}`;
}

function formatTradeLine(offer, mode) {
  const giveLabel = formatTradeCharacterLabel(offer?.offeredCharacter, offer?.offeredCharacterId);
  const wantLabel = formatTradeCharacterLabel(offer?.requestedCharacter, offer?.requestedCharacterId);
  const expiresText = formatTradeExpiry(offer?.expiresAt);
  const statusLabel = TRADE_STATUS_LABELS[String(offer?.status || "").toLowerCase()] || "Desconocido";

  if (mode === "incoming") {
    return `- \`${offer.id}\` <@${offer.proposerId}> ofrece **${giveLabel}** por **${wantLabel}**${expiresText}`;
  }

  if (mode === "outgoing") {
    return `- \`${offer.id}\` Ofreces **${giveLabel}** a <@${offer.targetId}> por **${wantLabel}**${expiresText}`;
  }

  return `- \`${offer.id}\` ${statusLabel}: <@${offer.proposerId}> -> <@${offer.targetId}> | **${giveLabel}** por **${wantLabel}**`;
}

function limitTradeLines(lines, maxLines = MAX_TRADE_PREVIEW_LINES) {
  const safeLines = Array.isArray(lines) ? lines : [];
  if (safeLines.length <= maxLines) return safeLines;
  return [...safeLines.slice(0, maxLines), `... y ${safeLines.length - maxLines} mas`];
}

function canUseRefreshBoard(message, config) {
  const configuredUserId = String(config?.gachaAdminUserId || "").trim();
  if (!configuredUserId) {
    return {
      allowed: false,
      error: `No hay admin configurado. Define GACHA_ADMIN_USER_ID en .env con tu ID de Discord (tu ID actual: ${message.author.id}).`,
    };
  }

  if (message.author.id !== configuredUserId) {
    return {
      allowed: false,
      error: `No tienes permiso para usar este comando. Tu ID: ${message.author.id}. Admin configurado: ${configuredUserId}.`,
    };
  }

  return { allowed: true, error: null };
}

function buildUserMeta(message, user = message.author, member = message.member) {
  return {
    username: user?.username || null,
    displayName: member?.displayName || user?.globalName || user?.username || null,
  };
}

function parseRollCount(rawValue) {
  if (typeof rawValue === "undefined") {
    return { valid: true, value: 1 };
  }

  const parsed = Number.parseInt(String(rawValue).trim(), 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return { valid: false, value: null };
  }

  return { valid: true, value: parsed };
}

function parseContractMaterialList(rawValue) {
  const input = String(rawValue || "").trim();
  if (!input) return { valid: true, materials: [] };

  const normalizedInput = input
    .replace(/^--?(pick|materials?)\s*/i, "")
    .trim();
  if (!normalizedInput) {
    return {
      valid: false,
      error:
        "Debes indicar IDs despues de `--pick`. Ejemplo: `--pick mal_1:3,anilist_2:2`.",
    };
  }

  const parts = normalizedInput
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) {
    return {
      valid: false,
      error:
        "Lista de materiales vacia. Usa IDs separados por coma. Ejemplo: `mal_1:3,anilist_2:2`.",
    };
  }

  const materials = [];
  for (const part of parts) {
    const match = part.match(/^([a-z0-9_-]+)(?::(\d+))?$/i);
    if (!match) {
      return {
        valid: false,
        error: `Material invalido: \`${part}\`. Formato esperado: \`id\` o \`id:cantidad\`.`,
      };
    }

    const id = String(match[1] || "")
      .trim()
      .toLowerCase();
    const count = match[2] ? Number.parseInt(match[2], 10) : 1;
    if (!id || Number.isNaN(count) || count <= 0) {
      return {
        valid: false,
        error: `Material invalido: \`${part}\`.`,
      };
    }

    materials.push({ id, count });
  }

  return { valid: true, materials };
}

function normalizeContractSourceRarity(rawValue) {
  const value = String(rawValue || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return CONTRACT_RARITY_ALIASES[value] || null;
}

function rarityLabel(rarity) {
  return ROLL_RARITY_LABELS[String(rarity || "").toLowerCase()] || String(rarity || "Desconocido");
}

function rarityOrderIndex(rarity) {
  const index = ROLL_RARITY_ORDER.indexOf(String(rarity || "").toLowerCase());
  return index >= 0 ? index : ROLL_RARITY_ORDER.length;
}

function sortMultiRollResults(results) {
  return (results || [])
    .map((entry, index) => ({
      ...entry,
      rollNumber: index + 1,
    }))
    .sort((a, b) => {
      const rarityDiff = rarityOrderIndex(a?.character?.rarity) - rarityOrderIndex(b?.character?.rarity);
      if (rarityDiff !== 0) return rarityDiff;

      const rankA = Number(a?.character?.popularityRank || 0) || Number.MAX_SAFE_INTEGER;
      const rankB = Number(b?.character?.popularityRank || 0) || Number.MAX_SAFE_INTEGER;
      if (rankA !== rankB) return rankA - rankB;

      const favDiff = Number(b?.character?.favorites || 0) - Number(a?.character?.favorites || 0);
      if (favDiff !== 0) return favDiff;

      return Number(a?.rollNumber || 0) - Number(b?.rollNumber || 0);
    });
}

function createGachaMessageHandler({ engine, config }) {
  return async function handleGachaMessage(message) {
    if (message.author.bot || !message.guild) return;
    if (!message.content.startsWith(config.prefix)) return;

    const input = message.content.slice(config.prefix.length).trim();
    if (!input) return;

    const [command, ...args] = input.split(/\s+/);
    if (command?.toLowerCase() !== "gacha") return;

    const rawSubcommand = args[0];
    const subcommand = normalizeSubcommand(rawSubcommand);

    try {
      if (subcommand === "unknown") {
        await message.reply(
          `Subcomando no reconocido: \`${rawSubcommand || ""}\`. Usa \`${config.prefix}gacha help\`.`
        );
        return;
      }

      if (subcommand === "help") {
        await message.reply({ embeds: [buildHelpEmbed(config.prefix)] });
        return;
      }

      if (subcommand === "board") {
        const board = await engine.getBoard();
        await sendBoardCarousel(message, board, engine.getBoardDate());
        return;
      }

      if (subcommand === "list") {
        const board = await engine.getBoard();
        await sendBoardListPagination(message, board, engine.getBoardDate(), config.prefix);
        return;
      }

      if (subcommand === "mythics") {
        const parsedPage = parseRollCount(args[1]);
        if (!parsedPage.valid) {
          await message.reply(`Uso: \`${config.prefix}gacha mythics [pagina]\`.`);
          return;
        }

        const mythics = await engine.getMythicCatalog();
        if (!mythics.length) {
          await message.reply("No hay personajes miticos en el catalogo actual.");
          return;
        }

        await sendMythicsPagination(message, mythics, config.prefix, parsedPage.value);
        return;
      }

      if (subcommand === "roll") {
        const parsedCount = parseRollCount(args[1]);
        if (!parsedCount.valid) {
          await message.reply(
            `Uso: \`${config.prefix}gacha roll [cantidad]\`. Ejemplo: \`${config.prefix}gacha roll 10\`.`
          );
          return;
        }

        const requestedRolls = parsedCount.value;
        const rollsToRun = Math.min(requestedRolls, MAX_ROLLS_PER_COMMAND);
        const userMeta = buildUserMeta(message);

        if (rollsToRun === 1) {
          const result = await engine.roll(message.author.id, userMeta);
          if (result.error) {
            await message.reply(`${result.error} Tiradas restantes: ${result.user?.rollsLeft ?? 0}`);
            return;
          }

          await message.reply({
            embeds: [
              buildRollEmbed(result.character, message.author.username, result.user.rollsLeft, {
                pityTriggered: result.pityTriggered,
                pityCounter: result.pityCounter,
                pityThreshold: result.pityThreshold,
                pitySoftThreshold: result.pitySoftThreshold,
                pityHardTriggered: result.pityHardTriggered,
                pitySoftBonusPercent: result.pitySoftBonusPercent,
              }),
            ],
          });
          return;
        }

        const multiResult = await engine.rollMany(message.author.id, rollsToRun, userMeta);
        if (multiResult.error) {
          await message.reply(`${multiResult.error} Tiradas restantes: ${multiResult.user?.rollsLeft ?? 0}`);
          return;
        }

        const sortedRollResults = sortMultiRollResults(multiResult.results);
        await sendRollResultsPagination(message, sortedRollResults, {
          requested: requestedRolls,
          executed: multiResult.executed,
          pityCounter: multiResult.pityCounter,
          pityThreshold: multiResult.pityThreshold,
          pitySoftThreshold: multiResult.pitySoftThreshold,
          mythicPityCounter: multiResult.mythicPityCounter,
          mythicPitySoftThreshold: multiResult.mythicPitySoftThreshold,
          mythicPityHardThreshold: multiResult.mythicPityHardThreshold,
          mythicHardPityTriggeredCount: multiResult.mythicHardPityTriggeredCount,
          mythicSoftPityActiveCount: multiResult.mythicSoftPityActiveCount,
          rollsLeft: multiResult.user?.rollsLeft ?? 0,
        });
        return;
      }

      if (subcommand === "daily") {
        const dailyResult = await engine.claimDaily(message.author.id, buildUserMeta(message));
        if (dailyResult.error) {
          await message.reply(
            `${dailyResult.error} Tiempo restante: ${formatDuration(dailyResult.msRemaining)}`
          );
          return;
        }

        await message.reply(
          `Daily reclamado: +${dailyResult.bonus} tiradas. Ahora tienes ${dailyResult.user.rollsLeft} tiradas.`
        );
        return;
      }

      if (subcommand === "boardtimer") {
        const info = engine.getBoardRefreshInfo();
        await message.reply(formatDuration(info.msRemaining));
        return;
      }

      if (subcommand === "profile") {
        const profile = await engine.getProfile(message.author.id, buildUserMeta(message));
        await message.reply({ embeds: [buildProfileEmbed(profile, message.author.username)] });
        return;
      }

      if (subcommand === "inventory") {
        const rawTargetToken = String(args[1] || "").trim();
        let targetUser = message.author;
        let targetMember = message.member;

        if (rawTargetToken) {
          const targetUserId = extractMentionedUserId(rawTargetToken);
          if (!targetUserId) {
            await message.reply(`Uso: \`${config.prefix}gacha inventory [@user]\`.`);
            return;
          }

          targetUser =
            message.mentions.users.get(targetUserId) ||
            (await message.client.users.fetch(targetUserId).catch(() => null));
          if (!targetUser) {
            await message.reply("No pude encontrar ese usuario.");
            return;
          }

          targetMember = message.guild?.members?.cache?.get(targetUserId) || null;
        }

        const targetMeta = buildUserMeta(message, targetUser, targetMember);
        const inventory = await engine.getInventory(targetUser.id, targetMeta);
        await sendInventoryCarousel(message, inventory.entries, targetMeta.displayName || targetUser.username);
        return;
      }

      if (subcommand === "contract") {
        const userMeta = buildUserMeta(message);
        const sourceRarity = normalizeContractSourceRarity(args[1]);

        if (!args[1]) {
          const info = await engine.getContractInfo(message.author.id, userMeta);
          const rules = info.rules
            .map(
              (rule) =>
                `- ${rarityLabel(rule.from)} -> ${rarityLabel(rule.to)}: ${rule.cost} ${rarityLabel(
                  rule.from
                )} | Tienes ${rule.availableCopies} | Posibles: ${rule.availableContracts}`
            )
            .join("\n");

          await message.reply(
            [
              "**Contratos disponibles**",
              rules || "No hay reglas de contrato configuradas.",
              `Maximo por comando: ${info.maxPerCommand}`,
              `Uso: \`${config.prefix}gacha contract <common|rare|epic|legendary> [cantidad] [--pick id[:copias],id[:copias],...]\``,
              `Tip: revisa IDs en \`${config.prefix}gacha inventory\`. La seleccion manual aplica en contratos epic/legendary.`,
            ].join("\n")
          );
          return;
        }

        if (!sourceRarity) {
          await message.reply(
            `Rareza invalida. Usa: \`${config.prefix}gacha contract <common|rare|epic|legendary> [cantidad] [--pick id[:copias],...]\`.`
          );
          return;
        }

        let contractsRequested = 1;
        let materialsStartIndex = 2;
        const countToken = String(args[2] || "").trim();
        if (countToken) {
          if (/^\d+$/.test(countToken)) {
            const parsedContracts = Number.parseInt(countToken, 10);
            if (Number.isNaN(parsedContracts) || parsedContracts <= 0) {
              await message.reply(
                `Uso: \`${config.prefix}gacha contract <common|rare|epic|legendary> [cantidad] [--pick id[:copias],...]\`.`
              );
              return;
            }
            contractsRequested = parsedContracts;
            materialsStartIndex = 3;
          } else {
            materialsStartIndex = 2;
          }
        }

        const parsedMaterials = parseContractMaterialList(args.slice(materialsStartIndex).join(" "));
        if (!parsedMaterials.valid) {
          await message.reply(parsedMaterials.error);
          return;
        }

        if (parsedMaterials.materials.length > 0 && !["epic", "legendary"].includes(sourceRarity)) {
          await message.reply(
            "La seleccion manual de materiales solo esta habilitada para contratos de rareza `epic` y `legendary`."
          );
          return;
        }

        const result = await engine.executeContract(
          message.author.id,
          sourceRarity,
          contractsRequested,
          userMeta,
          { materials: parsedMaterials.materials }
        );
        if (result.error) {
          await message.reply(result.error);
          return;
        }

        const rewardNameCounts = new Map();
        for (const reward of result.rewards) {
          const key = `${reward?.name || "Desconocido"}|${reward?.anime || "Anime desconocido"}`;
          rewardNameCounts.set(key, (rewardNameCounts.get(key) || 0) + 1);
        }

        const rewardPreview = [...rewardNameCounts.entries()]
          .slice(0, MAX_CONTRACT_PREVIEW_REWARDS)
          .map(([key, count]) => {
            const [name, anime] = key.split("|");
            return `${name} (${anime}) x${count}`;
          })
          .join(", ");
        const consumedPreview = (result.consumedById || [])
          .slice(0, MAX_CONTRACT_PREVIEW_REWARDS)
          .map((entry) => {
            const name = entry?.character?.name || entry?.id || "Desconocido";
            return `${name} x${entry.count}`;
          })
          .join(", ");

        const notes = [];
        if (result.executedContracts < result.requestedContracts) {
          if (result.executedContracts >= result.maxPerCommand) {
            notes.push(`Limite por comando: ${result.maxPerCommand}.`);
          }
          if (result.executedContracts >= result.maxByInventory) {
            notes.push(
              `Solo alcanzaban materiales para ${result.maxByInventory} contrato(s) de ${rarityLabel(
                result.rule.from
              )}.`
            );
          }
        }

        await message.reply(
          [
            `Contrato: ${rarityLabel(result.rule.from)} -> ${rarityLabel(result.rule.to)}`,
            `Ejecutados: ${result.executedContracts}/${result.requestedContracts}`,
            `Consumido: ${result.consumedCopies} ${rarityLabel(result.rule.from)}`,
            `Restante ${rarityLabel(result.rule.from)}: ${result.remainingSourceCopies}`,
            result.selectionUsed ? `Materiales elegidos: ${consumedPreview || "sin detalle"}` : null,
            rewardPreview ? `Obtenidos: ${rewardPreview}` : "Obtenidos: sin resultados",
            notes.length > 0 ? notes.join(" ") : null,
          ]
            .filter(Boolean)
            .join("\n")
        );
        return;
      }

      if (subcommand === "trade") {
        const tradeAction = normalizeTradeAction(args[1]);
        const tradeUsageLines = [
          `Uso: \`${config.prefix}gacha trade offer @usuario --give "<tu personaje o id>" --want "<personaje o id que pides>"\``,
          `Tambien puedes usar: \`${config.prefix}gacha trade offer @usuario <lo_tuyo> por <lo_que_pides>\``,
          `Gestion: \`${config.prefix}gacha trade list\`, \`${config.prefix}gacha trade accept <tradeId>\`, \`${config.prefix}gacha trade reject <tradeId>\`, \`${config.prefix}gacha trade cancel <tradeId>\``,
        ];
        const userMeta = buildUserMeta(message);

        if (tradeAction === "help") {
          await message.reply(tradeUsageLines.join("\n"));
          return;
        }

        if (tradeAction === "list") {
          const tradeInfo = await engine.listTradeOffersForUser(message.author.id, userMeta);
          const incomingLines = limitTradeLines(
            tradeInfo.incomingPending.map((offer) => formatTradeLine(offer, "incoming"))
          );
          const outgoingLines = limitTradeLines(
            tradeInfo.outgoingPending.map((offer) => formatTradeLine(offer, "outgoing"))
          );
          const recentLines = limitTradeLines(
            tradeInfo.recentResolved.map((offer) => formatTradeLine(offer, "history")),
            5
          );

          await message.reply(
            [
              "**Trades recibidos (pendientes)**",
              incomingLines.length > 0 ? incomingLines.join("\n") : "- Ninguno",
              "",
              "**Trades enviados (pendientes)**",
              outgoingLines.length > 0 ? outgoingLines.join("\n") : "- Ninguno",
              "",
              "**Ultimos trades resueltos**",
              recentLines.length > 0 ? recentLines.join("\n") : "- Sin historial",
            ].join("\n")
          );
          return;
        }

        if (tradeAction === "offer") {
          const targetUser = message.mentions.users.first();
          if (!targetUser) {
            await message.reply(
              [
                "Debes mencionar al usuario objetivo.",
                tradeUsageLines[0],
                tradeUsageLines[1],
              ].join("\n")
            );
            return;
          }

          if (targetUser.bot) {
            await message.reply("No puedes crear trades con bots.");
            return;
          }

          const detailTokens = args
            .slice(2)
            .filter((token) => !/^<@!?\d+>$/.test(String(token || "").trim()));
          const parsedTradeOffer = parseTradeOfferDetails(detailTokens.join(" "));
          if (!parsedTradeOffer.valid) {
            await message.reply(
              [
                parsedTradeOffer.error,
                tradeUsageLines[0],
                tradeUsageLines[1],
              ].join("\n")
            );
            return;
          }

          const targetMember =
            message.mentions.members.first() ||
            (targetUser.id === message.author.id ? message.member : null);
          const targetMeta = buildUserMeta(message, targetUser, targetMember);
          const offerResult = await engine.createTradeOffer({
            proposerId: message.author.id,
            targetId: targetUser.id,
            offeredQuery: parsedTradeOffer.giveQuery,
            requestedQuery: parsedTradeOffer.wantQuery,
            proposerMeta: userMeta,
            targetMeta,
          });

          if (offerResult.error) {
            await message.reply(offerResult.error);
            return;
          }

          const offer = offerResult.offer;
          await message.reply(
            [
              `Trade creado: \`${offer.id}\`.`,
              `Ofreces **${formatTradeCharacterLabel(
                offer.offeredCharacter,
                offer.offeredCharacterId
              )}** a <@${offer.targetId}> por **${formatTradeCharacterLabel(
                offer.requestedCharacter,
                offer.requestedCharacterId
              )}**.`,
              `La otra persona puede aceptar con: \`${config.prefix}gacha trade accept ${offer.id}\`.`,
              offer.expiresAt ? `Expira en: ${formatTradeExpiry(offer.expiresAt).replace(/^ \| /, "")}.` : null,
            ]
              .filter(Boolean)
              .join("\n")
          );
          return;
        }

        if (["accept", "reject", "cancel"].includes(tradeAction)) {
          let tradeId = String(args[2] || "").trim();

          if (!tradeId) {
            const tradeInfo = await engine.listTradeOffersForUser(message.author.id, userMeta);
            const candidates =
              tradeAction === "cancel" ? tradeInfo.outgoingPending : tradeInfo.incomingPending;

            if (!candidates.length) {
              await message.reply(
                `No tienes trades pendientes para esa accion. Usa \`${config.prefix}gacha trade list\`.`
              );
              return;
            }

            if (candidates.length > 1) {
              const options = candidates.map((offer) => `\`${offer.id}\``).join(", ");
              await message.reply(`Tienes multiples trades pendientes. Indica un ID: ${options}`);
              return;
            }

            tradeId = String(candidates[0].id || "").trim();
          }

          if (!tradeId) {
            await message.reply("Debes indicar un tradeId valido.");
            return;
          }

          if (tradeAction === "accept") {
            const result = await engine.acceptTradeOffer(tradeId, message.author.id, userMeta);
            if (result.error) {
              await message.reply(result.error);
              return;
            }

            const trade = result.offer;
            await message.reply(
              [
                `Trade \`${trade.id}\` aceptado.`,
                `<@${trade.proposerId}> recibe **${formatTradeCharacterLabel(
                  result.requestedCharacter,
                  trade.requestedCharacterId
                )}** y <@${trade.targetId}> recibe **${formatTradeCharacterLabel(
                  result.offeredCharacter,
                  trade.offeredCharacterId
                )}**.`,
              ].join("\n")
            );
            return;
          }

          if (tradeAction === "reject") {
            const result = await engine.rejectTradeOffer(tradeId, message.author.id, userMeta);
            if (result.error) {
              await message.reply(result.error);
              return;
            }

            await message.reply(`Trade \`${result.offer.id}\` rechazado.`);
            return;
          }

          const result = await engine.cancelTradeOffer(tradeId, message.author.id, userMeta);
          if (result.error) {
            await message.reply(result.error);
            return;
          }

          await message.reply(`Trade \`${result.offer.id}\` cancelado.`);
          return;
        }

        await message.reply(
          [
            `Accion de trade no reconocida: \`${args[1] || ""}\`.`,
            ...tradeUsageLines,
          ].join("\n")
        );
        return;
      }

      if (subcommand === "character") {
        const query = args.slice(1).join(" ").trim();
        if (!query) {
          await message.reply(
            `Uso: \`${config.prefix}gacha character <name|number>\`. Ejemplo: \`${config.prefix}gacha character 1\`.`
          );
          return;
        }

        const details = await engine.getCharacterDetails(query);
        if (details.error) {
          await message.reply(details.error);
          return;
        }

        await sendCharacterCarousel(message, details.character, details.images);
        return;
      }

      if (subcommand === "refreshboard") {
        console.log(`[Gacha] refreshboard requested by ${message.author.id}`);
        const access = canUseRefreshBoard(message, config);
        if (!access.allowed) {
          await message.reply(access.error);
          return;
        }

        const statusMessage = await message.reply("Regenerando tablero...");
        const board = await engine.refreshBoard();
        const boardCount = Array.isArray(board) ? board.length : 0;
        await statusMessage.edit(`Tablero regenerado. Personajes en board: ${boardCount}.`);
        return;
      }
    } catch (error) {
      console.error("[Gacha] command error:", error);
      await message.reply("Error ejecutando el comando.");
    }
  };
}

module.exports = {
  createGachaMessageHandler,
};
