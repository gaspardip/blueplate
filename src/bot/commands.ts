import type { Context } from "grammy";
import type { Orchestrator } from "../orchestrator.js";
import type { LunchMoneyService } from "../lunchmoney/index.js";
import { PayeeNormalizer } from "../payee.js";
import type { BlueplateDatabase } from "../storage/database.js";
import {
  formatAssets,
  formatCategories,
  formatDaySummary,
  formatMonthSummary,
} from "./formatters.js";

export function createCommandHandlers(
  orchestrator: Orchestrator,
  lm: LunchMoneyService,
  db: BlueplateDatabase
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
          "  <payee> <amount> [currency] [category]\n" +
          "  <amount> [currency] <payee> [category]\n\n" +
          "Modifiers:\n" +
          "  #tag — add a tag\n" +
          "  note:text — add a note\n" +
          "  date:YYYY-MM-DD — set date\n" +
          "  yesterday / ayer — set date to yesterday\n\n" +
          "Currencies: ars/pesos, usd/dolares, eur/euros\n" +
          "Default currency: ARS (converted to USD via blue rate)\n\n" +
          "Examples:\n" +
          "  café 14500 ars comida\n" +
          "  uber 12.50 usd\n" +
          "  pizza 1500 #delivery\n" +
          "  almuerzo 8500 ayer"
      );
    },

    undo: async (ctx: Context) => {
      const result = await orchestrator.undo(ctx.chat!.id);
      const { formatUndone } = await import("./formatters.js");
      await ctx.reply(formatUndone(result.payee, result.amount, result.currency));
    },

    today: async (ctx: Context) => {
      const chatId = ctx.chat!.id;
      const today = new Date().toISOString().slice(0, 10);
      const rows = db.getTransactionsForDate(chatId, today);
      await ctx.reply(formatDaySummary(rows, today));
    },

    month: async (ctx: Context) => {
      const chatId = ctx.chat!.id;
      const yearMonth = new Date().toISOString().slice(0, 7);
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
