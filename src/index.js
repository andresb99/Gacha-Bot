const config = require("./config");
const { FirestoreStore } = require("./storage/store");
const { GachaEngine } = require("./gacha/engine");
const { createDiscordClient } = require("./bot/client");
const { startMaintenanceJobs } = require("./bot/scheduler");
const { createGachaMessageHandler } = require("./commands/gachaCommandHandler");

function hasFirebaseCredentialSource(firebaseConfig) {
  return Boolean(
    firebaseConfig.serviceAccountPath ||
      (firebaseConfig.projectId && firebaseConfig.clientEmail && firebaseConfig.privateKey) ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS
  );
}

async function bootstrapBot() {
  if (!config.token) {
    throw new Error("Falta DISCORD_TOKEN en .env");
  }

  if (!hasFirebaseCredentialSource(config.firebase)) {
    console.warn(
      "[Config] Firebase credentials no detectadas en .env. Intentando application default credentials."
    );
  }

  const store = new FirestoreStore(config.firebase);
  const engine = new GachaEngine(store, config);
  const client = createDiscordClient();
  const gachaHandler = createGachaMessageHandler({ engine, config });
  let gachaReady = false;

  client.once("clientReady", async () => {
    console.log(`[Bot] conectado como ${client.user.tag}`);
    try {
      await engine.bootstrap();
      startMaintenanceJobs(engine, 1);
      gachaReady = true;
      console.log("[Bot] gacha inicializado");
    } catch (error) {
      console.error("[Bot] error inicializando gacha:", error);
      process.exit(1);
    }
  });

  client.on("messageCreate", async (message) => {
    if (!gachaReady) return;
    await gachaHandler(message);
  });

  await client.login(config.token);
}

bootstrapBot().catch((error) => {
  console.error("[Bot] error fatal:", error);
  process.exit(1);
});
