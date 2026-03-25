import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import { isQuestion, formatTransactionsForLLM, askQuestion } from "../src/bot/question.js";
import {
  formatTopExpenses,
  formatCategoryBreakdown,
  formatPayeeBreakdown,
} from "../src/bot/formatters.js";
import { weekRangeStr } from "../src/utils.js";
import type { TransactionRow } from "../src/storage/database.js";

describe("isQuestion", () => {
  // English questions
  it("detects English question words", () => {
    expect(isQuestion("what did I spend on food")).toBe(true);
    expect(isQuestion("how much this month")).toBe(true);
    expect(isQuestion("which category is highest")).toBe(true);
    expect(isQuestion("when did I last buy coffee")).toBe(true);
    expect(isQuestion("where do I spend the most")).toBe(true);
    expect(isQuestion("did I spend more than last week")).toBe(true);
    expect(isQuestion("do I have any recurring expenses")).toBe(true);
  });

  // Spanish questions
  it("detects Spanish question words", () => {
    expect(isQuestion("cuánto gasté esta semana")).toBe(true);
    expect(isQuestion("cuanto gaste en comida")).toBe(true);
    expect(isQuestion("cuál es mi gasto más alto")).toBe(true);
    expect(isQuestion("qué es lo más caro")).toBe(true);
    expect(isQuestion("cómo van mis gastos")).toBe(true);
    expect(isQuestion("en qué gasto más")).toBe(true);
  });

  // Question mark
  it("detects question mark regardless of content", () => {
    expect(isQuestion("gastos del mes?")).toBe(true);
    expect(isQuestion("total?")).toBe(true);
    expect(isQuestion("algo más?")).toBe(true);
  });

  // Non-questions (expenses)
  it("does not match expenses", () => {
    expect(isQuestion("pizza 15k")).toBe(false);
    expect(isQuestion("starbucks 8k cafe mp")).toBe(false);
    expect(isQuestion("uber 12.50 usd")).toBe(false);
    expect(isQuestion("café 14500 comida")).toBe(false);
  });

  // Edge case: bare "que" without es/fue should NOT match (could be expense text)
  it("does not match bare 'que' without es/fue", () => {
    expect(isQuestion("que rico 15k comida")).toBe(false);
  });
});

describe("formatTransactionsForLLM", () => {
  it("formats rows as compact CSV", () => {
    const rows: TransactionRow[] = [
      { id: 1, external_id: "bp_1_1", lm_transaction_id: 100, telegram_chat_id: 1, telegram_message_id: 1, amount: 10.50, currency: "USD", original_amount: 14500, original_currency: "ARS", payee: "Starbucks", category_name: "Coffee Shops", asset_name: "Visa", date: "2026-03-01", fx_rate: 1380, fx_source: "dolarapi.com", undone: 0, undone_at: null, created_at: "", bot_reply_message_id: null, split_group_id: null },
    ] as TransactionRow[];

    const csv = formatTransactionsForLLM(rows);
    expect(csv).toContain("date,payee,amount_usd,category,account");
    expect(csv).toContain("2026-03-01,Starbucks,10.50,Coffee Shops,Visa");
  });

  it("handles empty rows", () => {
    expect(formatTransactionsForLLM([])).toBe("(no transactions)");
  });

  it("handles null category and asset", () => {
    const rows = [
      { date: "2026-03-01", payee: "Test", amount: 5.00, category_name: null, asset_name: null },
    ] as unknown as TransactionRow[];

    const csv = formatTransactionsForLLM(rows);
    expect(csv).toContain("2026-03-01,Test,5.00,,");
  });
});

describe("askQuestion", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("sends question with transaction context to OpenAI", async () => {
    let capturedBody: { model: string; messages: Array<{ role: string; content: string }> };
    globalThis.fetch = mock((_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return Promise.resolve(
        new Response(
          JSON.stringify({ choices: [{ message: { content: "You spent $42.50 on food." } }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }) as unknown as typeof fetch;

    const rows = [
      { date: "2026-03-01", payee: "Carrefour", amount: 42.50, category_name: "Groceries", asset_name: "Visa" },
    ] as unknown as TransactionRow[];

    const answer = await askQuestion("how much on food?", rows, "test-key");

    expect(answer).toBe("You spent $42.50 on food.");
    expect(capturedBody!.model).toBe("gpt-4o-mini");
    expect(capturedBody!.messages[1].content).toContain("Carrefour");
    expect(capturedBody!.messages[1].content).toContain("how much on food?");
  });

  it("throws on API error", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("Server Error", { status: 500 })),
    ) as unknown as typeof fetch;

    expect(askQuestion("test?", [], "key")).rejects.toThrow("Couldn't answer that");
  });
});

describe("formatTopExpenses", () => {
  const rows = [
    { payee: "Carrefour", amount: 85.20, category_name: "Groceries" },
    { payee: "Uber", amount: 38.00, category_name: "Rideshare, Taxi" },
    { payee: "Starbucks", amount: 25.00, category_name: "Coffee Shops" },
    { payee: "Rent", amount: 350.00, category_name: "Housing" },
    { payee: "YPF", amount: 42.50, category_name: "Gas" },
    { payee: "Netflix", amount: 17.78, category_name: null },
  ] as unknown as TransactionRow[];

  it("returns top 5 sorted by amount descending", () => {
    const result = formatTopExpenses(rows, "2026-03");
    expect(result).toContain("Top 5");
    expect(result).toContain("Rent — $350.00 (Housing)");
    // Rent should be first
    const rentIdx = result.indexOf("Rent");
    const carrefourIdx = result.indexOf("Carrefour");
    expect(rentIdx).toBeLessThan(carrefourIdx);
    // Netflix ($17.78) should not appear in top 5
    expect(result).not.toContain("Netflix");
  });

  it("returns empty message for no rows", () => {
    expect(formatTopExpenses([], "2026-03")).toContain("No transactions");
  });
});

describe("formatCategoryBreakdown", () => {
  const rows = [
    { payee: "A", amount: 100, category_name: "Food" },
    { payee: "B", amount: 50, category_name: "Food" },
    { payee: "C", amount: 50, category_name: "Transport" },
  ] as unknown as TransactionRow[];

  it("groups by category with percentages", () => {
    const result = formatCategoryBreakdown(rows, "2026-03");
    expect(result).toContain("Food: $150.00 (75%) — 2 tx");
    expect(result).toContain("Transport: $50.00 (25%) — 1 tx");
    expect(result).toContain("$200.00 total");
  });
});

describe("formatPayeeBreakdown", () => {
  const rows = [
    { payee: "starbucks", amount: 10, category_name: null },
    { payee: "starbucks", amount: 15, category_name: null },
    { payee: "uber", amount: 30, category_name: null },
  ] as unknown as TransactionRow[];

  it("groups by payee with totals", () => {
    const result = formatPayeeBreakdown(rows, "2026-03");
    expect(result).toContain("Uber: $30.00 (1 tx)");
    expect(result).toContain("Starbucks: $25.00 (2 tx)");
    // Uber should be first (higher total)
    const uberIdx = result.indexOf("Uber");
    const sbIdx = result.indexOf("Starbucks");
    expect(uberIdx).toBeLessThan(sbIdx);
  });
});

describe("weekRangeStr", () => {
  it("returns weekStart <= weekEnd", () => {
    const { weekStart, weekEnd } = weekRangeStr();
    expect(weekStart <= weekEnd).toBe(true);
  });

  it("weekStart is a Monday", () => {
    const { weekStart } = weekRangeStr();
    const day = new Date(weekStart).getDay();
    expect(day).toBe(1); // Monday
  });
});
