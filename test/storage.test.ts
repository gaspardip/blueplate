import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { BlueplateDatabase } from "../src/storage/database.js";
import { unlinkSync } from "node:fs";

const TEST_DB_PATH = "/tmp/blueplate-test.db";

describe("BlueplateDatabase", () => {
  let db: BlueplateDatabase;

  beforeEach(async () => {
    try { unlinkSync(TEST_DB_PATH); } catch {}
    db = await BlueplateDatabase.create(TEST_DB_PATH);
  });

  afterEach(() => {
    db.close();
    try { unlinkSync(TEST_DB_PATH); } catch {}
  });

  describe("transactions", () => {
    it("saves and retrieves by external_id", () => {
      db.saveTransaction({
        externalId: "bp_123_456",
        lmTransactionId: 9876,
        telegramChatId: 123,
        telegramMessageId: 456,
        amount: 10.18,
        currency: "USD",
        originalAmount: 14500,
        originalCurrency: "ARS",
        payee: "café",
        categoryName: "Comida",
        date: "2026-03-17",
        fxRate: 1425,
        fxSource: "dolarapi.com",
      });

      const row = db.getByExternalId("bp_123_456");
      expect(row).not.toBeNull();
      expect(row!.payee).toBe("café");
      expect(row!.amount).toBe(10.18);
      expect(row!.original_amount).toBe(14500);
      expect(row!.fx_rate).toBe(1425);
    });

    it("returns null for missing external_id", () => {
      const row = db.getByExternalId("nonexistent");
      expect(row).toBeNull();
    });

    it("gets last undoable transaction", () => {
      db.saveTransaction({
        externalId: "bp_1_1",
        lmTransactionId: 100,
        telegramChatId: 1,
        telegramMessageId: 1,
        amount: 5,
        currency: "USD",
        payee: "first",
        date: "2026-03-17",
      });

      db.saveTransaction({
        externalId: "bp_1_2",
        lmTransactionId: 101,
        telegramChatId: 1,
        telegramMessageId: 2,
        amount: 10,
        currency: "USD",
        payee: "second",
        date: "2026-03-17",
      });

      const last = db.getLastUndoable(1);
      expect(last).not.toBeNull();
      expect(last!.payee).toBe("second");
    });

    it("marks transaction as undone", () => {
      db.saveTransaction({
        externalId: "bp_1_1",
        lmTransactionId: 100,
        telegramChatId: 1,
        telegramMessageId: 1,
        amount: 5,
        currency: "USD",
        payee: "test",
        date: "2026-03-17",
      });

      const row = db.getByExternalId("bp_1_1")!;
      db.markUndone(row.id);

      const undoable = db.getLastUndoable(1);
      expect(undoable).toBeNull();
    });

    it("gets transactions for date", () => {
      db.saveTransaction({
        externalId: "bp_1_1",
        lmTransactionId: 100,
        telegramChatId: 1,
        telegramMessageId: 1,
        amount: 5,
        currency: "USD",
        payee: "lunch",
        date: "2026-03-17",
      });

      db.saveTransaction({
        externalId: "bp_1_2",
        lmTransactionId: 101,
        telegramChatId: 1,
        telegramMessageId: 2,
        amount: 3,
        currency: "USD",
        payee: "coffee",
        date: "2026-03-17",
      });

      db.saveTransaction({
        externalId: "bp_1_3",
        lmTransactionId: 102,
        telegramChatId: 1,
        telegramMessageId: 3,
        amount: 20,
        currency: "USD",
        payee: "dinner",
        date: "2026-03-16",
      });

      const today = db.getTransactionsForDate(1, "2026-03-17");
      expect(today.length).toBe(2);

      const yesterday = db.getTransactionsForDate(1, "2026-03-16");
      expect(yesterday.length).toBe(1);
    });
  });

  describe("categories", () => {
    it("upserts and retrieves categories", () => {
      db.upsertCategories([
        { id: 1, name: "Comida", isIncome: false, archived: false },
        { id: 2, name: "Transporte", isIncome: false, archived: false },
        { id: 3, name: "Archived", isIncome: false, archived: true },
      ]);

      const cats = db.getCategories();
      expect(cats.length).toBe(2); // archived excluded
      expect(cats[0].name).toBe("Comida");
    });
  });

  describe("fx_rates", () => {
    it("saves and retrieves latest rate", () => {
      db.saveFxRate("ARS/USD", 1400, "dolarapi.com", "2026-03-17T10:00:00Z");
      db.saveFxRate("ARS/USD", 1425, "dolarapi.com", "2026-03-17T12:00:00Z");

      const rate = db.getLatestFxRate("ARS/USD");
      expect(rate).not.toBeNull();
      expect(rate!.rate).toBe(1425);
    });

    it("returns null for missing pair", () => {
      const rate = db.getLatestFxRate("EUR/USD");
      expect(rate).toBeNull();
    });
  });
});
