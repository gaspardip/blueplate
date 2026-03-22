import { Bot } from "grammy";
import type { Config } from "../config.js";
import { BlueplateError, ParseError } from "../errors.js";
import { logger } from "../logger.js";
import type { Orchestrator } from "../orchestrator.js";
import type { LunchMoneyService } from "../lunchmoney/index.js";
import type { BlueplateDatabase } from "../storage/database.js";
import { parseCorrection, parseCorrectionLoose } from "../parser/corrections.js";
import { createCommandHandlers } from "./commands.js";
import {
  formatConfirmation,
  formatUndone,
  buildReceiptKeyboard,
  formatImportSummary,
  formatImportResult,
  buildImportKeyboard,
} from "./formatters.js";
import { authGuard, errorBoundary, requestLogger } from "./middleware.js";
import { transcribe } from "../transcription.js";
import { extractPdfText, structureStatement } from "../pdf/index.js";
import type { StatementResult } from "../pdf/index.js";
import type { ProcessResult } from "../orchestrator.js";

function trackReceiptReply(db: BlueplateDatabase, result: ProcessResult, replyMessageId: number): void {
  if (result.accountLegs) {
    for (const leg of result.accountLegs) {
      db.setBotReplyMessageId(leg.localRecordId, replyMessageId);
    }
  } else if (result.localRecordId) {
    db.setBotReplyMessageId(result.localRecordId, replyMessageId);
  }
}

function receiptKeyboardId(result: ProcessResult): number | undefined {
  return result.splitGroupId ?? result.localRecordId;
}

interface PendingImport {
  result: StatementResult;
  usdPreview: Array<{ usdAmount: number; rate: number; isConverted: boolean }>;
  createdAt: number;
}

const PENDING_TTL_MS = 30 * 60 * 1000; // 30 minutes

export function createBot(
  config: Config,
  orchestrator: Orchestrator,
  lm: LunchMoneyService,
  db: BlueplateDatabase
): Bot {
  const bot = new Bot(config.telegramBotToken);
  const pendingImports = new Map<string, PendingImport>();

  // Cleanup stale pending imports periodically
  setInterval(() => {
    const now = Date.now();
    for (const [key, pending] of pendingImports) {
      if (now - pending.createdAt > PENDING_TTL_MS) {
        pendingImports.delete(key);
      }
    }
  }, 5 * 60 * 1000);

  // Dedup: Telegram retries webhook updates if the handler is slow (e.g., PDF processing).
  // Drop updates we've already seen.
  const seenUpdates = new Set<number>();
  setInterval(() => seenUpdates.clear(), 60_000);
  bot.use(async (ctx, next) => {
    if (seenUpdates.has(ctx.update.update_id)) return;
    seenUpdates.add(ctx.update.update_id);
    await next();
  });

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

    // Import: select account
    if (data.startsWith("imp_acct:")) {
      const rest = data.slice(9);
      const lastColon = rest.lastIndexOf(":");
      const importKey = rest.slice(0, lastColon);
      const assetId = Number(rest.slice(lastColon + 1));
      const pending = pendingImports.get(importKey);
      if (!pending) {
        await ctx.answerCallbackQuery("Import expired. Send the PDF again.");
        return;
      }
      const accounts = await lm.getAccounts();
      const keyboard = buildImportKeyboard(importKey, accounts, assetId);
      const summary = formatImportSummary(pending.result.transactions, pending.usdPreview);
      await ctx.editMessageText(summary, { reply_markup: keyboard });
      await ctx.answerCallbackQuery();
      return;
    }

    // Import: confirm — callback data: imp_confirm:{importKey}:{assetId}
    if (data.startsWith("imp_confirm:")) {
      const rest = data.slice(12);
      const lastColon = rest.lastIndexOf(":");
      const importKey = rest.slice(0, lastColon);
      const assetId = Number(rest.slice(lastColon + 1));
      const pending = pendingImports.get(importKey);
      if (!pending) {
        await ctx.answerCallbackQuery("Import expired. Send the PDF again.");
        return;
      }

      const accounts = await lm.getAccounts();
      const account = accounts.find((a) => a.id === assetId);
      if (!account) {
        await ctx.answerCallbackQuery("Account not found.");
        return;
      }

      await ctx.answerCallbackQuery("Importing...");

      try {
        const messageId = ctx.callbackQuery.message?.message_id ?? 0;
        const result = await orchestrator.processImport(
          pending.result.transactions, chatId, messageId, account.id, account.name,
        );
        pendingImports.delete(importKey);

        const text = formatImportResult(result.created, result.skipped, result.accountName);
        const { InlineKeyboard } = await import("grammy");
        const undoKb = new InlineKeyboard().text("Undo All", `undo:${result.splitGroupId}`);
        await ctx.editMessageText(text, { reply_markup: undoKb });
      } catch (error) {
        logger.error("Import failed", { error: String(error) });
        await ctx.editMessageText("Failed to create transactions. Try again.");
      }
      return;
    }

    // Import: cancel
    if (data.startsWith("imp_cancel:")) {
      const importKey = data.slice(11);
      pendingImports.delete(importKey);
      await ctx.editMessageText("Import cancelled.");
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

  // PDF documents → extract text → structure → import
  bot.on("message:document", async (ctx) => {
    const doc = ctx.message.document;
    if (!doc) return;

    if (doc.mime_type !== "application/pdf") {
      await ctx.reply("Send a PDF file. Photos aren't supported yet.");
      return;
    }

    if (!config.openaiApiKey) {
      await ctx.reply("PDF import requires OpenAI API key.");
      return;
    }

    if (doc.file_size && doc.file_size > 5 * 1024 * 1024) {
      await ctx.reply("PDF too large (max 5MB).");
      return;
    }

    const chatId = ctx.chat.id;
    const messageId = ctx.message.message_id;

    await ctx.replyWithChatAction("typing");

    let statementResult: StatementResult;
    try {
      const file = await ctx.getFile();
      if (!file.file_path) throw new Error("No file path returned");
      const url = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
      const buffer = await resp.arrayBuffer();

      const text = await extractPdfText(buffer);
      statementResult = await structureStatement(text, config.openaiApiKey);
    } catch (error) {
      if (error instanceof BlueplateError) {
        await ctx.reply(error.message);
        return;
      }
      logger.error("PDF processing failed", { chatId, error: String(error) });
      await ctx.reply("Couldn't download the file. Try again.");
      return;
    }

    if (statementResult.transactions.length === 0) {
      await ctx.reply("No transactions found in this PDF.");
      return;
    }

    const usdPreview = await orchestrator.previewImport(statementResult.transactions);
    const importKey = `${chatId}:${messageId}`;
    pendingImports.set(importKey, { result: statementResult, usdPreview, createdAt: Date.now() });

    const summary = formatImportSummary(statementResult.transactions, usdPreview);
    const accounts = await lm.getAccounts();
    const keyboard = buildImportKeyboard(importKey, accounts);
    await ctx.reply(summary + "\n\nSelect account:", { reply_markup: keyboard });
  });

  // Voice messages → transcribe → process as expense
  bot.on("message:voice", async (ctx) => {
    if (!config.openaiApiKey) {
      await ctx.reply("Voice messages not configured (missing OpenAI API key).");
      return;
    }

    const chatId = ctx.chat.id;
    const messageId = ctx.message.message_id;

    let text: string;
    try {
      const file = await ctx.getFile();
      if (!file.file_path) throw new Error("No file path returned");
      const url = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
      const buffer = await resp.arrayBuffer();
      text = await transcribe(buffer, config.openaiApiKey);
      logger.info("Voice transcribed", { chatId, text });
    } catch (error) {
      logger.error("Voice processing failed", { chatId, error: String(error) });
      await ctx.reply("Couldn't process voice message. Try again or type it out.");
      return;
    }

    try {
      const result = await orchestrator.process(text, chatId, messageId);
      const kid = receiptKeyboardId(result);
      const keyboard = kid ? buildReceiptKeyboard(kid) : undefined;
      const reply = await ctx.reply(`🎙 ${text}\n\n${formatConfirmation(result)}`, { reply_markup: keyboard });
      trackReceiptReply(db, result, reply.message_id);
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
      const kid = receiptKeyboardId(result);
      const keyboard = kid ? buildReceiptKeyboard(kid) : undefined;
      const reply = await ctx.reply(formatConfirmation(result), { reply_markup: keyboard });
      trackReceiptReply(db, result, reply.message_id);
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

  // Notify allowed chats that the bot is online
  for (const chatId of config.allowedChatIds) {
    bot.api.sendMessage(chatId, "Bot online.").catch((e) => logger.warn("Startup message failed", { chatId, error: String(e) }));
  }

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
