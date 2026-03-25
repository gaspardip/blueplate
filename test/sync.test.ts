import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { BlueplateDatabase } from "../src/storage/database.js";
import { syncTransactions } from "../src/bot/commands.js";
import type { LMTransaction } from "../src/lunchmoney/types.js";
import type { CachedCategory, CachedAsset } from "../src/types.js";
import { unlinkSync } from "node:fs";

const TEST_DB_PATH = "/tmp/blueplate-sync-test.db";

describe("syncTransactions", () => {
  let db: BlueplateDatabase;

  const categories: CachedCategory[] = [
    { id: 1, name: "Groceries", isIncome: false, archived: false },
    { id: 2, name: "Coffee Shops", isIncome: false, archived: false },
    { id: 3, name: "Restaurants", isIncome: false, archived: false },
  ];

  const accounts: CachedAsset[] = [
    { id: 10, name: "Visa", currency: "ARS" },
    { id: 11, name: "Mercado Pago", currency: "ARS" },
  ];

  function makeLmTx(overrides: Partial<LMTransaction>): LMTransaction {
    return {
      id: 1000,
      date: "2026-03-20",
      amount: "10.00",
      currency: "usd",
      to_base: 1,
      recurring_id: null,
      payee: "Test",
      original_name: null,
      category_id: null,
      manual_account_id: null,
      plaid_account_id: null,
      external_id: "bp_123_456",
      tag_ids: [],
      notes: null,
      status: "reviewed",
      is_pending: false,
      created_at: "",
      updated_at: "",
      is_split_parent: false,
      split_parent_id: null,
      is_group_parent: false,
      group_parent_id: null,
      source: "api",
      ...overrides,
    };
  }

  function seedLocalTx(overrides?: {
    externalId?: string;
    amount?: number;
    payee?: string;
    categoryName?: string;
    assetName?: string;
  }) {
    return db.saveTransaction({
      externalId: overrides?.externalId ?? "bp_123_456",
      lmTransactionId: 1000,
      telegramChatId: 123,
      telegramMessageId: 456,
      amount: overrides?.amount ?? 10.00,
      currency: "USD",
      payee: overrides?.payee ?? "Test",
      categoryName: overrides?.categoryName ?? undefined,
      assetName: overrides?.assetName ?? undefined,
      date: "2026-03-20",
    });
  }

  beforeEach(async () => {
    try { unlinkSync(TEST_DB_PATH); } catch {}
    db = await BlueplateDatabase.create(TEST_DB_PATH);
  });

  afterEach(() => {
    db.close();
    try { unlinkSync(TEST_DB_PATH); } catch {}
  });

  it("skips transactions without bp_ external_id", () => {
    seedLocalTx();
    const lmTxns = [
      makeLmTx({ external_id: null }),
      makeLmTx({ external_id: "csv_import_123" }),
      makeLmTx({ external_id: "manual_web_456" }),
    ];

    const result = syncTransactions(lmTxns, categories, accounts, db);
    expect(result.matched).toBe(0);
    expect(result.totalUpdates).toBe(0);
  });

  it("skips transactions not found in local DB", () => {
    const lmTxns = [makeLmTx({ external_id: "bp_999_999" })];
    const result = syncTransactions(lmTxns, categories, accounts, db);
    expect(result.matched).toBe(0);
  });

  it("reports everything up to date when nothing changed", () => {
    seedLocalTx({ payee: "Test" });
    const lmTxns = [makeLmTx({ payee: "Test", category_id: null, manual_account_id: null })];
    const result = syncTransactions(lmTxns, categories, accounts, db);
    expect(result.matched).toBe(1);
    expect(result.totalUpdates).toBe(0);
  });

  it("updates category when changed in LM", () => {
    seedLocalTx({ categoryName: "Groceries" });
    const lmTxns = [makeLmTx({ category_id: 2 })]; // Coffee Shops

    const result = syncTransactions(lmTxns, categories, accounts, db);
    expect(result.categories).toBe(1);

    const updated = db.getByExternalId("bp_123_456");
    expect(updated!.category_name).toBe("Coffee Shops");
  });

  it("updates account when changed in LM", () => {
    seedLocalTx({ assetName: "Visa" });
    const lmTxns = [makeLmTx({ manual_account_id: 11 })]; // Mercado Pago

    const result = syncTransactions(lmTxns, categories, accounts, db);
    expect(result.accounts).toBe(1);

    const updated = db.getByExternalId("bp_123_456");
    expect(updated!.asset_name).toBe("Mercado Pago");
  });

  it("updates payee when changed in LM", () => {
    seedLocalTx({ payee: "Starbux" });
    const lmTxns = [makeLmTx({ payee: "Starbucks" })];

    const result = syncTransactions(lmTxns, categories, accounts, db);
    expect(result.payees).toBe(1);

    const updated = db.getByExternalId("bp_123_456");
    expect(updated!.payee).toBe("Starbucks");
  });

  it("updates amount when changed in LM", () => {
    seedLocalTx({ amount: 10.00 });
    const lmTxns = [makeLmTx({ amount: "15.50" })];

    const result = syncTransactions(lmTxns, categories, accounts, db);
    expect(result.amounts).toBe(1);

    const updated = db.getByExternalId("bp_123_456");
    expect(updated!.amount).toBe(15.50);
  });

  it("ignores tiny floating-point differences in amount", () => {
    seedLocalTx({ amount: 10.00 });
    const lmTxns = [makeLmTx({ amount: "10.004" })]; // within 0.005 tolerance

    const result = syncTransactions(lmTxns, categories, accounts, db);
    expect(result.amounts).toBe(0);
  });

  it("marks local record as undone when LM status is delete_pending", () => {
    seedLocalTx();
    const lmTxns = [makeLmTx({ status: "delete_pending" })];

    const result = syncTransactions(lmTxns, categories, accounts, db);
    expect(result.deleted).toBe(1);
    expect(result.totalUpdates).toBe(1);

    // Record should be undone
    const record = db.getByExternalId("bp_123_456");
    expect(record!.undone).toBe(1);
  });

  it("skips already-undone local records", () => {
    const id = seedLocalTx();
    db.markUndone(id);
    const lmTxns = [makeLmTx({ payee: "Changed" })];

    const result = syncTransactions(lmTxns, categories, accounts, db);
    expect(result.matched).toBe(1);
    expect(result.totalUpdates).toBe(0); // undone records are skipped
  });

  it("does not double-count delete_pending on already-undone record", () => {
    const id = seedLocalTx();
    db.markUndone(id);
    const lmTxns = [makeLmTx({ status: "delete_pending" })];

    const result = syncTransactions(lmTxns, categories, accounts, db);
    expect(result.deleted).toBe(0); // already undone, so not counted
  });

  it("handles multiple updates on the same transaction", () => {
    seedLocalTx({ payee: "Old", categoryName: "Groceries", assetName: "Visa" });
    const lmTxns = [makeLmTx({
      payee: "New",
      category_id: 3,       // Restaurants
      manual_account_id: 11, // Mercado Pago
      amount: "20.00",
    })];

    const result = syncTransactions(lmTxns, categories, accounts, db);
    expect(result.payees).toBe(1);
    expect(result.categories).toBe(1);
    expect(result.accounts).toBe(1);
    expect(result.amounts).toBe(1);
    expect(result.totalUpdates).toBe(4);

    const updated = db.getByExternalId("bp_123_456");
    expect(updated!.payee).toBe("New");
    expect(updated!.category_name).toBe("Restaurants");
    expect(updated!.asset_name).toBe("Mercado Pago");
    expect(updated!.amount).toBe(20.00);
  });

  it("handles multiple transactions in a single sync", () => {
    seedLocalTx({ externalId: "bp_123_1", payee: "A" });
    seedLocalTx({ externalId: "bp_123_2", payee: "B" });
    seedLocalTx({ externalId: "bp_123_3", payee: "C" });

    const lmTxns = [
      makeLmTx({ external_id: "bp_123_1", payee: "A-updated" }),
      makeLmTx({ external_id: "bp_123_2", payee: "B" }), // unchanged
      makeLmTx({ external_id: "bp_123_3", status: "delete_pending" }),
      makeLmTx({ external_id: null }), // non-blueplate, skipped
    ];

    const result = syncTransactions(lmTxns, categories, accounts, db);
    expect(result.matched).toBe(3);
    expect(result.payees).toBe(1);
    expect(result.deleted).toBe(1);
    expect(result.totalUpdates).toBe(2);
  });

  it("handles unknown category_id gracefully (no update)", () => {
    seedLocalTx({ categoryName: "Groceries" });
    const lmTxns = [makeLmTx({ category_id: 999 })]; // not in our category list

    const result = syncTransactions(lmTxns, categories, accounts, db);
    expect(result.categories).toBe(0); // null != "Groceries" but newCat is null, so no update
  });

  it("handles import external_ids (bp_import_ prefix)", () => {
    seedLocalTx({ externalId: "bp_import_123_456_0", payee: "Old" });
    const lmTxns = [makeLmTx({ external_id: "bp_import_123_456_0", payee: "New" })];

    const result = syncTransactions(lmTxns, categories, accounts, db);
    expect(result.payees).toBe(1);
  });
});
