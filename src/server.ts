import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { bearerAuth } from "hono/bearer-auth";
import type { Bot } from "grammy";
import { webhookCallback } from "grammy";
import type { Config } from "./config.js";
import type { Orchestrator } from "./orchestrator.js";
import type { LunchMoneyService } from "./lunchmoney/index.js";
import type { BlueplateDatabase } from "./storage/database.js";
import { logger } from "./logger.js";

const transactionsQuerySchema = z.object({
  userId: z.string().regex(/^\d+$/, "userId must be numeric"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
}).refine((d) => d.date || d.month, { message: "date or month param required" });

const createTransactionSchema = z.object({
  payee: z.string().min(1),
  amount: z.number().refine((n) => n !== 0, "amount cannot be zero"),
  currency: z.string().optional(),
  categoryHint: z.string().optional(),
  assetHint: z.string().optional(),
  tags: z.array(z.string()).optional(),
  note: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  userId: z.string().regex(/^\d+$/, "userId must be numeric"),
});

const deleteQuerySchema = z.object({
  userId: z.string().regex(/^\d+$/, "userId must be numeric"),
});

export function createServer(
  config: Config,
  bot: Bot,
  orchestrator: Orchestrator,
  lm: LunchMoneyService,
  db: BlueplateDatabase
) {
  const app = new Hono();

  // --- Error handler ---
  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return err.getResponse();
    }
    logger.error("API error", { path: c.req.path, error: String(err) });
    return c.json({ error: "Internal server error" }, 500);
  });

  // --- Health check ---
  app.get("/", (c) => c.text("ok"));
  app.get("/health", (c) => c.text("ok"));

  // --- Telegram webhook ---
  const handleWebhook = webhookCallback(bot, "std/http", {
    secretToken: config.webhookSecret,
  });
  app.post("/webhook", (c) => handleWebhook(c.req.raw));

  // --- API routes (auth required) ---
  const api = new Hono();

  if (config.webhookSecret) {
    api.use("*", bearerAuth({ token: config.webhookSecret }));
  }

  api.get("/categories", async (c) => {
    return c.json(await lm.getCategories());
  });

  api.get("/accounts", async (c) => {
    return c.json(await lm.getAccounts());
  });

  api.get("/tags", async (c) => {
    return c.json(await lm.getTags());
  });

  api.get("/transactions", zValidator("query", transactionsQuerySchema), async (c) => {
    const { userId, date, month } = c.req.valid("query");
    const chatId = Number(userId);

    if (date) return c.json(db.getTransactionsForDate(chatId, date));
    return c.json(db.getTransactionsForMonth(chatId, month!));
  });

  api.post("/transactions", zValidator("json", createTransactionSchema), async (c) => {
    const { payee, amount, currency, categoryHint, assetHint, tags, note, date, userId } = c.req.valid("json");
    const chatId = Number(userId);
    const messageId = Date.now() + Math.floor(Math.random() * 1000);

    const result = await orchestrator.processStructured(
      { payee, amount, currency, categoryHint, assetHint, tags, note, date },
      chatId, messageId
    );
    return c.json(result, 201);
  });

  api.delete("/transactions/:id", zValidator("query", deleteQuerySchema), async (c) => {
    const lmId = Number(c.req.param("id"));
    await lm.rawClient.deleteTransaction(lmId);
    return c.body(null, 204);
  });

  app.route("/api", api);

  // --- Start server ---
  return Bun.serve({
    port: config.healthPort,
    fetch: app.fetch,
  });
}
