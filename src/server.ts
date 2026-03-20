import type { Bot } from "grammy";
import { webhookCallback } from "grammy";
import type { Config } from "./config.js";
import type { Orchestrator } from "./orchestrator.js";
import type { LunchMoneyService } from "./lunchmoney/index.js";
import type { BlueplateDatabase } from "./storage/database.js";
import { logger } from "./logger.js";

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

  function authenticateApi(req: Request): boolean {
    if (!config.webhookSecret) return true;
    const auth = req.headers.get("authorization");
    return auth === `Bearer ${config.webhookSecret}`;
  }

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

      // --- HTTP API (auth required) ---
      if (url.pathname.startsWith("/api/")) {
        if (!authenticateApi(req)) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        try {
          return await handleApi(url, req);
        } catch (error) {
          logger.error("API error", { path: url.pathname, error: String(error) });
          return Response.json({ error: "Internal server error" }, { status: 500 });
        }
      }

      return Response.json({ error: "Not found" }, { status: 404 });
    },
  });

  async function handleApi(url: URL, req: Request): Promise<Response> {
    // GET /api/categories
    if (url.pathname === "/api/categories" && req.method === "GET") {
      return Response.json(await lm.getCategories());
    }

    // GET /api/accounts
    if (url.pathname === "/api/accounts" && req.method === "GET") {
      return Response.json(await lm.getAccounts());
    }

    // GET /api/tags
    if (url.pathname === "/api/tags" && req.method === "GET") {
      return Response.json(await lm.getTags());
    }

    // GET /api/transactions?date=YYYY-MM-DD or ?month=YYYY-MM
    if (url.pathname === "/api/transactions" && req.method === "GET") {
      const userId = url.searchParams.get("userId");
      if (!userId) return Response.json({ error: "userId required" }, { status: 400 });
      const chatId = Number(userId);
      if (isNaN(chatId)) return Response.json({ error: "invalid userId" }, { status: 400 });

      const date = url.searchParams.get("date");
      if (date) return Response.json(db.getTransactionsForDate(chatId, date));

      const month = url.searchParams.get("month");
      if (month) return Response.json(db.getTransactionsForMonth(chatId, month));

      return Response.json({ error: "date or month param required" }, { status: 400 });
    }

    // POST /api/transactions
    if (url.pathname === "/api/transactions" && req.method === "POST") {
      let body: Record<string, unknown>;
      try {
        body = await req.json();
      } catch {
        return Response.json({ error: "Invalid JSON body" }, { status: 400 });
      }

      const { payee, amount, currency, categoryHint, assetHint, tags, userId } = body as {
        payee?: string; amount?: number; currency?: string;
        categoryHint?: string; assetHint?: string; tags?: string[];
        userId?: string;
      };

      if (!payee || !amount || !userId) {
        return Response.json({ error: "payee, amount, and userId required" }, { status: 400 });
      }

      const chatId = Number(userId);
      if (isNaN(chatId)) return Response.json({ error: "invalid userId" }, { status: 400 });

      const messageId = Date.now() + Math.floor(Math.random() * 1000);
      const text = [payee, String(amount), currency, categoryHint, assetHint,
        ...(tags?.map((t) => `#${t}`) ?? [])].filter(Boolean).join(" ");

      const result = await orchestrator.process(text, chatId, messageId);
      return Response.json(result, { status: 201 });
    }

    // DELETE /api/transactions/:id
    if (req.method === "DELETE") {
      const match = url.pathname.match(/^\/api\/transactions\/(\d+)$/);
      if (match) {
        const lmId = Number(match[1]);
        const userId = url.searchParams.get("userId");
        if (!userId) return Response.json({ error: "userId required" }, { status: 400 });

        await lm.rawClient.deleteTransaction(lmId);
        return new Response(null, { status: 204 });
      }
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  }
}
