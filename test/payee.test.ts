import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { BlueplateDatabase } from "../src/storage/database.js";
import { PayeeNormalizer } from "../src/payee.js";
import { unlinkSync } from "node:fs";

const TEST_DB_PATH = "/tmp/blueplate-payee-test.db";

describe("PayeeNormalizer", () => {
  let db: BlueplateDatabase;
  let normalizer: PayeeNormalizer;

  beforeEach(async () => {
    try { unlinkSync(TEST_DB_PATH); } catch {}
    db = await BlueplateDatabase.create(TEST_DB_PATH);
    normalizer = new PayeeNormalizer(db);
  });

  afterEach(() => {
    db.close();
    try { unlinkSync(TEST_DB_PATH); } catch {}
  });

  it("capitalizes new payees", () => {
    expect(normalizer.normalize("starbucks")).toBe("Starbucks");
  });

  it("capitalizes multi-word payees", () => {
    expect(normalizer.normalize("café de la esquina")).toBe("Café De La Esquina");
  });

  it("returns alias for known payee", () => {
    normalizer.setAlias("starbux", "Starbucks");
    expect(normalizer.normalize("starbux")).toBe("Starbucks");
  });

  it("auto-learns alias on first normalize", () => {
    const first = normalizer.normalize("starbucks");
    expect(first).toBe("Starbucks");
    // Second call should return from alias table
    expect(normalizer.normalize("starbucks")).toBe("Starbucks");
  });

  it("fuzzy matches within Levenshtein distance 2", () => {
    // Create a known payee via a transaction (getDistinctPayees reads from transactions table)
    db.saveTransaction({
      externalId: "bp_1_1", lmTransactionId: 100, telegramChatId: 1,
      telegramMessageId: 1, amount: 5, currency: "USD", payee: "Starbucks", date: "2026-03-17",
    });
    // "starbuck" is distance 1 from "starbucks"
    expect(normalizer.normalize("starbuck")).toBe("Starbucks");
  });

  it("does not fuzzy match beyond distance 2", () => {
    db.saveTransaction({
      externalId: "bp_1_2", lmTransactionId: 101, telegramChatId: 1,
      telegramMessageId: 2, amount: 5, currency: "USD", payee: "Starbucks", date: "2026-03-17",
    });
    // "star" is distance 5 from "starbucks" — too far
    expect(normalizer.normalize("star")).toBe("Star");
  });

  it("setAlias overrides existing", () => {
    normalizer.setAlias("sb", "Starbucks");
    expect(normalizer.normalize("sb")).toBe("Starbucks");
    normalizer.setAlias("sb", "Subway");
    expect(normalizer.normalize("sb")).toBe("Subway");
  });

  it("is case-insensitive", () => {
    normalizer.normalize("STARBUCKS"); // saves "Starbucks"
    expect(normalizer.normalize("starbucks")).toBe("Starbucks");
  });

  it("trims whitespace", () => {
    expect(normalizer.normalize("  pizza  ")).toBe("Pizza");
  });
});
