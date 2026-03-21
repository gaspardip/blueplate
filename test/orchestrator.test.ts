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
    globalThis.fetch = mock((url: string | URL | Request, init?: RequestInit) => {
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

      // LM create transaction — v2 returns 201 with full objects
      if (urlStr.includes("/transactions") && init?.method === "POST") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              transactions: [{ id: lmResponseId, date: "2026-03-17", payee: "Test", amount: "10.18", currency: "usd" }],
            }),
            { status: 201, headers: { "Content-Type": "application/json" } }
          )
        );
      }

      // LM delete transaction — v2 returns 204 No Content
      if (urlStr.includes("/transactions/") && init?.method === "DELETE") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }

      // LM transactions list
      if (urlStr.includes("/transactions")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ transactions: [] }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      }

      // LM categories — v2 returns nested by default
      if (urlStr.includes("/categories")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ categories: [
              { id: 1, name: "Comida", is_income: false, archived: false, is_group: false, group_id: null },
              { id: 2, name: "Transporte", is_income: false, archived: false, is_group: false, group_id: null },
            ] }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      }

      // LM manual_accounts — v2 renamed from /assets
      if (urlStr.includes("/manual_accounts")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ manual_accounts: [] }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      }

      // LM tags
      if (urlStr.includes("/tags")) {
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

    expect(result.transaction.amount).toBe(10.51);
    expect(result.transaction.currency).toBe("USD");
    expect(result.transaction.originalAmount).toBe(14500);
    expect(result.transaction.originalCurrency).toBe("ARS");
    expect(result.transaction.payee).toBe("Café");
    expect(result.categoryName).toBe("Comida");
    expect(result.fxRate).toBe(1380);
    expect(result.lmTransactionId).toBe(9876);

    // Verify stored in DB
    const stored = db.getByExternalId("bp_123_456");
    expect(stored).not.toBeNull();
    expect(stored!.amount).toBe(10.51);
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
    const fx = new FXService(db, 300);
    const lm = new LunchMoneyService("test-key", db, 3600_000);
    orchestrator = new Orchestrator(db, lm, fx, "ARS");

    await orchestrator.process("pizza 8000", 123, 100);

    const undoResult = await orchestrator.undo(123);
    expect(undoResult.payee).toBe("Pizza");

    // Verify undone in DB
    const undoable = db.getLastUndoable(123);
    expect(undoable).toBeNull();
  });

  it("amends amount on last transaction", async () => {
    setupMockFetch();
    // Also mock PUT for update
    const prevFetch = globalThis.fetch;
    const originalMock = prevFetch;
    globalThis.fetch = mock((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      if (urlStr.includes("/transactions/") && init?.method === "PUT") {
        return Promise.resolve(new Response(JSON.stringify({ id: 9876 }), {
          status: 200, headers: { "Content-Type": "application/json" },
        }));
      }
      return (originalMock as any)(url, init);
    }) as any;

    const fx = new FXService(db, 300);
    const lm = new LunchMoneyService("test-key", db, 3600_000);
    orchestrator = new Orchestrator(db, lm, fx, "ARS");

    await orchestrator.process("pizza 8000", 123, 200);
    const result = await orchestrator.amend(123, { amount: 10000 });

    expect(result.transaction.originalAmount).toBe(10000);
    expect(result.lmTransactionId).toBe(9876);
  });

  it("amends payee on last transaction", async () => {
    setupMockFetch();
    const prevFetch = globalThis.fetch;
    globalThis.fetch = mock((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      if (urlStr.includes("/transactions/") && init?.method === "PUT") {
        return Promise.resolve(new Response(JSON.stringify({ id: 9876 }), {
          status: 200, headers: { "Content-Type": "application/json" },
        }));
      }
      return (prevFetch as any)(url, init);
    }) as any;

    const fx = new FXService(db, 300);
    const lm = new LunchMoneyService("test-key", db, 3600_000);
    orchestrator = new Orchestrator(db, lm, fx, "ARS");

    await orchestrator.process("pizza 8000", 123, 201);
    const result = await orchestrator.amend(123, { payee: "burger king" });

    expect(result.transaction.payee).toBe("Burger King");
  });

  it("amend throws when nothing to amend", async () => {
    setupMockFetch();
    const fx = new FXService(db, 300);
    const lm = new LunchMoneyService("test-key", db, 3600_000);
    orchestrator = new Orchestrator(db, lm, fx, "ARS");

    expect(orchestrator.amend(999, { amount: 5000 })).rejects.toThrow("Nothing to amend");
  });

  it("amend with USD amount skips FX conversion", async () => {
    setupMockFetch();
    const prevFetch = globalThis.fetch;
    globalThis.fetch = mock((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      if (urlStr.includes("/transactions/") && init?.method === "PUT") {
        return Promise.resolve(new Response(JSON.stringify({ id: 9876 }), {
          status: 200, headers: { "Content-Type": "application/json" },
        }));
      }
      return (prevFetch as any)(url, init);
    }) as any;

    const fx = new FXService(db, 300);
    const lm = new LunchMoneyService("test-key", db, 3600_000);
    orchestrator = new Orchestrator(db, lm, fx, "ARS");

    await orchestrator.process("uber 12 usd", 123, 202);
    const result = await orchestrator.amend(123, { amount: 15, currency: "USD" });

    expect(result.transaction.amount).toBe(15);
    expect(result.transaction.originalAmount).toBeUndefined();
  });

  it("amend updates local DB record", async () => {
    setupMockFetch();
    const prevFetch = globalThis.fetch;
    globalThis.fetch = mock((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      if (urlStr.includes("/transactions/") && init?.method === "PUT") {
        return Promise.resolve(new Response(JSON.stringify({ id: 9876 }), {
          status: 200, headers: { "Content-Type": "application/json" },
        }));
      }
      return (prevFetch as any)(url, init);
    }) as any;

    const fx = new FXService(db, 300);
    const lm = new LunchMoneyService("test-key", db, 3600_000);
    orchestrator = new Orchestrator(db, lm, fx, "ARS");

    await orchestrator.process("pizza 8000", 123, 203);
    await orchestrator.amend(123, { payee: "burger" });

    const record = db.getLastUndoable(123);
    expect(record!.payee).toBe("Burger");
  });

  describe("processImport", () => {
    function setupImportFetch() {
      let lmIdCounter = 8000;
      globalThis.fetch = mock((url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;

        if (urlStr.includes("dolarapi.com")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ moneda: "USD", casa: "blue", compra: 1380, venta: 1425, fechaActualizacion: "2026-03-17T12:00:00.000Z" }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
          );
        }

        if (urlStr.includes("/transactions") && init?.method === "POST") {
          const body = JSON.parse(init.body as string);
          const txs = body.transactions.map((_: unknown, i: number) => ({
            id: lmIdCounter + i, date: "2026-03-17", payee: "Test", amount: "10.00", currency: "usd",
          }));
          lmIdCounter += txs.length;
          return Promise.resolve(
            new Response(JSON.stringify({ transactions: txs }), { status: 201, headers: { "Content-Type": "application/json" } }),
          );
        }

        if (urlStr.includes("/transactions/") && init?.method === "DELETE") {
          return Promise.resolve(new Response(null, { status: 204 }));
        }

        if (urlStr.includes("/transactions")) {
          return Promise.resolve(
            new Response(JSON.stringify({ transactions: [] }), { status: 200, headers: { "Content-Type": "application/json" } }),
          );
        }

        if (urlStr.includes("/categories")) {
          return Promise.resolve(
            new Response(JSON.stringify({ categories: [] }), { status: 200, headers: { "Content-Type": "application/json" } }),
          );
        }

        if (urlStr.includes("/manual_accounts")) {
          return Promise.resolve(
            new Response(JSON.stringify({ manual_accounts: [] }), { status: 200, headers: { "Content-Type": "application/json" } }),
          );
        }

        if (urlStr.includes("/tags")) {
          return Promise.resolve(
            new Response(JSON.stringify({ tags: [] }), { status: 200, headers: { "Content-Type": "application/json" } }),
          );
        }

        return Promise.resolve(new Response("Not found", { status: 404 }));
      }) as any;
    }

    it("creates transactions with import external_id prefix", async () => {
      setupImportFetch();
      const fx = new FXService(db, 300);
      const lm = new LunchMoneyService("test-key", db, 3600_000);
      orchestrator = new Orchestrator(db, lm, fx, "ARS");

      const transactions = [
        { date: "2026-03-01", payee: "Mercado Libre", amount: 15200, currency: "ARS" },
        { date: "2026-03-02", payee: "Netflix", amount: 4500, currency: "ARS" },
      ];

      const result = await orchestrator.processImport(transactions, 123, 700, 10, "Visa");

      expect(result.created).toBe(2);
      expect(result.skipped).toBe(0);
      expect(result.accountName).toBe("Visa");
      expect(result.splitGroupId).toBeDefined();

      // Verify external_id pattern
      const record0 = db.getByExternalId("bp_import_123_700_0");
      const record1 = db.getByExternalId("bp_import_123_700_1");
      expect(record0).not.toBeNull();
      expect(record1).not.toBeNull();
      expect(record0!.asset_name).toBe("Visa");
      expect(record1!.asset_name).toBe("Visa");
    });

    it("links all import records via split_group_id", async () => {
      setupImportFetch();
      const fx = new FXService(db, 300);
      const lm = new LunchMoneyService("test-key", db, 3600_000);
      orchestrator = new Orchestrator(db, lm, fx, "ARS");

      const transactions = [
        { date: "2026-03-01", payee: "A", amount: 1000, currency: "ARS" },
        { date: "2026-03-02", payee: "B", amount: 2000, currency: "ARS" },
        { date: "2026-03-03", payee: "C", amount: 3000, currency: "ARS" },
      ];

      const result = await orchestrator.processImport(transactions, 123, 701, 10, "Visa");
      const group = db.getByGroupId(result.splitGroupId);
      expect(group.length).toBe(3);
    });

    it("dedup returns cached result on re-import", async () => {
      setupImportFetch();
      const fx = new FXService(db, 300);
      const lm = new LunchMoneyService("test-key", db, 3600_000);
      orchestrator = new Orchestrator(db, lm, fx, "ARS");

      const transactions = [
        { date: "2026-03-01", payee: "Test", amount: 5000, currency: "ARS" },
      ];

      const first = await orchestrator.processImport(transactions, 123, 702, 10, "Visa");
      const second = await orchestrator.processImport(transactions, 123, 702, 10, "Visa");

      expect(second.splitGroupId).toBe(first.splitGroupId);
      expect(second.created).toBe(1);
    });

    it("undo-all deletes all imported transactions", async () => {
      setupImportFetch();
      const fx = new FXService(db, 300);
      const lm = new LunchMoneyService("test-key", db, 3600_000);
      orchestrator = new Orchestrator(db, lm, fx, "ARS");

      const transactions = [
        { date: "2026-03-01", payee: "A", amount: 1000, currency: "ARS" },
        { date: "2026-03-02", payee: "B", amount: 2000, currency: "ARS" },
      ];

      const result = await orchestrator.processImport(transactions, 123, 703, 10, "Visa");
      const firstRecord = db.getByExternalId("bp_import_123_703_0");
      expect(firstRecord).not.toBeNull();

      await orchestrator.undo(123, firstRecord!.id);

      // All records should be undone
      const group = db.getByGroupId(result.splitGroupId);
      expect(group.length).toBe(0);
    });

    it("converts ARS to USD via FX for imported transactions", async () => {
      setupImportFetch();
      const fx = new FXService(db, 300);
      const lm = new LunchMoneyService("test-key", db, 3600_000);
      orchestrator = new Orchestrator(db, lm, fx, "ARS");

      const transactions = [
        { date: "2026-03-01", payee: "Test", amount: 13800, currency: "ARS" },
      ];

      const result = await orchestrator.processImport(transactions, 123, 704, 10, "Visa");
      const record = db.getByExternalId("bp_import_123_704_0");
      expect(record).not.toBeNull();
      expect(record!.currency).toBe("USD");
      expect(record!.original_amount).toBe(13800);
      expect(record!.original_currency).toBe("ARS");
      expect(record!.amount).toBe(10); // 13800 / 1380
    });

    it("uses historical rate for each transaction's date", async () => {
      setupImportFetch();
      const fx = new FXService(db, 300);
      const lm = new LunchMoneyService("test-key", db, 3600_000);
      orchestrator = new Orchestrator(db, lm, fx, "ARS");

      // Seed historical rates for different dates
      db.saveFxRate("ARS/USD", 1300, "argentinadatos-blue", "2026-02-01T18:00:00.000Z");
      db.saveFxRate("ARS/USD", 1350, "argentinadatos-blue", "2026-02-15T18:00:00.000Z");

      const transactions = [
        { date: "2026-02-01", payee: "A", amount: 1300, currency: "ARS" },
        { date: "2026-02-15", payee: "B", amount: 13500, currency: "ARS" },
      ];

      await orchestrator.processImport(transactions, 123, 705, 10, "Visa");

      const r0 = db.getByExternalId("bp_import_123_705_0")!;
      const r1 = db.getByExternalId("bp_import_123_705_1")!;
      expect(r0.fx_rate).toBe(1300);
      expect(r0.amount).toBe(1);    // 1300 / 1300
      expect(r1.fx_rate).toBe(1350);
      expect(r1.amount).toBe(10);   // 13500 / 1350
    });

    it("falls back to current rate when no historical rate cached", async () => {
      setupImportFetch();
      const fx = new FXService(db, 300);
      const lm = new LunchMoneyService("test-key", db, 3600_000);
      orchestrator = new Orchestrator(db, lm, fx, "ARS");

      // No historical rates seeded — will fetch current (1380)
      const transactions = [
        { date: "2026-01-15", payee: "Test", amount: 13800, currency: "ARS" },
      ];

      await orchestrator.processImport(transactions, 123, 706, 10, "Visa");

      const record = db.getByExternalId("bp_import_123_706_0");
      expect(record).not.toBeNull();
      expect(record!.fx_rate).toBe(1380); // current rate
      expect(record!.amount).toBe(10);
    });

    it("uses different rates for transactions on different dates", async () => {
      setupImportFetch();
      const fx = new FXService(db, 300);
      const lm = new LunchMoneyService("test-key", db, 3600_000);
      orchestrator = new Orchestrator(db, lm, fx, "ARS");

      db.saveFxRate("ARS/USD", 1300, "argentinadatos-blue", "2026-02-01T18:00:00.000Z");
      db.saveFxRate("ARS/USD", 1400, "argentinadatos-blue", "2026-02-10T18:00:00.000Z");
      db.saveFxRate("ARS/USD", 1500, "argentinadatos-blue", "2026-02-14T18:00:00.000Z");

      const transactions = [
        { date: "2026-02-01", payee: "A", amount: 1300, currency: "ARS" },
        { date: "2026-02-10", payee: "B", amount: 2800, currency: "ARS" },
        { date: "2026-02-14", payee: "C", amount: 7500, currency: "ARS" },
      ];

      await orchestrator.processImport(transactions, 123, 707, 10, "Visa");

      const r0 = db.getByExternalId("bp_import_123_707_0")!;
      const r1 = db.getByExternalId("bp_import_123_707_1")!;
      const r2 = db.getByExternalId("bp_import_123_707_2")!;
      expect(r0.fx_rate).toBe(1300);
      expect(r0.amount).toBe(1);    // 1300/1300
      expect(r1.fx_rate).toBe(1400);
      expect(r1.amount).toBe(2);    // 2800/1400
      expect(r2.fx_rate).toBe(1500);
      expect(r2.amount).toBe(5);    // 7500/1500
    });

    it("skips transactions that match a manually logged entry by amount+date", async () => {
      setupImportFetch();
      const fx = new FXService(db, 300);
      const lm = new LunchMoneyService("test-key", db, 3600_000);
      orchestrator = new Orchestrator(db, lm, fx, "ARS");

      // Manually log a transaction (simulates user typing "starbucks 3780")
      await orchestrator.process("starbucks 3780", 123, 800);

      // Now import a statement that includes the same charge
      const transactions = [
        { date: new Date().toISOString().slice(0, 10), payee: "STARBUCKS STORE 1042", amount: 3780, currency: "ARS" },
        { date: new Date().toISOString().slice(0, 10), payee: "NETFLIX.COM", amount: 4500, currency: "ARS" },
      ];

      const result = await orchestrator.processImport(transactions, 123, 801, 10, "Visa");

      expect(result.skipped).toBe(1);
      expect(result.created).toBe(1);
      // Only Netflix should have been created
      const record = db.getByExternalId("bp_import_123_801_1");
      expect(record).not.toBeNull();
      // Starbucks should NOT exist
      const skipped = db.getByExternalId("bp_import_123_801_0");
      expect(skipped).toBeNull();
    });

    it("imports all when no manual entries match", async () => {
      setupImportFetch();
      const fx = new FXService(db, 300);
      const lm = new LunchMoneyService("test-key", db, 3600_000);
      orchestrator = new Orchestrator(db, lm, fx, "ARS");

      const transactions = [
        { date: "2026-03-01", payee: "A", amount: 1000, currency: "ARS" },
        { date: "2026-03-02", payee: "B", amount: 2000, currency: "ARS" },
      ];

      const result = await orchestrator.processImport(transactions, 123, 802, 10, "Visa");
      expect(result.skipped).toBe(0);
      expect(result.created).toBe(2);
    });

    it("returns zero created when all transactions are duplicates", async () => {
      setupImportFetch();
      const fx = new FXService(db, 300);
      const lm = new LunchMoneyService("test-key", db, 3600_000);
      orchestrator = new Orchestrator(db, lm, fx, "ARS");

      const today = new Date().toISOString().slice(0, 10);
      await orchestrator.process("cafe 5000", 123, 803);
      await orchestrator.process("uber 8000", 123, 804);

      const transactions = [
        { date: today, payee: "CAFE MARTINEZ", amount: 5000, currency: "ARS" },
        { date: today, payee: "UBER *TRIP", amount: 8000, currency: "ARS" },
      ];

      const result = await orchestrator.processImport(transactions, 123, 805, 10, "Visa");
      expect(result.skipped).toBe(2);
      expect(result.created).toBe(0);
    });
  });

  function setupMockFetchWithAccounts() {
    let lmIdCounter = 9000;
    globalThis.fetch = mock((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;

      if (urlStr.includes("dolarapi.com")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ moneda: "USD", casa: "blue", compra: 1380, venta: 1425, fechaActualizacion: "2026-03-17T12:00:00.000Z" }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      }

      if (urlStr.includes("/transactions") && init?.method === "POST") {
        const body = JSON.parse(init.body as string);
        const txs = body.transactions.map((_: unknown, i: number) => ({
          id: lmIdCounter + i, date: "2026-03-17", payee: "Test", amount: "10.00", currency: "usd",
        }));
        lmIdCounter += txs.length;
        return Promise.resolve(
          new Response(JSON.stringify({ transactions: txs }), { status: 201, headers: { "Content-Type": "application/json" } })
        );
      }

      if (urlStr.includes("/transactions/") && init?.method === "DELETE") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }

      if (urlStr.includes("/transactions")) {
        return Promise.resolve(
          new Response(JSON.stringify({ transactions: [] }), { status: 200, headers: { "Content-Type": "application/json" } })
        );
      }

      if (urlStr.includes("/categories")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ categories: [
              { id: 1, name: "Comida", is_income: false, archived: false, is_group: false, group_id: null },
            ] }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      }

      if (urlStr.includes("/manual_accounts")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ manual_accounts: [
              { id: 10, name: "Mercado Pago", display_name: null, type: "cash", currency: "ars", balance: "0", to_base: 1, status: "active", exclude_from_transactions: false, created_by_name: "test", balance_as_of: "2026-03-17", created_at: "", updated_at: "" },
              { id: 12, name: "Visa", display_name: null, type: "credit", currency: "ars", balance: "0", to_base: 1, status: "active", exclude_from_transactions: false, created_by_name: "test", balance_as_of: "2026-03-17", created_at: "", updated_at: "" },
            ] }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      }

      if (urlStr.includes("/tags")) {
        return Promise.resolve(
          new Response(JSON.stringify({ tags: [] }), { status: 200, headers: { "Content-Type": "application/json" } })
        );
      }

      return Promise.resolve(new Response("Not found", { status: 404 }));
    }) as any;
  }

  it("processes multi-account split creating N records", async () => {
    setupMockFetchWithAccounts();
    const fx = new FXService(db, 300);
    const lm = new LunchMoneyService("test-key", db, 3600_000);
    orchestrator = new Orchestrator(db, lm, fx, "ARS");

    const result = await orchestrator.process("pizza 15k mp:5k visa:10k comida", 123, 500);

    expect(result.accountLegs).toBeDefined();
    expect(result.accountLegs!.length).toBe(2);
    expect(result.accountLegs![0].accountName).toBe("Mercado Pago");
    expect(result.accountLegs![1].accountName).toBe("Visa");
    expect(result.splitGroupId).toBeDefined();
    expect(result.categoryName).toBe("Comida");

    // Verify local records
    const groupRecords = db.getByGroupId(result.splitGroupId!);
    expect(groupRecords.length).toBe(2);
    expect(groupRecords[0].asset_name).toBe("Mercado Pago");
    expect(groupRecords[1].asset_name).toBe("Visa");
  });

  it("multi-account undo deletes all legs", async () => {
    setupMockFetchWithAccounts();
    const fx = new FXService(db, 300);
    const lm = new LunchMoneyService("test-key", db, 3600_000);
    orchestrator = new Orchestrator(db, lm, fx, "ARS");

    const result = await orchestrator.process("pizza 15k mp:5k visa:10k", 123, 501);
    expect(result.splitGroupId).toBeDefined();

    const undoResult = await orchestrator.undo(123, result.localRecordId);
    expect(undoResult.payee).toBe("Pizza");

    // All legs should be undone
    const groupRecords = db.getByGroupId(result.splitGroupId!);
    expect(groupRecords.length).toBe(0);
  });

  it("multi-account dedup returns cached result", async () => {
    setupMockFetchWithAccounts();
    const fx = new FXService(db, 300);
    const lm = new LunchMoneyService("test-key", db, 3600_000);
    orchestrator = new Orchestrator(db, lm, fx, "ARS");

    const first = await orchestrator.process("pizza 15k mp:5k visa:10k", 123, 502);
    const second = await orchestrator.process("pizza 15k mp:5k visa:10k", 123, 502);

    expect(second.splitGroupId).toBe(first.splitGroupId);
    expect(second.accountLegs!.length).toBe(2);
  });
});
