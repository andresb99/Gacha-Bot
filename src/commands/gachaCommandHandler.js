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
const ROLL_RARITY_ORDER = ["mythic", "legendary", "epic", "rare", "common"];
const ROLL_RARITY_LABELS = {
  common: "Comun",
  rare: "Raro",
  epic: "Epico",
  legendary: "Legendario",
  mythic: "Mitico",
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
  if (["character", "char"].includes(value)) return "character";
  if (["refreshboard", "resetboard"].includes(value)) return "refreshboard";
  return "unknown";
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

        const rarityCounts = {};
        for (const entry of multiResult.results) {
          const rarity = String(entry?.character?.rarity || "common");
          rarityCounts[rarity] = (rarityCounts[rarity] || 0) + 1;
        }

        const raritySummary = ROLL_RARITY_ORDER.filter((rarity) => rarityCounts[rarity] > 0)
          .map((rarity) => `${ROLL_RARITY_LABELS[rarity] || rarity}: ${rarityCounts[rarity]}`)
          .join(" | ");

        const highlights = multiResult.results
          .map((entry) => entry.character)
          .filter((character) => ["mythic", "legendary"].includes(String(character?.rarity || "")))
          .slice(0, 5)
          .map((character) => `[${String(character.rarity || "?").charAt(0).toUpperCase()}] ${character.name}`);

        const notes = [];
        if (requestedRolls > MAX_ROLLS_PER_COMMAND) {
          notes.push(`Limite por comando: ${MAX_ROLLS_PER_COMMAND}.`);
        }
        if (multiResult.executed < rollsToRun) {
          notes.push(`Solo se pudieron hacer ${multiResult.executed}/${rollsToRun} por tiradas disponibles.`);
        }

        await message.reply(
          [
            `Tiradas: ${multiResult.executed}/${multiResult.requested}`,
            `Rarezas: ${raritySummary || "Sin resultados"}`,
            `Pity hard mitica: ${multiResult.mythicHardPityTriggeredCount} vez/veces`,
            `Soft pity activo: ${multiResult.mythicSoftPityActiveCount} tirada(s)`,
            `Pity mitica: ${multiResult.mythicPityCounter}/${multiResult.mythicPityHardThreshold} (soft ${multiResult.mythicPitySoftThreshold})`,
            `Tiradas restantes: ${multiResult.user?.rollsLeft ?? 0}`,
            highlights.length > 0 ? `Destacados: ${highlights.join(", ")}` : null,
            notes.length > 0 ? notes.join(" ") : null,
          ]
            .filter(Boolean)
            .join("\n")
        );

        const sortedRollResults = sortMultiRollResults(multiResult.results);
        await sendRollResultsPagination(message, sortedRollResults, {
          requested: multiResult.requested,
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
        const targetUser = message.mentions.users.first() || message.author;
        const targetMember =
          message.mentions.members.first() ||
          (targetUser.id === message.author.id ? message.member : null);
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
