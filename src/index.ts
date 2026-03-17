import { loadConfig } from "./config.js";
import { logger, setLogLevel } from "./logger.js";
import { BlueplateDatabase } from "./storage/database.js";
import { FXService } from "./fx/index.js";
import { LunchMoneyService } from "./lunchmoney/index.js";
import { Orchestrator } from "./orchestrator.js";
import { createBot, startBot } from "./bot/index.js";
import { DailyDigest } from "./digest.js";

async function main() {
  // Load and validate config
  const config = loadConfig();
  setLogLevel(config.logLevel);
  logger.info("Blueplate starting", { mode: config.mode, defaultCurrency: config.defaultCurrency });

  // Init storage
  const db = await BlueplateDatabase.create(config.dbPath);
  logger.info("Database initialized", { path: config.dbPath });

  // Init services
  const fx = new FXService(db, config.fxCacheTtl);
  const lm = new LunchMoneyService(config.lunchMoneyApiKey, db, config.metadataCacheTtl * 1000);
  const orchestrator = new Orchestrator(db, lm, fx, config.defaultCurrency);

  // Pre-warm LM metadata cache
  try {
    await Promise.all([lm.getCategories(), lm.getAccounts(), lm.getTags()]);
    logger.info("LM metadata cache warmed");
  } catch (error) {
    logger.warn("Failed to warm LM cache — will retry on first use", { error: String(error) });
  }

  // Start bot
  const bot = createBot(config, orchestrator, lm, db);
  await startBot(bot, config);

  // Start daily digest (10 PM Argentina = UTC-3)
  const digest = new DailyDigest(bot, db, config.allowedChatIds, 22, 0);
  digest.start();

  // Graceful shutdown
  const shutdown = () => {
    logger.info("Shutting down");
    digest.stop();
    bot.stop();
    db.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  logger.error("Fatal error", { error: String(error), stack: error instanceof Error ? error.stack : undefined });
  process.exit(1);
});
