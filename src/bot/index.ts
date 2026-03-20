import { Bot } from "grammy";
import type { Config } from "../config.js";
import { BlueplateError, ParseError } from "../errors.js";
import { logger } from "../logger.js";
import type { Orchestrator } from "../orchestrator.js";
import type { LunchMoneyService } from "../lunchmoney/index.js";
import type { BlueplateDatabase } from "../storage/database.js";
import { parseCorrection, parseCorrectionLoose } from "../parser/corrections.js";
import { createCommandHandlers } from "./commands.js";
import { formatConfirmation, formatUndone } from "./formatters.js";
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
  bot.command("alias", commands.alias);

  // Reactions: ❌ on the bot's confirmation message → undo
  bot.on("message_reaction", async (ctx) => {
    const reaction = ctx.messageReaction;
    if (!reaction) return;

    const chatId = reaction.chat.id;
    const newReactions = reaction.new_reaction;

    // Check for 👎 or 💩 reaction → undo
    const isUndo = newReactions.some(
      (r) => r.type === "emoji" && (r.emoji === "👎" || r.emoji === "💩")
    );

    if (isUndo) {
      try {
        const result = await orchestrator.undo(chatId);
        await bot.api.sendMessage(chatId, formatUndone(result.payee, result.amount, result.currency));
      } catch (error) {
        if (error instanceof BlueplateError) {
          await bot.api.sendMessage(chatId, error.message);
        } else {
          logger.error("Reaction undo failed", { error: String(error) });
        }
      }
    }
  });

  // Free text — check for reply-to-receipt, correction, then expense
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    const chatId = ctx.chat.id;
    const messageId = ctx.message.message_id;

    // Check if replying to a bot receipt → amend that specific transaction
    const replyTo = ctx.message.reply_to_message;
    if (replyTo && replyTo.from?.id === bot.botInfo.id) {
      const correction = parseCorrection(text) ?? parseCorrectionLoose(text);
      if (correction) {
        const record = db.getByBotReplyMessageId(chatId, replyTo.message_id);
        try {
          const result = await orchestrator.amend(chatId, correction, record?.id);
          const reply = await ctx.reply("Amended:\n" + formatConfirmation(result));
          const amended = record ?? db.getLastUndoable(chatId);
          if (amended) {
            db.setBotReplyMessageId(amended.id, reply.message_id);
          }
          return;
        } catch (error) {
          if (error instanceof BlueplateError) {
            await ctx.reply(error.message);
            return;
          }
          throw error;
        }
      }
    }

    // Try parsing as a correction to the last transaction
    const correction = parseCorrection(text);
    if (correction) {
      try {
        const result = await orchestrator.amend(chatId, correction);
        const reply = await ctx.reply("Amended:\n" + formatConfirmation(result));
        const lastRecord = db.getLastUndoable(chatId);
        if (lastRecord) {
          db.setBotReplyMessageId(lastRecord.id, reply.message_id);
        }
        return;
      } catch (error) {
        if (error instanceof BlueplateError) {
          // Not a valid correction — fall through to normal processing
          logger.debug("Correction failed, treating as new expense", { error: error.message });
        } else {
          throw error;
        }
      }
    }

    // Normal expense processing
    try {
      const result = await orchestrator.process(text, chatId, messageId);
      const reply = await ctx.reply(formatConfirmation(result));
      // Store the bot's reply message ID for future reply-based edits
      const record = db.getByExternalId(`bp_${chatId}_${messageId}`);
      if (record) {
        db.setBotReplyMessageId(record.id, reply.message_id);
      }
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
    { command: "alias", description: "Set payee alias: /alias starbux Starbucks" },
  ]);

  if (config.mode === "webhook" && config.webhookUrl) {
    logger.info("Starting bot in webhook mode", { url: config.webhookUrl });
    await bot.api.setWebhook(config.webhookUrl, {
      allowed_updates: ["message", "message_reaction"],
      secret_token: config.webhookSecret,
    });
  } else {
    logger.info("Starting bot in polling mode");

    // Drop pending updates to avoid reprocessing old messages on restart
    await bot.api.deleteWebhook({ drop_pending_updates: true });

    bot.catch((err) => {
      logger.error("Bot error", { error: String(err.error) });
    });

    // Retry polling on 409 (happens during rolling updates when two containers overlap)
    const startPolling = () => {
      bot.start({
        allowed_updates: ["message", "message_reaction"],
        onStart: () => logger.info("Bot is running"),
      }).catch((err) => {
        if (String(err).includes("409")) {
          logger.warn("Polling conflict (409), retrying in 5s...");
          setTimeout(startPolling, 5000);
        } else {
          logger.error("Fatal polling error", { error: String(err) });
          process.exit(1);
        }
      });
    };
    startPolling();
  }
}
