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

  describe("getById", () => {
    it("returns transaction by id", () => {
      const id = db.saveTransaction({
        externalId: "bp_1_1", lmTransactionId: 100, telegramChatId: 1,
        telegramMessageId: 1, amount: 5, currency: "USD", payee: "test", date: "2026-03-17",
      });
      const row = db.getById(id);
      expect(row).not.toBeNull();
      expect(row!.payee).toBe("test");
    });

    it("returns null for undone transaction", () => {
      const id = db.saveTransaction({
        externalId: "bp_1_1", lmTransactionId: 100, telegramChatId: 1,
        telegramMessageId: 1, amount: 5, currency: "USD", payee: "test", date: "2026-03-17",
      });
      db.markUndone(id);
      expect(db.getById(id)).toBeNull();
    });
  });

  describe("bot_reply_message_id", () => {
    it("sets and retrieves by bot reply message id", () => {
      const id = db.saveTransaction({
        externalId: "bp_1_1", lmTransactionId: 100, telegramChatId: 1,
        telegramMessageId: 1, amount: 5, currency: "USD", payee: "test", date: "2026-03-17",
      });
      db.setBotReplyMessageId(id, 999);
      const row = db.getByBotReplyMessageId(1, 999);
      expect(row).not.toBeNull();
      expect(row!.payee).toBe("test");
    });

    it("returns null for wrong chat id", () => {
      const id = db.saveTransaction({
        externalId: "bp_1_1", lmTransactionId: 100, telegramChatId: 1,
        telegramMessageId: 1, amount: 5, currency: "USD", payee: "test", date: "2026-03-17",
      });
      db.setBotReplyMessageId(id, 999);
      expect(db.getByBotReplyMessageId(2, 999)).toBeNull();
    });
  });

  describe("updateTransactionFields", () => {
    it("updates amount", () => {
      const id = db.saveTransaction({
        externalId: "bp_1_1", lmTransactionId: 100, telegramChatId: 1,
        telegramMessageId: 1, amount: 5, currency: "USD", payee: "test", date: "2026-03-17",
      });
      db.updateTransactionFields(id, { amount: 10 });
      expect(db.getById(id)!.amount).toBe(10);
    });

    it("updates payee", () => {
      const id = db.saveTransaction({
        externalId: "bp_1_1", lmTransactionId: 100, telegramChatId: 1,
        telegramMessageId: 1, amount: 5, currency: "USD", payee: "old", date: "2026-03-17",
      });
      db.updateTransactionFields(id, { payee: "new" });
      expect(db.getById(id)!.payee).toBe("new");
    });

    it("updates multiple fields", () => {
      const id = db.saveTransaction({
        externalId: "bp_1_1", lmTransactionId: 100, telegramChatId: 1,
        telegramMessageId: 1, amount: 5, currency: "USD", payee: "test", date: "2026-03-17",
      });
      db.updateTransactionFields(id, { amount: 20, categoryName: "Food", assetName: "Visa" });
      const row = db.getById(id)!;
      expect(row.amount).toBe(20);
      expect(row.category_name).toBe("Food");
      expect(row.asset_name).toBe("Visa");
    });

    it("no-ops when no fields provided", () => {
      const id = db.saveTransaction({
        externalId: "bp_1_1", lmTransactionId: 100, telegramChatId: 1,
        telegramMessageId: 1, amount: 5, currency: "USD", payee: "test", date: "2026-03-17",
      });
      db.updateTransactionFields(id, {});
      expect(db.getById(id)!.amount).toBe(5);
    });
  });

  describe("saveTransaction returns id", () => {
    it("returns the inserted row id", () => {
      const id = db.saveTransaction({
        externalId: "bp_1_1", lmTransactionId: 100, telegramChatId: 1,
        telegramMessageId: 1, amount: 5, currency: "USD", payee: "test", date: "2026-03-17",
      });
      expect(typeof id).toBe("number");
      expect(id).toBeGreaterThan(0);
    });
  });

  describe("searchTransactions", () => {
    it("searches by payee", () => {
      db.saveTransaction({
        externalId: "bp_1_1", lmTransactionId: 100, telegramChatId: 1,
        telegramMessageId: 1, amount: 5, currency: "USD", payee: "Starbucks", date: "2026-03-17",
      });
      db.saveTransaction({
        externalId: "bp_1_2", lmTransactionId: 101, telegramChatId: 1,
        telegramMessageId: 2, amount: 10, currency: "USD", payee: "Pizza", date: "2026-03-17",
      });
      const { rows, total } = db.searchTransactions(1, "star", 0, 10);
      expect(total).toBe(1);
      expect(rows[0].payee).toBe("Starbucks");
    });

    it("searches by date prefix", () => {
      db.saveTransaction({
        externalId: "bp_1_1", lmTransactionId: 100, telegramChatId: 1,
        telegramMessageId: 1, amount: 5, currency: "USD", payee: "lunch", date: "2026-03-17",
      });
      db.saveTransaction({
        externalId: "bp_1_2", lmTransactionId: 101, telegramChatId: 1,
        telegramMessageId: 2, amount: 10, currency: "USD", payee: "dinner", date: "2026-04-01",
      });
      const { rows, total } = db.searchTransactions(1, "2026-03", 0, 10);
      expect(total).toBe(1);
      expect(rows[0].payee).toBe("lunch");
    });

    it("paginates results", () => {
      for (let i = 1; i <= 8; i++) {
        db.saveTransaction({
          externalId: `bp_1_${i}`, lmTransactionId: 100 + i, telegramChatId: 1,
          telegramMessageId: i, amount: i, currency: "USD", payee: "Pizza", date: "2026-03-17",
        });
      }
      const page1 = db.searchTransactions(1, "pizza", 0, 5);
      expect(page1.total).toBe(8);
      expect(page1.rows.length).toBe(5);
      const page2 = db.searchTransactions(1, "pizza", 5, 5);
      expect(page2.rows.length).toBe(3);
    });

    it("returns empty for no match", () => {
      const { rows, total } = db.searchTransactions(1, "nonexistent", 0, 10);
      expect(total).toBe(0);
      expect(rows.length).toBe(0);
    });
  });

  describe("templates", () => {
    it("saves and retrieves template", () => {
      db.saveTemplate(1, "netflix", "15 usd streaming");
      const t = db.getTemplate(1, "netflix");
      expect(t).not.toBeNull();
      expect(t!.text).toBe("15 usd streaming");
    });

    it("is case-insensitive", () => {
      db.saveTemplate(1, "Netflix", "15 usd streaming");
      expect(db.getTemplate(1, "netflix")).not.toBeNull();
    });

    it("lists templates", () => {
      db.saveTemplate(1, "netflix", "15 usd streaming");
      db.saveTemplate(1, "gym", "50k fitness");
      const list = db.listTemplates(1);
      expect(list.length).toBe(2);
    });

    it("deletes template", () => {
      db.saveTemplate(1, "netflix", "15 usd streaming");
      expect(db.deleteTemplate(1, "netflix")).toBe(true);
      expect(db.getTemplate(1, "netflix")).toBeNull();
    });

    it("returns false for deleting nonexistent", () => {
      expect(db.deleteTemplate(1, "nope")).toBe(false);
    });

    it("upserts on duplicate name", () => {
      db.saveTemplate(1, "netflix", "15 usd streaming");
      db.saveTemplate(1, "netflix", "20 usd streaming");
      expect(db.getTemplate(1, "netflix")!.text).toBe("20 usd streaming");
    });
  });

  describe("getTransactionsForDateRange", () => {
    it("returns transactions in range", () => {
      db.saveTransaction({
        externalId: "bp_1_1", lmTransactionId: 100, telegramChatId: 1,
        telegramMessageId: 1, amount: 5, currency: "USD", payee: "mon", date: "2026-03-10",
      });
      db.saveTransaction({
        externalId: "bp_1_2", lmTransactionId: 101, telegramChatId: 1,
        telegramMessageId: 2, amount: 10, currency: "USD", payee: "wed", date: "2026-03-12",
      });
      db.saveTransaction({
        externalId: "bp_1_3", lmTransactionId: 102, telegramChatId: 1,
        telegramMessageId: 3, amount: 15, currency: "USD", payee: "outside", date: "2026-03-20",
      });
      const rows = db.getTransactionsForDateRange(1, "2026-03-10", "2026-03-15");
      expect(rows.length).toBe(2);
    });
  });

  describe("getRecentFxRates", () => {
    it("returns recent rates in desc order", () => {
      db.saveFxRate("ARS/USD", 1400, "dolarapi.com", "2026-03-17T10:00:00Z");
      db.saveFxRate("ARS/USD", 1425, "dolarapi.com", "2026-03-17T12:00:00Z");
      db.saveFxRate("ARS/USD", 1450, "dolarapi.com", "2026-03-17T14:00:00Z");
      const rates = db.getRecentFxRates("ARS/USD", 2);
      expect(rates.length).toBe(2);
      expect(rates[0].rate).toBe(1450);
      expect(rates[1].rate).toBe(1425);
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
