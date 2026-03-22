import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import { readFileSync } from "fs";
import { extractPdfText } from "../src/pdf/extract.js";
import { structureStatement, type StatementTransaction } from "../src/pdf/structure.js";
import {
  formatImportSummary,
  formatImportResult,
  buildImportKeyboard,
} from "../src/bot/formatters.js";

describe("PDF import integration", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // The expected transactions that the LLM should produce from the fixture PDF.
  // In a real test with a live LLM, this is what gpt-4o-mini returns.
  // Here we mock the LLM to return this known-good output.
  const EXPECTED_TRANSACTIONS: StatementTransaction[] = [
    { date: "2026-03-03", payee: "Mercado Libre", amount: 15200, currency: "ARS" },
    { date: "2026-03-03", payee: "Netflix", amount: 4499, currency: "ARS" },
    { date: "2026-03-04", payee: "Carrefour", amount: 22150.75, currency: "ARS" },
    { date: "2026-03-05", payee: "Spotify", amount: 3299, currency: "ARS" },
    { date: "2026-03-06", payee: "YPF", amount: 18500, currency: "ARS" },
    { date: "2026-03-07", payee: "Farmacity", amount: 8750.50, currency: "ARS" },
    { date: "2026-03-08", payee: "McDonalds", amount: 6890, currency: "ARS" },
    { date: "2026-03-09", payee: "Burger King", amount: 5420, currency: "ARS" },
    { date: "2026-03-10", payee: "Edenor", amount: 12340, currency: "ARS" },
    { date: "2026-03-10", payee: "Metrogas", amount: 8960, currency: "ARS" },
    { date: "2026-03-11", payee: "Mercado Pago", amount: -25000, currency: "ARS" },
    { date: "2026-03-12", payee: "Garbarino", amount: 45890, currency: "ARS" },
    { date: "2026-03-13", payee: "Jumbo", amount: 31200, currency: "ARS" },
    { date: "2026-03-14", payee: "Uber", amount: 4850, currency: "ARS" },
    { date: "2026-03-14", payee: "Starbucks", amount: 3780, currency: "ARS" },
    { date: "2026-03-15", payee: "Libreria", amount: 7650, currency: "ARS" },
    { date: "2026-03-16", payee: "Pago Minimo", amount: -45000, currency: "ARS" },
    { date: "2026-03-17", payee: "Cinemark", amount: 5200, currency: "ARS" },
    { date: "2026-03-18", payee: "Open 25", amount: 2890.50, currency: "ARS" },
    { date: "2026-03-19", payee: "Cabify", amount: 3650, currency: "ARS" },
    { date: "2026-03-20", payee: "Amazon Prime Video", amount: 2999, currency: "ARS" },
    { date: "2026-03-20", payee: "YouTube Premium", amount: 1799, currency: "ARS" },
    { date: "2026-03-21", payee: "Havanna", amount: 4150, currency: "ARS" },
  ];

  it("extracts text from fixture PDF and feeds it to structuring", async () => {
    const buf = readFileSync(
      new URL("./fixtures/visa-statement.pdf", import.meta.url),
    ).buffer;

    const text = await extractPdfText(buf);

    // Verify the extracted text contains all merchant names from the fixture
    expect(text).toContain("MERCADOLIBRE*VENDEDOR");
    expect(text).toContain("HAVANNA SUC RECOLETA");

    // Mock OpenAI to return our expected transactions with close date
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{
              message: {
                content: JSON.stringify({
                  close_date: "2026-03-31",
                  transactions: EXPECTED_TRANSACTIONS,
                }),
              },
            }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    ) as any;

    const result = await structureStatement(text, "test-key");

    expect(result.transactions).toHaveLength(23);
    expect(result.closeDate).toBe("2026-03-31");
    expect(result.transactions[0].date).toBe("2026-03-03");
    expect(result.transactions[0].payee).toBe("Mercado Libre");
    expect(result.transactions[0].amount).toBe(15200);

    // Credits should be negative
    expect(result.transactions[10].amount).toBe(-25000);
    expect(result.transactions[16].amount).toBe(-45000);

    // Last transaction
    expect(result.transactions[22].payee).toBe("Havanna");
    expect(result.transactions[22].date).toBe("2026-03-21");
  });

  it("sends extracted PDF text to OpenAI with correct structure", async () => {
    const buf = readFileSync(
      new URL("./fixtures/visa-statement.pdf", import.meta.url),
    ).buffer;
    const text = await extractPdfText(buf);

    let capturedBody: any;
    globalThis.fetch = mock((_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{
              message: {
                content: JSON.stringify({ close_date: "2026-03-31", transactions: EXPECTED_TRANSACTIONS }),
              },
            }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }) as any;

    await structureStatement(text, "test-key");

    // Verify the request sent to OpenAI
    expect(capturedBody.model).toBe("gpt-4o-mini");
    expect(capturedBody.temperature).toBe(0);
    expect(capturedBody.response_format.type).toBe("json_object");
    expect(capturedBody.messages).toHaveLength(2);
    expect(capturedBody.messages[0].role).toBe("system");
    expect(capturedBody.messages[1].role).toBe("user");
    // The user message should contain the extracted PDF text
    expect(capturedBody.messages[1].content).toContain("MERCADOLIBRE*VENDEDOR");
    expect(capturedBody.messages[1].content).toContain("HAVANNA SUC RECOLETA");
  });

  describe("formatters", () => {
    it("formatImportSummary shows all transactions with USD when preview provided", () => {
      const usdPreview = EXPECTED_TRANSACTIONS.map((t) => ({
        usdAmount: t.amount / 1400,
        rate: 1400,
      }));
      const summary = formatImportSummary(EXPECTED_TRANSACTIONS, usdPreview);

      expect(summary).toContain("23 transactions");
      expect(summary).toContain("2026-03-03");
      expect(summary).toContain("2026-03-21");
      expect(summary).toContain("Mercado Libre");
      expect(summary).toContain("Netflix");
      expect(summary).toContain("Havanna"); // last transaction shown too
      expect(summary).toContain("$"); // USD amounts present
      expect(summary).toContain("USD"); // total USD in header
    });

    it("formatImportSummary works without USD preview", () => {
      const summary = formatImportSummary(EXPECTED_TRANSACTIONS);

      expect(summary).toContain("23 transactions");
      expect(summary).toContain("Mercado Libre");
      expect(summary).not.toContain("USD");
    });

    it("formatImportResult shows created count and account", () => {
      const result = formatImportResult(23, 0, "Visa Gold");
      expect(result).toBe("Imported 23 transactions to Visa Gold.");
    });

    it("formatImportResult shows skipped count", () => {
      const result = formatImportResult(20, 3, "Visa");
      expect(result).toContain("3 skipped");
    });

    it("buildImportKeyboard shows account picker", () => {
      const accounts = [
        { id: 10, name: "Visa", currency: "ARS" },
        { id: 11, name: "Mercado Pago", currency: "ARS" },
        { id: 12, name: "Banco Galicia", currency: "ARS" },
      ];
      const kb = buildImportKeyboard("123:456", accounts);
      const rows = kb.inline_keyboard;

      // 3 accounts (2 + 1) + cancel row
      expect(rows.length).toBeGreaterThanOrEqual(2);
      const allButtons = rows.flat();
      const labels = allButtons.map((b: any) => b.text);
      expect(labels).toContain("Visa");
      expect(labels).toContain("Mercado Pago");
      expect(labels).toContain("Banco Galicia");
      expect(labels).toContain("Cancel");
    });

    it("buildImportKeyboard shows confirm/cancel when account selected", () => {
      const accounts = [
        { id: 10, name: "Visa", currency: "ARS" },
        { id: 11, name: "Mercado Pago", currency: "ARS" },
      ];
      const kb = buildImportKeyboard("123:456", accounts, 10);
      const allButtons = kb.inline_keyboard.flat();
      const labels = allButtons.map((b: any) => b.text);

      expect(labels).toContain("Confirm → Visa");
      expect(labels).toContain("Cancel");
      // Should NOT show account picker buttons
      expect(labels).not.toContain("Mercado Pago");
    });
  });
});
