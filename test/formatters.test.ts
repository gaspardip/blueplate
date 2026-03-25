import { describe, expect, it } from "bun:test";
import {
  formatConfirmation,
  buildReceiptKeyboard,
  formatUndone,
  formatDaySummary,
  formatMonthSummary,
  formatCategories,
  formatAssets,
  formatSearchResults,
  formatTemplateList,
  formatWeeklySummary,
  formatFxRate,
} from "../src/bot/formatters.js";
import type { ProcessResult } from "../src/orchestrator.js";
import type { TransactionRow, FxRateRow, TemplateRow } from "../src/storage/database.js";

function makeResult(overrides?: Partial<ProcessResult>): ProcessResult {
  return {
    transaction: {
      amount: 10.51,
      currency: "USD",
      payee: "Starbucks",
      date: "2026-03-20",
      externalId: "bp_1_1",
    },
    lmTransactionId: 1000,
    ...overrides,
  };
}

function makeRow(overrides?: Partial<TransactionRow>): TransactionRow {
  return {
    id: 1, external_id: "bp_1_1", lm_transaction_id: 1000,
    telegram_chat_id: 1, telegram_message_id: 1,
    amount: 10.00, currency: "USD", payee: "test",
    date: "2026-03-20", undone: 0, created_at: "",
    original_amount: null, original_currency: null,
    category_name: null, asset_name: null,
    fx_rate: null, fx_source: null,
    bot_reply_message_id: null, split_group_id: null,
    undone_at: null,
    ...overrides,
  } as TransactionRow;
}

describe("formatConfirmation", () => {
  it("formats a basic expense", () => {
    const result = formatConfirmation(makeResult());
    expect(result).toContain("Starbucks — $10.51 USD");
    expect(result).toContain("Date: 2026-03-20");
  });

  it("shows FX conversion when present", () => {
    const result = formatConfirmation(makeResult({
      transaction: {
        amount: 10.51, currency: "USD",
        originalAmount: 14500, originalCurrency: "ARS",
        payee: "Café", date: "2026-03-20", externalId: "bp_1_1",
      },
      fxRate: 1380,
    }));
    expect(result).toContain("ARS 14,500 @ 1,380");
  });

  it("shows category, account, and tags", () => {
    const result = formatConfirmation(makeResult({
      categoryName: "Coffee Shops",
      accountName: "Visa",
      autoTags: ["eating-out"],
    }));
    expect(result).toContain("Category: Coffee Shops");
    expect(result).toContain("Account: Visa");
    expect(result).toContain("Tags: #eating-out");
  });

  it("shows split count", () => {
    const result = formatConfirmation(makeResult({ splitCount: 3 }));
    expect(result).toContain("Split 3 ways");
  });

  it("shows income with + sign", () => {
    const result = formatConfirmation(makeResult({
      transaction: {
        amount: -50.00, currency: "USD",
        payee: "Salary", date: "2026-03-20", externalId: "bp_1_1",
      },
    }));
    expect(result).toContain("+$50.00");
  });

  it("formats multi-account split", () => {
    const result = formatConfirmation(makeResult({
      accountLegs: [
        { accountName: "Visa", amount: 5.00, lmTransactionId: 1, localRecordId: 1 },
        { accountName: "MP", amount: 5.51, lmTransactionId: 2, localRecordId: 2 },
      ],
      transaction: {
        amount: 10.51, currency: "USD",
        originalAmount: 14500, originalCurrency: "ARS",
        payee: "Pizza", date: "2026-03-20", externalId: "bp_1_1",
      },
      fxRate: 1380,
      categoryName: "Restaurants",
    }));
    expect(result).toContain("Visa: $5.00");
    expect(result).toContain("MP: $5.51");
    expect(result).toContain("Category: Restaurants");
    expect(result).toContain("ARS 14,500 @ 1,380");
  });
});

describe("buildReceiptKeyboard", () => {
  it("creates keyboard with Undo and Edit buttons", () => {
    const kb = buildReceiptKeyboard(42);
    const buttons = kb.inline_keyboard.flat();
    expect(buttons).toHaveLength(2);
    expect(buttons[0].text).toBe("Undo");
    expect((buttons[0] as any).callback_data).toBe("undo:42");
    expect(buttons[1].text).toBe("Edit");
  });
});

describe("formatUndone", () => {
  it("formats undo confirmation", () => {
    expect(formatUndone("starbucks", 10.51, "USD")).toBe("Undone: Starbucks $10.51 USD");
  });
});

describe("formatDaySummary", () => {
  it("shows empty message for no rows", () => {
    expect(formatDaySummary([], "2026-03-20")).toContain("No transactions");
  });

  it("formats rows with total", () => {
    const rows = [
      makeRow({ payee: "starbucks", amount: 10.00, currency: "USD", category_name: "Coffee" }),
      makeRow({ payee: "uber", amount: 5.50, currency: "USD" }),
    ];
    const result = formatDaySummary(rows, "2026-03-20");
    expect(result).toContain("2 transactions");
    expect(result).toContain("$15.50");
    expect(result).toContain("Starbucks");
    expect(result).toContain("→ Coffee");
  });

  it("shows original ARS amount when present", () => {
    const rows = [makeRow({ amount: 10.00, original_amount: 14000, original_currency: "ARS" })];
    const result = formatDaySummary(rows, "2026-03-20");
    expect(result).toContain("ARS");
    expect(result).toContain("14,000");
  });
});

describe("formatMonthSummary", () => {
  it("shows empty message", () => {
    expect(formatMonthSummary([], "2026-03")).toContain("No transactions");
  });

  it("groups by category", () => {
    const rows = [
      makeRow({ amount: 100, category_name: "Food" }),
      makeRow({ amount: 50, category_name: "Food" }),
      makeRow({ amount: 30, category_name: "Transport" }),
    ];
    const result = formatMonthSummary(rows, "2026-03");
    expect(result).toContain("3 transactions");
    expect(result).toContain("$180.00");
    expect(result).toContain("Food: $150.00");
    expect(result).toContain("Transport: $30.00");
  });

  it("uses Uncategorized for null category", () => {
    const rows = [makeRow({ amount: 10, category_name: null })];
    const result = formatMonthSummary(rows, "2026-03");
    expect(result).toContain("Uncategorized");
  });
});

describe("formatCategories", () => {
  it("shows empty message", () => {
    expect(formatCategories([])).toContain("No categories");
  });

  it("lists categories", () => {
    const result = formatCategories([{ id: 1, name: "Food" }, { id: 2, name: "Transport" }]);
    expect(result).toContain("Food");
    expect(result).toContain("Transport");
  });
});

describe("formatAssets", () => {
  it("shows empty message", () => {
    expect(formatAssets([])).toContain("No accounts");
  });

  it("lists accounts with currency", () => {
    const result = formatAssets([{ id: 1, name: "Visa", currency: "ARS" }]);
    expect(result).toContain("Visa (ARS)");
  });
});

describe("formatSearchResults", () => {
  it("shows empty message", () => {
    expect(formatSearchResults([], "pizza", 0, 0)).toContain("No results");
  });

  it("formats results with pagination info", () => {
    const rows = [
      makeRow({ payee: "pizza place", amount: 15.00, date: "2026-03-20", category_name: "Food" }),
    ];
    const result = formatSearchResults(rows, "pizza", 0, 5);
    expect(result).toContain("Showing 1-1 of 5");
    expect(result).toContain("Pizza place");
    expect(result).toContain("→ Food");
    expect(result).toContain("(2026-03-20)");
  });
});

describe("formatTemplateList", () => {
  it("shows empty message", () => {
    expect(formatTemplateList([])).toContain("No templates");
  });

  it("lists templates", () => {
    const templates = [{ id: 1, telegram_chat_id: 1, name: "netflix", text: "netflix 4500 streaming", created_at: "" }] as TemplateRow[];
    const result = formatTemplateList(templates);
    expect(result).toContain("/netflix → netflix 4500 streaming");
  });
});

describe("formatWeeklySummary", () => {
  it("shows empty message", () => {
    expect(formatWeeklySummary([], "2026-03-17", "2026-03-23")).toContain("No expenses");
  });

  it("formats with categories and top payees", () => {
    const rows = [
      makeRow({ payee: "starbucks", amount: 25.00, category_name: "Coffee" }),
      makeRow({ payee: "uber", amount: 15.00, category_name: "Transport" }),
      makeRow({ payee: "starbucks", amount: 10.00, category_name: "Coffee" }),
    ];
    const result = formatWeeklySummary(rows, "2026-03-17", "2026-03-23");
    expect(result).toContain("3 transactions");
    expect(result).toContain("$50.00");
    expect(result).toContain("Coffee: $35.00");
    expect(result).toContain("Starbucks: $35.00");
  });

  it("shows week-over-week comparison when prev data provided", () => {
    const rows = [makeRow({ amount: 100 })];
    const prevRows = [makeRow({ amount: 80 })];
    const result = formatWeeklySummary(rows, "2026-03-17", "2026-03-23", prevRows);
    expect(result).toContain("vs last week");
    expect(result).toContain("$80.00");
    expect(result).toContain("↑");
  });

  it("shows ↓ when spending decreased", () => {
    const rows = [makeRow({ amount: 50 })];
    const prevRows = [makeRow({ amount: 100 })];
    const result = formatWeeklySummary(rows, "2026-03-17", "2026-03-23", prevRows);
    expect(result).toContain("↓");
  });
});

describe("formatFxRate", () => {
  it("formats current rate", () => {
    const result = formatFxRate(
      { compra: 1380, venta: 1425, fechaActualizacion: "2026-03-20T18:00:00.000Z" },
      [],
    );
    expect(result).toContain("Blue Dollar");
    expect(result).toContain("Buy:  $1,380");
    expect(result).toContain("Sell: $1,425");
  });

  it("shows trend when history has 2+ entries", () => {
    const history = [
      { id: 2, pair: "ARS/USD", rate: 1425, source: "x", source_timestamp: "", fetched_at: "" },
      { id: 1, pair: "ARS/USD", rate: 1380, source: "x", source_timestamp: "", fetched_at: "" },
    ] as FxRateRow[];
    const result = formatFxRate(
      { compra: 1425, venta: 1450, fechaActualizacion: "2026-03-20T18:00:00.000Z" },
      history,
    );
    expect(result).toContain("Trend: ↑");
    expect(result).toContain("+45");
  });

  it("shows ↓ trend when rate decreased", () => {
    const history = [
      { id: 2, pair: "ARS/USD", rate: 1380, source: "x", source_timestamp: "", fetched_at: "" },
      { id: 1, pair: "ARS/USD", rate: 1425, source: "x", source_timestamp: "", fetched_at: "" },
    ] as FxRateRow[];
    const result = formatFxRate(
      { compra: 1380, venta: 1400, fechaActualizacion: "2026-03-20T18:00:00.000Z" },
      history,
    );
    expect(result).toContain("↓");
  });
});
