import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import { BlueplateDatabase } from "../src/storage/database.js";
import { FXService } from "../src/fx/index.js";
import { LunchMoneyService } from "../src/lunchmoney/index.js";
import { Orchestrator } from "../src/orchestrator.js";
import { Bot } from "grammy";
import { createServer } from "../src/server.js";
import { unlinkSync } from "node:fs";

const TEST_DB_PATH = "/tmp/blueplate-server-test.db";
const TEST_SECRET = "test-secret-token";
const originalFetchFn = globalThis.fetch;

function setupMockFetch() {
  globalThis.fetch = mock((url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;

    // Pass through local requests to the actual server
    if (urlStr.includes("localhost") || urlStr.includes("127.0.0.1")) {
      return originalFetchFn(url, init);
    }

    if (urlStr.includes("dolarapi.com")) {
      return Promise.resolve(new Response(JSON.stringify({
        moneda: "USD", casa: "blue", compra: 1380, venta: 1425,
        fechaActualizacion: "2026-03-17T12:00:00.000Z",
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    if (urlStr.includes("/transactions") && init?.method === "POST") {
      return Promise.resolve(new Response(JSON.stringify({
        transactions: [{ id: 9876, date: "2026-03-17", payee: "Test", amount: "10.18", currency: "usd" }],
      }), { status: 201, headers: { "Content-Type": "application/json" } }));
    }

    if (urlStr.includes("/transactions/") && init?.method === "DELETE") {
      return Promise.resolve(new Response(null, { status: 204 }));
    }

    if (urlStr.includes("/categories")) {
      return Promise.resolve(new Response(JSON.stringify({ categories: [
        { id: 1, name: "🍽️ Restaurants", is_income: false, archived: false, is_group: false, group_id: null },
      ] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    if (urlStr.includes("/manual_accounts")) {
      return Promise.resolve(new Response(JSON.stringify({ manual_accounts: [
        { id: 10, name: "Visa", currency: "ARS", balance: "0", type: "credit", status: "active" },
      ] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    if (urlStr.includes("/tags")) {
      return Promise.resolve(new Response(JSON.stringify({ tags: [
        { id: 1, name: "recurring", archived: false },
      ] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    return Promise.resolve(new Response("Not found", { status: 404 }));
  }) as any;
}

describe("API server", () => {
  let db: BlueplateDatabase;
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    try { unlinkSync(TEST_DB_PATH); } catch {}
    db = await BlueplateDatabase.create(TEST_DB_PATH);
    db.upsertCategories([
      { id: 1, name: "🍽️ Restaurants", isIncome: false, archived: false },
    ]);
    db.upsertAssets([{ id: 10, name: "Visa", currency: "ARS" }]);

    originalFetch = globalThis.fetch;
    setupMockFetch();

    const fx = new FXService(db, 300);
    const lm = new LunchMoneyService("test-key", db, 3600_000);
    const orchestrator = new Orchestrator(db, lm, fx, "ARS");
    const bot = new Bot("fake:token");

    // Use random port to avoid conflicts
    const config = {
      telegramBotToken: "fake:token",
      lunchMoneyApiKey: "test-key",
      dbPath: TEST_DB_PATH,
      defaultCurrency: "ARS",
      mode: "polling" as const,
      webhookPort: 3000,
      allowedChatIds: [],
      logLevel: "error" as const,
      fxCacheTtl: 300,
      metadataCacheTtl: 3600,
      healthPort: 0, // random port
      webhookSecret: TEST_SECRET,
    };

    server = createServer(config, bot, orchestrator, lm, db);
    baseUrl = `http://localhost:${server.port}`;
  });

  afterEach(() => {
    server.stop();
    db.close();
    try { unlinkSync(TEST_DB_PATH); } catch {}
    globalThis.fetch = originalFetch;
  });

  describe("health check", () => {
    it("GET / returns ok", async () => {
      const res = await fetch(`${baseUrl}/`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ok");
    });

    it("GET /health returns ok", async () => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(200);
    });
  });

  describe("auth", () => {
    it("rejects API requests without auth", async () => {
      const res = await fetch(`${baseUrl}/api/categories`);
      expect(res.status).toBe(401);
    });

    it("rejects API requests with wrong token", async () => {
      const res = await fetch(`${baseUrl}/api/categories`, {
        headers: { Authorization: "Bearer wrong-token" },
      });
      expect(res.status).toBe(401);
    });

    it("accepts API requests with correct token", async () => {
      const res = await fetch(`${baseUrl}/api/categories`, {
        headers: { Authorization: `Bearer ${TEST_SECRET}` },
      });
      expect(res.status).toBe(200);
    });

    it("health check does not require auth", async () => {
      const res = await fetch(`${baseUrl}/`);
      expect(res.status).toBe(200);
    });
  });

  const authHeaders = { Authorization: `Bearer ${TEST_SECRET}` };

  describe("GET /api/categories", () => {
    it("returns categories", async () => {
      const res = await fetch(`${baseUrl}/api/categories`, { headers: authHeaders });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });
  });

  describe("GET /api/accounts", () => {
    it("returns accounts", async () => {
      const res = await fetch(`${baseUrl}/api/accounts`, { headers: authHeaders });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });
  });

  describe("GET /api/tags", () => {
    it("returns tags", async () => {
      const res = await fetch(`${baseUrl}/api/tags`, { headers: authHeaders });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });
  });

  describe("GET /api/transactions", () => {
    it("returns transactions for date", async () => {
      // Seed a transaction
      db.saveTransaction({
        externalId: "bp_1_1", lmTransactionId: 100, telegramChatId: 1,
        telegramMessageId: 1, amount: 5, currency: "USD", payee: "lunch", date: "2026-03-17",
      });

      const res = await fetch(`${baseUrl}/api/transactions?userId=1&date=2026-03-17`, { headers: authHeaders });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.length).toBe(1);
      expect(body[0].payee).toBe("lunch");
    });

    it("returns transactions for month", async () => {
      db.saveTransaction({
        externalId: "bp_1_1", lmTransactionId: 100, telegramChatId: 1,
        telegramMessageId: 1, amount: 5, currency: "USD", payee: "lunch", date: "2026-03-17",
      });

      const res = await fetch(`${baseUrl}/api/transactions?userId=1&month=2026-03`, { headers: authHeaders });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.length).toBe(1);
    });

    it("rejects missing userId", async () => {
      const res = await fetch(`${baseUrl}/api/transactions?date=2026-03-17`, { headers: authHeaders });
      expect(res.status).toBe(400);
    });

    it("rejects non-numeric userId", async () => {
      const res = await fetch(`${baseUrl}/api/transactions?userId=abc&date=2026-03-17`, { headers: authHeaders });
      expect(res.status).toBe(400);
    });

    it("rejects missing date and month", async () => {
      const res = await fetch(`${baseUrl}/api/transactions?userId=1`, { headers: authHeaders });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/transactions", () => {
    it("creates a transaction", async () => {
      const res = await fetch(`${baseUrl}/api/transactions`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ payee: "pizza", amount: 8000, userId: "1" }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.lmTransactionId).toBe(9876);
    });

    it("rejects missing payee", async () => {
      const res = await fetch(`${baseUrl}/api/transactions`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ amount: 8000, userId: "1" }),
      });
      expect(res.status).toBe(400);
    });

    it("rejects zero amount", async () => {
      const res = await fetch(`${baseUrl}/api/transactions`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ payee: "pizza", amount: 0, userId: "1" }),
      });
      expect(res.status).toBe(400);
    });

    it("rejects invalid JSON", async () => {
      const res = await fetch(`${baseUrl}/api/transactions`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: "not json",
      });
      expect(res.status).toBe(400);
    });

    it("rejects missing userId", async () => {
      const res = await fetch(`${baseUrl}/api/transactions`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ payee: "pizza", amount: 8000 }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /api/transactions/:id", () => {
    it("deletes a transaction", async () => {
      const res = await fetch(`${baseUrl}/api/transactions/9876?userId=1`, {
        method: "DELETE",
        headers: authHeaders,
      });
      expect(res.status).toBe(204);
    });

    it("rejects missing userId", async () => {
      const res = await fetch(`${baseUrl}/api/transactions/9876`, {
        method: "DELETE",
        headers: authHeaders,
      });
      expect(res.status).toBe(400);
    });
  });

  describe("404", () => {
    it("returns 404 for unknown routes", async () => {
      const res = await fetch(`${baseUrl}/api/unknown`, { headers: authHeaders });
      expect(res.status).toBe(404);
    });
  });
});
