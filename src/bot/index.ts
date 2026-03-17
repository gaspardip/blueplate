import { Bot } from "grammy";
import type { Config } from "../config.js";
import { BlueplateError, ParseError } from "../errors.js";
import { logger } from "../logger.js";
import type { Orchestrator } from "../orchestrator.js";
import type { LunchMoneyService } from "../lunchmoney/index.js";
import type { BlueplateDatabase } from "../storage/database.js";
import { createCommandHandlers } from "./commands.js";
import { formatConfirmation } from "./formatters.js";
import { authGuard, errorBoundary, requestLogger } from "./middleware.js";

export function createBot(
  config: Config,
  orchestrator: Orchestrator,
  lm: LunchMoneyService,
  db: BlueplateDatabase
): Bot {
  const bot = new Bot(config.telegramBotToken);

  // Middleware
  bot.use(errorBoundary());
  bot.use(requestLogger());
  bot.use(authGuard(config.allowedChatIds));

  // Commands
  const commands = createCommandHandlers(orchestrator, lm, db);
  bot.command("start", commands.start);
  bot.command("help", commands.help);
  bot.command("undo", commands.undo);
  bot.command("today", commands.today);
  bot.command("month", commands.month);
  bot.command("categories", commands.categories);
  bot.command("accounts", commands.accounts);

  // Free text → expense pipeline
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    const chatId = ctx.chat.id;
    const messageId = ctx.message.message_id;

    try {
      const result = await orchestrator.process(text, chatId, messageId);
      await ctx.reply(formatConfirmation(result));
    } catch (error) {
      if (error instanceof ParseError) {
        await ctx.reply(error.message);
        return;
      }
      if (error instanceof BlueplateError) {
        await ctx.reply(error.message);
        return;
      }
      throw error;
    }
  });

  return bot;
}

export async function startBot(bot: Bot, config: Config): Promise<void> {
  // Set bot commands for Telegram UI
  await bot.api.setMyCommands([
    { command: "start", description: "Welcome & usage guide" },
    { command: "help", description: "Syntax reference" },
    { command: "undo", description: "Undo last transaction" },
    { command: "today", description: "Today's transactions" },
    { command: "month", description: "This month's summary" },
    { command: "categories", description: "List categories" },
    { command: "accounts", description: "List accounts" },
  ]);

  if (config.mode === "webhook" && config.webhookUrl) {
    logger.info("Starting bot in webhook mode", { url: config.webhookUrl, port: config.webhookPort });
    await bot.api.setWebhook(config.webhookUrl);
    // For webhook mode, we'd need an HTTP server — grammY has adapters for this
    // For now, we only fully support polling mode
    logger.warn("Webhook HTTP server not yet implemented — use polling mode");
  } else {
    logger.info("Starting bot in polling mode");
    bot.start({
      onStart: () => logger.info("Bot is running"),
    });
  }
}
