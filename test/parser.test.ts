import { describe, expect, it } from "bun:test";
import { parse } from "../src/parser/index.js";
import type { ResolutionContext } from "../src/types.js";

const ctx: ResolutionContext = {
  categories: [
    { id: 1, name: "Comida", isIncome: false, archived: false },
    { id: 2, name: "Transporte", isIncome: false, archived: false },
    { id: 3, name: "Entretenimiento", isIncome: false, archived: false },
    { id: 4, name: "Servicios", isIncome: false, archived: false },
  ],
  assets: [
    { id: 10, name: "Efectivo", currency: "ARS" },
    { id: 11, name: "BBVA", displayName: "BBVA Cuenta", currency: "ARS" },
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
    it("matches exact category", () => {
      const result = parse("pizza 1500 comida", ctx);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.expense.payee).toBe("pizza");
      expect(result.expense.categoryHint).toBe("Comida");
    });

    it("matches category prefix", () => {
      const result = parse("pizza 1500 com", ctx);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.expense.categoryHint).toBe("Comida");
    });

    it("multi-word payee with category", () => {
      const result = parse("café de la esquina 14500 comida", ctx);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.expense.payee).toBe("café de la esquina");
      expect(result.expense.categoryHint).toBe("Comida");
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
