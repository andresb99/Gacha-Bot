const { ChannelType } = require("discord.js");
const { sendBoardCarousel } = require("../presentation/boardCarousel");

async function publishBoardToChannelName(client, engine, channelName = "gacha-bot") {
  if (!client || !client.guilds || !client.guilds.cache) return 0;
  const normalizedName = String(channelName || "gacha-bot")
    .trim()
    .toLowerCase();
  if (!normalizedName) return 0;

  const board = engine.getBoardCharacters();
  if (!Array.isArray(board) || board.length <= 0) return 0;
  const boardDate = engine.getBoardDate();
  let published = 0;

  for (const guild of client.guilds.cache.values()) {
    const targetChannel = guild.channels.cache.find((channel) => {
      return (
        channel &&
        channel.type === ChannelType.GuildText &&
        String(channel.name || "")
          .trim()
          .toLowerCase() === normalizedName
      );
    });
    if (!targetChannel || typeof targetChannel.send !== "function") continue;

    try {
      await sendBoardCarousel(targetChannel, board, boardDate);
      published += 1;
    } catch (error) {
      console.error(
        `[Gacha] no se pudo publicar board en #${targetChannel.name} (${guild.name}):`,
        error.message
      );
    }
  }

  return published;
}

function startMaintenanceJobs(engine, intervalMinutes = 1, options = {}) {
  const channelName = String(options?.channelName || "gacha-bot");
  const client = options?.client || null;
  let lastAnnouncedBoardUpdatedAt = engine?.gachaState?.boardUpdatedAt || null;
  const intervalMs = Math.max(1, intervalMinutes) * 60 * 1000;
  const runMaintenance = async () => {
    try {
      await engine.ensureBoard();
      const currentBoardUpdatedAt = engine?.gachaState?.boardUpdatedAt || null;
      if (client && currentBoardUpdatedAt && currentBoardUpdatedAt !== lastAnnouncedBoardUpdatedAt) {
        await publishBoardToChannelName(client, engine, channelName);
        lastAnnouncedBoardUpdatedAt = currentBoardUpdatedAt;
      }
      await engine.ensureMythicCatalog();
    } catch (error) {
      console.error("[Gacha] maintenance job failed:", error.message);
    }
  };

  // Run once on startup so a stale board doesn't wait for the first interval.
  runMaintenance();

  const timer = setInterval(async () => {
    await runMaintenance();
  }, intervalMs);

  if (typeof timer.unref === "function") {
    timer.unref();
  }

  return timer;
}

module.exports = {
  startMaintenanceJobs,
};
