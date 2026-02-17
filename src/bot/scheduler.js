function startMaintenanceJobs(engine, intervalMinutes = 1) {
  const intervalMs = Math.max(1, intervalMinutes) * 60 * 1000;
  const runMaintenance = async () => {
    try {
      await engine.ensureBoard();
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
