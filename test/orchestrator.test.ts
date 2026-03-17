import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import { BlueplateDatabase } from "../src/storage/database.js";
import { FXService } from "../src/fx/index.js";
import { LunchMoneyService } from "../src/lunchmoney/index.js";
import { Orchestrator } from "../src/orchestrator.js";
import { unlinkSync } from "node:fs";

const TEST_DB_PATH = "/tmp/blueplate-orch-test.db";

describe("Orchestrator", () => {
  let db: BlueplateDatabase;
  let orchestrator: Orchestrator;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    try { unlinkSync(TEST_DB_PATH); } catch {}
    db = await BlueplateDatabase.create(TEST_DB_PATH);

    // Seed categories
    db.upsertCategories([
      { id: 1, name: "Comida", isIncome: false, archived: false },
      { id: 2, name: "Transporte", isIncome: false, archived: false },
    ]);

    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    db.close();
    try { unlinkSync(TEST_DB_PATH); } catch {}
    globalThis.fetch = originalFetch;
  });

  function setupMockFetch(lmResponseId: number = 9876) {
    let callCount = 0;
    globalThis.fetch = mock((url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;

      // DolarAPI blue rate
      if (urlStr.includes("dolarapi.com")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              moneda: "USD",
              casa: "blue",
              nombre: "Blue",
              compra: 1380,
              venta: 1425,
              fechaActualizacion: "2026-03-17T12:00:00.000Z",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      }

      // LM create transaction
      if (urlStr.includes("lunchmoney") && urlStr.includes("/transactions")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ ids: [lmResponseId] }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      }

      // LM categories
      if (urlStr.includes("lunchmoney") && urlStr.includes("/categories")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ categories: [
              { id: 1, name: "Comida", is_income: false, archived: false, group_id: null },
              { id: 2, name: "Transporte", is_income: false, archived: false, group_id: null },
            ] }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      }

      // LM assets
      if (urlStr.includes("lunchmoney") && urlStr.includes("/assets")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ assets: [] }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      }

      // LM tags
      if (urlStr.includes("lunchmoney") && urlStr.includes("/tags")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ tags: [] }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      }

      return Promise.resolve(new Response("Not found", { status: 404 }));
    }) as any;
  }

  it("processes an ARS expense end-to-end", async () => {
    setupMockFetch();
    const fx = new FXService(db, 300);
    const lm = new LunchMoneyService("test-key", db, 3600_000);
    orchestrator = new Orchestrator(db, lm, fx, "ARS");

    const result = await orchestrator.process("café 14500 comida", 123, 456);

    expect(result.transaction.amount).toBe(10.18);
    expect(result.transaction.currency).toBe("USD");
    expect(result.transaction.originalAmount).toBe(14500);
    expect(result.transaction.originalCurrency).toBe("ARS");
    expect(result.transaction.payee).toBe("café");
    expect(result.categoryName).toBe("Comida");
    expect(result.fxRate).toBe(1425);
    expect(result.lmTransactionId).toBe(9876);

    // Verify stored in DB
    const stored = db.getByExternalId("bp_123_456");
    expect(stored).not.toBeNull();
    expect(stored!.amount).toBe(10.18);
  });

  it("processes a USD expense without conversion", async () => {
    setupMockFetch();
    const fx = new FXService(db, 300);
    const lm = new LunchMoneyService("test-key", db, 3600_000);
    orchestrator = new Orchestrator(db, lm, fx, "ARS");

    const result = await orchestrator.process("uber 12.50 usd", 123, 789);

    expect(result.transaction.amount).toBe(12.5);
    expect(result.transaction.currency).toBe("USD");
    expect(result.transaction.originalAmount).toBeUndefined();
    expect(result.fxRate).toBeUndefined();
  });

  it("returns cached result for duplicate message", async () => {
    setupMockFetch();
    const fx = new FXService(db, 300);
    const lm = new LunchMoneyService("test-key", db, 3600_000);
    orchestrator = new Orchestrator(db, lm, fx, "ARS");

    const first = await orchestrator.process("pizza 8000", 123, 100);
    const second = await orchestrator.process("pizza 8000", 123, 100);

    expect(second.lmTransactionId).toBe(first.lmTransactionId);
  });

  it("undoes the last transaction", async () => {
    setupMockFetch();

    // Mock DELETE response
    const origFetch = globalThis.fetch;
    globalThis.fetch = mock((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      if (init?.method === "DELETE") {
        return Promise.resolve(new Response("{}", { status: 200 }));
      }
      return (origFetch as any)(url, init);
    }) as any;

    // Re-setup with proper mock
    globalThis.fetch = originalFetch;
    setupMockFetch();

    const fx = new FXService(db, 300);
    const lm = new LunchMoneyService("test-key", db, 3600_000);
    orchestrator = new Orchestrator(db, lm, fx, "ARS");

    await orchestrator.process("pizza 8000", 123, 100);

    // Now mock DELETE for undo
    const afterProcessFetch = globalThis.fetch;
    globalThis.fetch = mock((url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        return Promise.resolve(
          new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } })
        );
      }
      return (afterProcessFetch as any)(url, init);
    }) as any;

    const undoResult = await orchestrator.undo(123);
    expect(undoResult.payee).toBe("pizza");

    // Verify undone in DB
    const undoable = db.getLastUndoable(123);
    expect(undoable).toBeNull();
  });
});
