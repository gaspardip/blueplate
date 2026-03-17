import { describe, expect, it } from "bun:test";
import { transactionToPayload, buildMetadataBlock, buildMetadataBlockWithFX } from "../src/lunchmoney/mapper.js";
import type { Transaction } from "../src/types.js";

describe("LunchMoney mapper", () => {
  describe("transactionToPayload", () => {
    it("builds basic payload", () => {
      const tx: Transaction = {
        amount: 10.18,
        currency: "USD",
        payee: "café",
        date: "2026-03-17",
        externalId: "bp_123_456",
      };

      const payload = transactionToPayload(tx, "test notes");
      expect(payload.payee).toBe("Café");
      expect(payload.amount).toBe("10.18");
      expect(payload.currency).toBe("usd");
      expect(payload.date).toBe("2026-03-17");
      expect(payload.external_id).toBe("bp_123_456");
      expect(payload.notes).toBe("test notes");
      expect(payload.status).toBe("cleared");
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

      const payload = transactionToPayload(tx, "");
      expect(payload.category_id).toBe(42);
    });
  });

  describe("buildMetadataBlock", () => {
    it("builds block without FX", () => {
      const tx: Transaction = {
        amount: 12.5,
        currency: "USD",
        payee: "uber",
        date: "2026-03-17",
        externalId: "bp_1_1",
      };

      const block = buildMetadataBlock(tx);
      expect(block).toContain("[blueplate:v1]");
      expect(block).toContain("ingested_via=telegram");
      expect(block).not.toContain("fx_rate");
    });

    it("builds block with original amount", () => {
      const tx: Transaction = {
        amount: 10.18,
        currency: "USD",
        originalAmount: 14500,
        originalCurrency: "ARS",
        payee: "café",
        date: "2026-03-17",
        externalId: "bp_1_1",
      };

      const block = buildMetadataBlock(tx);
      expect(block).toContain("original_amount=14500");
      expect(block).toContain("original_currency=ARS");
    });
  });

  describe("buildMetadataBlockWithFX", () => {
    it("builds block with FX info", () => {
      const tx: Transaction = {
        amount: 10.18,
        currency: "USD",
        originalAmount: 14500,
        originalCurrency: "ARS",
        payee: "café",
        date: "2026-03-17",
        externalId: "bp_1_1",
      };

      const block = buildMetadataBlockWithFX(tx, 1425, "dolarapi.com");
      expect(block).toContain("[blueplate:v1]");
      expect(block).toContain("original_amount=14500");
      expect(block).toContain("fx_rate=1425");
      expect(block).toContain("fx_mode=blue_sell");
      expect(block).toContain("fx_source=dolarapi.com");
    });
  });
});
