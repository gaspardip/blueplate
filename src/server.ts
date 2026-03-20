import type { Bot } from "grammy";
import { webhookCallback } from "grammy";
import type { Config } from "./config.js";
import type { Orchestrator } from "./orchestrator.js";
import type { LunchMoneyService } from "./lunchmoney/index.js";
import type { BlueplateDatabase } from "./storage/database.js";

export function createServer(
  config: Config,
  bot: Bot,
  orchestrator: Orchestrator,
  lm: LunchMoneyService,
  db: BlueplateDatabase
) {
  const handleWebhook = webhookCallback(bot, "std/http", {
    secretToken: config.webhookSecret,
  });

  return Bun.serve({
    port: config.healthPort,
    async fetch(req) {
      const url = new URL(req.url);

      // Health check
      if (url.pathname === "/" || url.pathname === "/health") {
        return new Response("ok");
      }

      // Telegram webhook
      if (url.pathname === "/webhook" && req.method === "POST") {
        return handleWebhook(req);
      }

      // --- HTTP API ---

      // GET /api/categories
      if (url.pathname === "/api/categories" && req.method === "GET") {
        const categories = await lm.getCategories();
        return Response.json(categories);
      }

      // GET /api/accounts
      if (url.pathname === "/api/accounts" && req.method === "GET") {
        const accounts = await lm.getAccounts();
        return Response.json(accounts);
      }

      // GET /api/tags
      if (url.pathname === "/api/tags" && req.method === "GET") {
        const tags = await lm.getTags();
        return Response.json(tags);
      }

      // GET /api/transactions?date=YYYY-MM-DD or ?month=YYYY-MM
      if (url.pathname === "/api/transactions" && req.method === "GET") {
        const userId = url.searchParams.get("userId");
        if (!userId) return Response.json({ error: "userId required" }, { status: 400 });
        const chatId = Number(userId);

        const date = url.searchParams.get("date");
        if (date) {
          const txs = db.getTransactionsForDate(chatId, date);
          return Response.json(txs);
        }

        const month = url.searchParams.get("month");
        if (month) {
          const txs = db.getTransactionsForMonth(chatId, month);
          return Response.json(txs);
        }

        return Response.json({ error: "date or month param required" }, { status: 400 });
      }

      // POST /api/transactions
      if (url.pathname === "/api/transactions" && req.method === "POST") {
        const body = await req.json() as {
          payee: string;
          amount: number;
          currency?: string;
          categoryHint?: string;
          assetHint?: string;
          tags?: string[];
          note?: string;
          date?: string;
          userId: string;
        };

        if (!body.payee || !body.amount || !body.userId) {
          return Response.json({ error: "payee, amount, and userId required" }, { status: 400 });
        }

        const chatId = Number(body.userId);
        const messageId = Date.now(); // synthetic message ID for externalId
        const text = [
          body.payee,
          String(body.amount),
          body.currency,
          body.categoryHint,
          body.assetHint,
          ...(body.tags?.map((t) => `#${t}`) ?? []),
        ]
          .filter(Boolean)
          .join(" ");

        const result = await orchestrator.process(text, chatId, messageId);
        return Response.json(result, { status: 201 });
      }

      // DELETE /api/transactions/:id
      const deleteMatch = url.pathname.match(/^\/api\/transactions\/(\d+)$/);
      if (deleteMatch && req.method === "DELETE") {
        const lmId = Number(deleteMatch[1]);
        const userId = url.searchParams.get("userId");
        if (!userId) return Response.json({ error: "userId required" }, { status: 400 });

        await lm.rawClient.deleteTransaction(lmId);
        return new Response(null, { status: 204 });
      }

      return Response.json({ error: "Not found" }, { status: 404 });
    },
  });
}
