import { Bot } from "grammy";
import type { Config } from "../config.js";
import { BlueplateError, ParseError } from "../errors.js";
import { logger } from "../logger.js";
import type { Orchestrator } from "../orchestrator.js";
import type { LunchMoneyService } from "../lunchmoney/index.js";
import type { BlueplateDatabase } from "../storage/database.js";
import { parseCorrection, parseCorrectionLoose } from "../parser/corrections.js";
import { createCommandHandlers } from "./commands.js";
import { formatConfirmation, formatUndone, buildReceiptKeyboard } from "./formatters.js";
import { authGuard, errorBoundary, requestLogger } from "./middleware.js";
import { transcribe } from "../transcription.js";

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
  bot.command("fx", commands.fx);
  bot.command("rate", commands.fx);
  bot.command("search", commands.search);
  bot.command("template", commands.template);
  bot.command("t", commands.t);

  // Callback queries: inline keyboard buttons (Undo / Edit)
  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    const chatId = ctx.callbackQuery.message?.chat.id;
    if (!chatId) return;

    if (data.startsWith("undo:")) {
      const recordId = Number(data.slice(5));
      try {
        const result = await orchestrator.undo(chatId, recordId);
        await ctx.answerCallbackQuery("Undone");
        const currentText = ctx.callbackQuery.message && "text" in ctx.callbackQuery.message
          ? ctx.callbackQuery.message.text : "";
        await ctx.editMessageText(currentText + "\n\n[UNDONE]", { reply_markup: { inline_keyboard: [] } });
      } catch (error) {
        if (error instanceof BlueplateError) {
          await ctx.answerCallbackQuery(error.message);
        } else {
          logger.error("Callback undo failed", { error: String(error) });
          await ctx.answerCallbackQuery("Error");
        }
      }
      return;
    }

    if (data.startsWith("edit:")) {
      await ctx.answerCallbackQuery();
      await ctx.reply("Reply to the receipt above with your correction.");
      return;
    }

    if (data.startsWith("s:")) {
      const parts = data.slice(2).split(":");
      const query = parts.slice(0, -1).join(":");
      const offset = Number(parts[parts.length - 1]);
      const { rows, total } = db.searchTransactions(chatId, query, offset, 5);
      const { InlineKeyboard } = await import("grammy");
      const keyboard = new InlineKeyboard();
      if (offset > 0) keyboard.text("← Prev", `s:${query}:${offset - 5}`);
      if (offset + 5 < total) keyboard.text("Next →", `s:${query}:${offset + 5}`);
      const { formatSearchResults } = await import("./formatters.js");
      await ctx.editMessageText(formatSearchResults(rows, query, offset, total), {
        reply_markup: keyboard,
      });
      await ctx.answerCallbackQuery();
      return;
    }

    await ctx.answerCallbackQuery("Unknown action");
  });

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

  // Voice messages → transcribe → process as expense
  bot.on("message:voice", async (ctx) => {
    if (!config.openaiApiKey) {
      await ctx.reply("Voice messages not configured (missing OpenAI API key).");
      return;
    }

    const chatId = ctx.chat.id;
    const messageId = ctx.message.message_id;

    const file = await ctx.getFile();
    const url = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
    const resp = await fetch(url);
    const buffer = await resp.arrayBuffer();

    const text = await transcribe(buffer, config.openaiApiKey);
    logger.info("Voice transcribed", { chatId, text });

    try {
      const result = await orchestrator.process(text, chatId, messageId);
      const keyboard = result.localRecordId ? buildReceiptKeyboard(result.localRecordId) : undefined;
      const reply = await ctx.reply(`🎙 ${text}\n\n${formatConfirmation(result)}`, { reply_markup: keyboard });
      if (result.localRecordId) {
        db.setBotReplyMessageId(result.localRecordId, reply.message_id);
      }
    } catch (error) {
      if (error instanceof ParseError) {
        await ctx.reply(`🎙 ${text}\n\n${error.message}`);
        return;
      }
      if (error instanceof BlueplateError) {
        await ctx.reply(`🎙 ${text}\n\n${error.message}`);
        return;
      }
      throw error;
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
          const amendedRecord = record ?? db.getLastUndoable(chatId);
          const keyboard = amendedRecord ? buildReceiptKeyboard(amendedRecord.id) : undefined;
          const reply = await ctx.reply("Amended:\n" + formatConfirmation(result), { reply_markup: keyboard });
          if (amendedRecord) {
            db.setBotReplyMessageId(amendedRecord.id, reply.message_id);
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
        const lastRecord = db.getLastUndoable(chatId);
        const keyboard = lastRecord ? buildReceiptKeyboard(lastRecord.id) : undefined;
        const reply = await ctx.reply("Amended:\n" + formatConfirmation(result), { reply_markup: keyboard });
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
      const keyboard = result.localRecordId ? buildReceiptKeyboard(result.localRecordId) : undefined;
      const reply = await ctx.reply(formatConfirmation(result), { reply_markup: keyboard });
      if (result.localRecordId) {
        db.setBotReplyMessageId(result.localRecordId, reply.message_id);
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
    { command: "search", description: "Search transactions: /search pizza" },
    { command: "template", description: "Manage templates: /template add|list|delete" },
    { command: "t", description: "Apply template: /t netflix" },
    { command: "fx", description: "Current blue dollar rate" },
  ]);

  if (config.mode === "webhook" && config.webhookUrl) {
    logger.info("Starting bot in webhook mode", { url: config.webhookUrl });
    await bot.api.setWebhook(config.webhookUrl, {
      allowed_updates: ["message", "message_reaction", "callback_query"],
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
        allowed_updates: ["message", "message_reaction", "callback_query"],
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
