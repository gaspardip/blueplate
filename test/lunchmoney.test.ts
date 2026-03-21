import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import { transactionToPayload, buildMetadata } from "../src/lunchmoney/mapper.js";
import { LunchMoneyClient } from "../src/lunchmoney/client.js";
import type { Transaction } from "../src/types.js";

describe("LunchMoney mapper", () => {
  describe("transactionToPayload", () => {
    it("builds basic payload with custom_metadata", () => {
      const tx: Transaction = {
        amount: 10.18,
        currency: "USD",
        payee: "café",
        date: "2026-03-17",
        externalId: "bp_123_456",
      };

      const metadata = buildMetadata(tx, 123, 456);
      const payload = transactionToPayload(tx, metadata);

      expect(payload.payee).toBe("café");
      expect(payload.amount).toBe("10.18");
      expect(payload.currency).toBe("usd");
      expect(payload.date).toBe("2026-03-17");
      expect(payload.external_id).toBe("bp_123_456");
      expect(payload.status).toBe("reviewed");
      expect(payload.custom_metadata).toBeDefined();
      expect(payload.custom_metadata!.blueplate_version).toBe(1);
      expect(payload.custom_metadata!.ingested_via).toBe("telegram");
      expect(payload.notes).toBeUndefined();
    });

    it("includes user note in notes field", () => {
      const tx: Transaction = {
        amount: 5,
        currency: "USD",
        payee: "test",
        date: "2026-03-17",
        externalId: "bp_1_1",
      };

      const metadata = buildMetadata(tx, 1, 1);
      const payload = transactionToPayload(tx, metadata, "shared with friends");

      expect(payload.notes).toBe("shared with friends");
      expect(payload.custom_metadata).toBeDefined();
    });

    it("includes category_id when present", () => {
      const tx: Transaction = {
        amount: 5,
        currency: "USD",
        payee: "test",
        categoryId: 42,
        date: "2026-03-17",
        externalId: "bp_1_1",
      };

      const metadata = buildMetadata(tx, 1, 1);
      const payload = transactionToPayload(tx, metadata);
      expect(payload.category_id).toBe(42);
    });

    it("uses manual_account_id for asset", () => {
      const tx: Transaction = {
        amount: 5,
        currency: "USD",
        payee: "test",
        assetId: 99,
        date: "2026-03-17",
        externalId: "bp_1_1",
      };

      const metadata = buildMetadata(tx, 1, 1);
      const payload = transactionToPayload(tx, metadata);
      expect(payload.manual_account_id).toBe(99);
    });
  });

  it("includes tag_ids when present", () => {
    const tx: Transaction = {
      amount: 5, currency: "USD", payee: "test", date: "2026-03-17", externalId: "bp_1_1",
    };
    const metadata = buildMetadata(tx, 1, 1);
    const payload = transactionToPayload(tx, metadata);
    payload.tag_ids = [1, 2];
    expect(payload.tag_ids).toEqual([1, 2]);
  });

  describe("buildMetadata", () => {
    it("builds basic metadata without FX", () => {
      const tx: Transaction = {
        amount: 12.5,
        currency: "USD",
        payee: "uber",
        date: "2026-03-17",
        externalId: "bp_1_1",
      };

      const meta = buildMetadata(tx, 123, 456);
      expect(meta.blueplate_version).toBe(1);
      expect(meta.ingested_via).toBe("telegram");
      expect(meta.telegram_chat_id).toBe(123);
      expect(meta.telegram_message_id).toBe(456);
      expect(meta.fx_rate).toBeUndefined();
      expect(meta.original_amount).toBeUndefined();
    });

    it("builds metadata with FX info", () => {
      const tx: Transaction = {
        amount: 10.18,
        currency: "USD",
        originalAmount: 14500,
        originalCurrency: "ARS",
        payee: "café",
        date: "2026-03-17",
        externalId: "bp_1_1",
      };

      const meta = buildMetadata(tx, 123, 456, 1425, "dolarapi.com");
      expect(meta.blueplate_version).toBe(1);
      expect(meta.original_amount).toBe(14500);
      expect(meta.original_currency).toBe("ARS");
      expect(meta.fx_rate).toBe(1425);
      expect(meta.fx_mode).toBe("blue_sell");
      expect(meta.fx_source).toBe("dolarapi.com");
    });
  });
});

describe("LunchMoneyClient", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("createTransaction returns ID from transactions array", async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response(
      JSON.stringify({ transactions: [{ id: 42 }] }),
      { status: 201, headers: { "Content-Type": "application/json" } }
    ))) as any;

    const client = new LunchMoneyClient("test-key");
    const id = await client.createTransaction({
      payee: "test", amount: "10", currency: "usd", date: "2026-03-17",
      external_id: "bp_1_1", status: "reviewed",
    });
    expect(id).toBe(42);
  });

  it("createTransaction returns ID from skipped_duplicates", async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response(
      JSON.stringify({ transactions: [], skipped_duplicates: [{ request_transactions_index: 0, existing_transaction_id: 99 }] }),
      { status: 201, headers: { "Content-Type": "application/json" } }
    ))) as any;

    const client = new LunchMoneyClient("test-key");
    const id = await client.createTransaction({
      payee: "test", amount: "10", currency: "usd", date: "2026-03-17",
      external_id: "bp_1_1", status: "reviewed",
    });
    expect(id).toBe(99);
  });

  it("createTransaction throws when no transaction returned", async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response(
      JSON.stringify({ transactions: [], skipped_duplicates: [] }),
      { status: 201, headers: { "Content-Type": "application/json" } }
    ))) as any;

    const client = new LunchMoneyClient("test-key");
    expect(client.createTransaction({
      payee: "test", amount: "10", currency: "usd", date: "2026-03-17",
      external_id: "bp_1_1", status: "reviewed",
    })).rejects.toThrow("Expected 1 transaction IDs, got 0");
  });

  it("deleteTransaction returns true on 204", async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response(null, { status: 204 }))) as any;
    const client = new LunchMoneyClient("test-key");
    expect(await client.deleteTransaction(123)).toBe(true);
  });

  it("deleteTransaction returns false on 404", async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response("Not found", { status: 404 }))) as any;
    const client = new LunchMoneyClient("test-key");
    expect(await client.deleteTransaction(123)).toBe(false);
  });

  it("throws LunchMoneyError on 401", async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response("Unauthorized", { status: 401 }))) as any;
    const client = new LunchMoneyClient("test-key");
    expect(client.getCategories()).rejects.toThrow("API key invalid");
  });

  it("throws LunchMoneyError on 500", async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response("Server error", { status: 500 }))) as any;
    const client = new LunchMoneyClient("test-key");
    expect(client.getCategories()).rejects.toThrow("Lunch Money rejected");
  });

  it("updateTransaction calls PUT", async () => {
    let calledMethod = "";
    globalThis.fetch = mock((_url: any, init?: RequestInit) => {
      calledMethod = init?.method ?? "";
      return Promise.resolve(new Response(JSON.stringify({}), {
        status: 200, headers: { "Content-Type": "application/json" },
      }));
    }) as any;

    const client = new LunchMoneyClient("test-key");
    await client.updateTransaction(123, { payee: "test" });
    expect(calledMethod).toBe("PUT");
  });

  it("getTransactions passes date params", async () => {
    let calledUrl = "";
    globalThis.fetch = mock((url: any) => {
      calledUrl = typeof url === "string" ? url : url.href;
      return Promise.resolve(new Response(JSON.stringify({ transactions: [] }), {
        status: 200, headers: { "Content-Type": "application/json" },
      }));
    }) as any;

    const client = new LunchMoneyClient("test-key");
    await client.getTransactions("2026-03-01", "2026-03-31");
    expect(calledUrl).toContain("start_date=2026-03-01");
    expect(calledUrl).toContain("end_date=2026-03-31");
  });
});
