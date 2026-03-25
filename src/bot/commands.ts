import type { Context } from "grammy";
import type { Orchestrator } from "../orchestrator.js";
import type { LunchMoneyService } from "../lunchmoney/index.js";
import { fetchBlueRateRaw } from "../fx/dolar-api.js";
import { PayeeNormalizer } from "../payee.js";
import { todayStr, yearMonthStr, weekRangeStr } from "../utils.js";
import type { BlueplateDatabase } from "../storage/database.js";
import {
  formatAssets,
  formatCategories,
  formatConfirmation,
  formatDaySummary,
  formatFxRate,
  formatMonthSummary,
  formatSearchResults,
  formatTemplateList,
  formatUndone,
  formatTopExpenses,
  formatCategoryBreakdown,
  formatPayeeBreakdown,
} from "./formatters.js";

export function createCommandHandlers(
  orchestrator: Orchestrator,
  lm: LunchMoneyService,
  db: BlueplateDatabase,
) {
  return {
    start: async (ctx: Context) => {
      await ctx.reply(
        "Blueplate — expense tracker for Lunch Money.\n\n" +
          "Send a message like:\n" +
          "  pizza 1500\n" +
          "  café 14500 ars comida\n" +
          "  uber 12.50 usd\n\n" +
          "Commands:\n" +
          "  /undo — undo last transaction\n" +
          "  /today — today's transactions\n" +
          "  /month — this month's summary\n" +
          "  /categories — list categories\n" +
          "  /accounts — list accounts\n" +
          "  /help — syntax reference"
      );
    },

    help: async (ctx: Context) => {
      await ctx.reply(
        "Syntax:\n" +
          "  <payee> <amount> [currency] [category] [account]\n\n" +
          "Amounts: 1500, 15k, 1.5m, $500k\n" +
          "Income: prefix with - (e.g. -500k)\n" +
          "Currencies: ars/pesos, usd/dolares, eur/euros\n" +
          "Accounts: visa, amex, mp (Mercado Pago), banco\n\n" +
          "Modifiers:\n" +
          "  #tag — add a tag\n" +
          "  note:text — add a note\n" +
          "  date:YYYY-MM-DD or ayer/yesterday\n\n" +
          "Corrections (amend last entry):\n" +
          "  no, 12k — fix amount\n" +
          "  wrong, visa — fix account\n" +
          "  actually restaurants — fix category\n\n" +
          "Quick undo: react 👎 to any message\n\n" +
          "Examples:\n" +
          "  starbucks 8k cafe mp\n" +
          "  uber 12.50 usd taxi\n" +
          "  pizza 15k visa comida\n" +
          "  sueldo -500k"
      );
    },

    undo: async (ctx: Context) => {
      const result = await orchestrator.undo(ctx.chat!.id);
      await ctx.reply(formatUndone(result.payee, result.amount, result.currency));
    },

    today: async (ctx: Context) => {
      const chatId = ctx.chat!.id;
      const today = todayStr();
      const rows = db.getTransactionsForDate(chatId, today);
      await ctx.reply(formatDaySummary(rows, today));
    },

    month: async (ctx: Context) => {
      const chatId = ctx.chat!.id;
      const yearMonth = yearMonthStr();
      const rows = db.getTransactionsForMonth(chatId, yearMonth);
      await ctx.reply(formatMonthSummary(rows, yearMonth));
    },

    categories: async (ctx: Context) => {
      const cats = await lm.getCategories(true);
      await ctx.reply(formatCategories(cats));
    },

    accounts: async (ctx: Context) => {
      const assets = await lm.getAccounts(true);
      await ctx.reply(formatAssets(assets));
    },

    search: async (ctx: Context) => {
      const chatId = ctx.chat!.id;
      const query = (ctx.message?.text ?? "").replace(/^\/search\s*/, "").trim();
      if (!query) {
        await ctx.reply("Usage: /search <payee or date>\nExamples: /search starbucks, /search 2026-03");
        return;
      }
      const { rows, total } = db.searchTransactions(chatId, query, 0, 5);
      const { InlineKeyboard } = await import("grammy");
      const keyboard = new InlineKeyboard();
      if (total > 5) keyboard.text("Next →", `s:${query}:5`);
      await ctx.reply(formatSearchResults(rows, query, 0, total), {
        reply_markup: total > 5 ? keyboard : undefined,
      });
    },

    template: async (ctx: Context) => {
      const chatId = ctx.chat!.id;
      const args = (ctx.message?.text ?? "").replace(/^\/template\s*/, "").trim();

      if (!args || args === "list") {
        const templates = db.listTemplates(chatId);
        await ctx.reply(formatTemplateList(templates));
        return;
      }

      if (args.startsWith("delete ") || args.startsWith("del ") || args.startsWith("rm ")) {
        const name = args.replace(/^(delete|del|rm)\s+/, "").trim();
        const deleted = db.deleteTemplate(chatId, name);
        await ctx.reply(deleted ? `Template "${name}" deleted.` : `Template "${name}" not found.`);
        return;
      }

      if (args.startsWith("add ")) {
        const rest = args.slice(4).trim();
        const spaceIdx = rest.indexOf(" ");
        if (spaceIdx === -1) {
          await ctx.reply("Usage: /template add <name> <expense text>\nExample: /template add netflix 15 usd streaming");
          return;
        }
        const name = rest.slice(0, spaceIdx);
        const text = rest.slice(spaceIdx + 1).trim();
        db.saveTemplate(chatId, name, text);
        await ctx.reply(`Template "${name}" saved. Use /t ${name} to apply.`);
        return;
      }

      await ctx.reply("Usage:\n  /template add <name> <text>\n  /template list\n  /template delete <name>");
    },

    t: async (ctx: Context) => {
      const chatId = ctx.chat!.id;
      const messageId = ctx.message!.message_id;
      const name = (ctx.message?.text ?? "").replace(/^\/t\s*/, "").trim();
      if (!name) {
        await ctx.reply("Usage: /t <template-name>\nSee /template list for available templates.");
        return;
      }
      const template = db.getTemplate(chatId, name);
      if (!template) {
        await ctx.reply(`Template "${name}" not found. See /template list.`);
        return;
      }
      // Feed the template text through the normal expense pipeline
      const result = await orchestrator.process(template.text, chatId, messageId);
      const { buildReceiptKeyboard } = await import("./formatters.js");
      const keyboard = result.localRecordId ? buildReceiptKeyboard(result.localRecordId) : undefined;
      const reply = await ctx.reply(formatConfirmation(result), { reply_markup: keyboard });
      if (result.localRecordId) {
        db.setBotReplyMessageId(result.localRecordId, reply.message_id);
      }
    },

    fx: async (ctx: Context) => {
      const data = await fetchBlueRateRaw();
      const history = db.getRecentFxRates("ARS/USD", 5);
      await ctx.reply(formatFxRate(data, history));
    },

    top: async (ctx: Context) => {
      const chatId = ctx.chat!.id;
      const args = (ctx.message?.text ?? "").replace(/^\/top\s*/, "").trim().toLowerCase();

      if (args === "week" || args === "semana") {
        const { weekStart, weekEnd } = weekRangeStr();
        const rows = db.getTransactionsForDateRange(chatId, weekStart, weekEnd);
        await ctx.reply(formatTopExpenses(rows, `${weekStart} – ${weekEnd}`));
      } else if (args === "category" || args === "cat" || args === "categoria") {
        const ym = yearMonthStr();
        const rows = db.getTransactionsForMonth(chatId, ym);
        await ctx.reply(formatCategoryBreakdown(rows, ym));
      } else if (args === "payee" || args === "comercio") {
        const ym = yearMonthStr();
        const rows = db.getTransactionsForMonth(chatId, ym);
        await ctx.reply(formatPayeeBreakdown(rows, ym));
      } else {
        const ym = yearMonthStr();
        const rows = db.getTransactionsForMonth(chatId, ym);
        await ctx.reply(formatTopExpenses(rows, ym));
      }
    },

    alias: async (ctx: Context) => {
      const text = ctx.message?.text ?? "";
      const parts = text.replace(/^\/alias\s*/, "").trim().split(/\s+/);
      if (parts.length < 2) {
        await ctx.reply("Usage: /alias <variant> <canonical>\nExample: /alias starbux Starbucks");
        return;
      }
      const alias = parts[0];
      const canonical = parts.slice(1).join(" ");
      const normalizer = new PayeeNormalizer(db);
      normalizer.setAlias(alias, canonical);
      await ctx.reply(`Alias set: "${alias}" → "${canonical}"`);
    },
  };
}
