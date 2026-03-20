import { describe, expect, it } from "bun:test";
import { parse } from "../src/parser/index.js";
import type { ResolutionContext } from "../src/types.js";

const ctx: ResolutionContext = {
  categories: [
    { id: 1, name: "🍽️ Restaurants", isIncome: false, archived: false },
    { id: 2, name: "🚕 Rideshare, Taxi", isIncome: false, archived: false },
    { id: 3, name: "☕ Coffee Shops", isIncome: false, archived: false },
    { id: 4, name: "🛒 Groceries", isIncome: false, archived: false },
    { id: 5, name: "💵 Rent, Mortgage", isIncome: false, archived: false },
    { id: 6, name: "📺 Streaming Services", isIncome: false, archived: false },
  ],
  assets: [
    { id: 10, name: "Mercado Pago", currency: "ARS" },
    { id: 11, name: "Cash ARS", currency: "ARS" },
    { id: 12, name: "Visa", currency: "ARS" },
    { id: 13, name: "Amex", currency: "ARS" },
    { id: 14, name: "Banco", currency: "ARS" },
  ],
  tags: [],
  defaultCurrency: "ARS",
};

const emptyCtx: ResolutionContext = {
  categories: [],
  assets: [],
  tags: [],
  defaultCurrency: "ARS",
};

describe("parser", () => {
  describe("basic patterns", () => {
    it("parses payee + amount", () => {
      const result = parse("pizza 1500", emptyCtx);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.expense.payee).toBe("pizza");
      expect(result.expense.amount).toBe(1500);
      expect(result.expense.currency).toBeUndefined();
    });

    it("parses amount + payee", () => {
      const result = parse("1500 pizza", emptyCtx);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.expense.payee).toBe("pizza");
      expect(result.expense.amount).toBe(1500);
    });

    it("parses payee + amount + currency", () => {
      const result = parse("café 14500 ars", emptyCtx);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.expense.payee).toBe("café");
      expect(result.expense.amount).toBe(14500);
      expect(result.expense.currency).toBe("ARS");
    });

    it("parses with USD currency", () => {
      const result = parse("uber 12.50 usd", emptyCtx);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.expense.payee).toBe("uber");
      expect(result.expense.amount).toBe(12.5);
      expect(result.expense.currency).toBe("USD");
    });

    it("parses with pesos alias", () => {
      const result = parse("taxi 3500 pesos", emptyCtx);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.expense.currency).toBe("ARS");
    });

    it("parses with dolares alias", () => {
      const result = parse("netflix 15 dolares", emptyCtx);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.expense.currency).toBe("USD");
    });
  });

  describe("category matching", () => {
    it("matches category ignoring emoji prefix", () => {
      const result = parse("pizza 1500 restaurants", ctx);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.expense.payee).toBe("pizza");
      expect(result.expense.categoryHint).toBe("🍽️ Restaurants");
    });

    it("matches category by prefix", () => {
      const result = parse("pizza 1500 rest", ctx);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.expense.categoryHint).toBe("🍽️ Restaurants");
    });

    it("matches multi-word category", () => {
      const result = parse("netflix 15 usd streaming services", ctx);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.expense.payee).toBe("netflix");
      expect(result.expense.categoryHint).toBe("📺 Streaming Services");
    });

    it("matches category by contains", () => {
      const result = parse("uber 5k taxi", ctx);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.expense.categoryHint).toBe("🚕 Rideshare, Taxi");
    });

    it("multi-word payee with category", () => {
      const result = parse("café de la esquina 14500 coffee", ctx);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.expense.payee).toBe("café de la esquina");
      expect(result.expense.categoryHint).toBe("☕ Coffee Shops");
    });
  });

  describe("account matching", () => {
    it("matches account by name", () => {
      const result = parse("pizza 1500 visa", ctx);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.expense.payee).toBe("pizza");
      expect(result.expense.assetHint).toBe("Visa");
    });

    it("matches account by initials (mp → Mercado Pago)", () => {
      const result = parse("pizza 1500 mp", ctx);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.expense.assetHint).toBe("Mercado Pago");
    });

    it("matches account and category together", () => {
      const result = parse("pizza 15k visa restaurants", ctx);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.expense.payee).toBe("pizza");
      expect(result.expense.assetHint).toBe("Visa");
      expect(result.expense.categoryHint).toBe("🍽️ Restaurants");
    });
  });

  describe("amount formats", () => {
    it("handles comma as thousand separator", () => {
      const result = parse("almuerzo 14,500", emptyCtx);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.expense.amount).toBe(14500);
    });

    it("handles dot as thousand separator", () => {
      const result = parse("almuerzo 14.500", emptyCtx);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.expense.amount).toBe(14500);
    });

    it("handles decimal amount", () => {
      const result = parse("uber 12.50", emptyCtx);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.expense.amount).toBe(12.5);
    });

    it("handles dollar sign prefix", () => {
      const result = parse("pizza $1500", emptyCtx);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.expense.amount).toBe(1500);
    });

    it("handles k suffix (thousands)", () => {
      const result = parse("alquiler 500k", emptyCtx);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.expense.amount).toBe(500_000);
    });

    it("handles K suffix uppercase", () => {
      const result = parse("alquiler 500K", emptyCtx);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.expense.amount).toBe(500_000);
    });

    it("handles m suffix (millions)", () => {
      const result = parse("auto 1m", emptyCtx);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.expense.amount).toBe(1_000_000);
    });

    it("handles decimal with k suffix", () => {
      const result = parse("supermercado 14.5k", emptyCtx);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.expense.amount).toBe(14_500);
    });

    it("handles decimal with m suffix", () => {
      const result = parse("depto 1.5m", emptyCtx);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.expense.amount).toBe(1_500_000);
    });

    it("handles $500k combo", () => {
      const result = parse("expensas $500k", emptyCtx);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.expense.amount).toBe(500_000);
    });
  });

  describe("modifiers", () => {
    it("parses tags", () => {
      const result = parse("pizza 1500 #delivery", emptyCtx);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.expense.tags).toEqual(["delivery"]);
    });

    it("parses notes", () => {
      const result = parse("pizza 1500 note:compartida", emptyCtx);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.expense.note).toBe("compartida");
    });

    it("parses explicit date", () => {
      const result = parse("pizza 1500 date:2026-03-15", emptyCtx);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.expense.date).toBe("2026-03-15");
    });

    it("parses yesterday keyword", () => {
      const result = parse("pizza 1500 ayer", emptyCtx);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.expense.date).toBeDefined();
      // Should be yesterday's date
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      expect(result.expense.date).toBe(yesterday.toISOString().slice(0, 10));
    });
  });

  describe("income (negative amounts)", () => {
    it("parses negative amount as income", () => {
      const result = parse("freelance -7500 usd", emptyCtx);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.expense.amount).toBe(-7500);
      expect(result.expense.payee).toBe("freelance");
      expect(result.expense.currency).toBe("USD");
    });

    it("parses negative with k suffix", () => {
      const result = parse("sueldo -500k", emptyCtx);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.expense.amount).toBe(-500_000);
    });

    it("parses negative with dollar sign", () => {
      const result = parse("refund -$50 usd", emptyCtx);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.expense.amount).toBe(-50);
    });
  });

  describe("split expenses", () => {
    it("parses split 2", () => {
      const result = parse("pizza 8k split 2", emptyCtx);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.expense.amount).toBe(8000);
      expect(result.expense.splitCount).toBe(2);
      expect(result.expense.payee).toBe("pizza");
    });

    it("parses split 3 with category", () => {
      const result = parse("pizza 15k split 3 restaurants", ctx);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.expense.amount).toBe(15000);
      expect(result.expense.splitCount).toBe(3);
      expect(result.expense.categoryHint).toBe("🍽️ Restaurants");
    });

    it("ignores split without valid number", () => {
      const result = parse("pizza 1500 split", emptyCtx);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.expense.splitCount).toBeUndefined();
    });

    it("ignores split 0", () => {
      // split 0 won't match because parseAmount rejects 0
      const result = parse("pizza 1500 split 0", emptyCtx);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.expense.splitCount).toBeUndefined();
    });

    it("rejects split 1 as ambiguous amounts", () => {
      // split 1 not in range 2-20 → "1" remains as an amount token → two amounts → ambiguous
      const result = parse("pizza 1500 split 1", emptyCtx);
      expect(result.ok).toBe(false);
    });
  });

  describe("error cases", () => {
    it("rejects empty input", () => {
      const result = parse("", emptyCtx);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe("invalid");
    });

    it("rejects no amount", () => {
      const result = parse("pizza comida", emptyCtx);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe("invalid");
    });

    it("rejects multiple amounts", () => {
      const result = parse("pizza 1500 2000", emptyCtx);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe("ambiguous");
    });

    it("rejects amount only (no payee)", () => {
      const result = parse("1500 ars", emptyCtx);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe("invalid");
    });
  });
});
