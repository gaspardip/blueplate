import { describe, expect, it } from "bun:test";
import { transactionToPayload, buildMetadata } from "../src/lunchmoney/mapper.js";
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
