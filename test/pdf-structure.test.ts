import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import { structureStatement } from "../src/pdf/structure.js";

describe("structureStatement", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockOpenAI(responseContent: string, status = 200) {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: responseContent } }],
          }),
          { status, headers: { "Content-Type": "application/json" } },
        ),
      ),
    ) as any;
  }

  it("parses valid LLM response into transactions", async () => {
    const llmResponse = JSON.stringify({
      close_date: "2026-03-31",
      transactions: [
        { date: "2026-03-01", payee: "Mercado Libre", amount: 15200, currency: "ARS" },
        { date: "2026-03-02", payee: "Netflix", amount: 4500, currency: "ARS" },
        { date: "2026-03-03", payee: "Carrefour", amount: -2000, currency: "ARS" },
      ],
    });
    mockOpenAI(llmResponse);

    const result = await structureStatement("fake pdf text", "test-key");

    expect(result.transactions).toHaveLength(3);
    expect(result.transactions[0].date).toBe("2026-03-01");
    expect(result.transactions[0].payee).toBe("Mercado Libre");
    expect(result.transactions[0].amount).toBe(15200);
    expect(result.transactions[2].amount).toBe(-2000); // credit
    expect(result.closeDate).toBe("2026-03-31");
  });

  it("returns undefined closeDate when LLM omits it", async () => {
    const llmResponse = JSON.stringify({
      transactions: [
        { date: "2026-03-01", payee: "Test", amount: 100 },
      ],
    });
    mockOpenAI(llmResponse);

    const result = await structureStatement("text", "test-key");
    expect(result.closeDate).toBeUndefined();
  });

  it("passes currency hint in user message", async () => {
    const llmResponse = JSON.stringify({
      transactions: [
        { date: "2026-03-01", payee: "Test", amount: 100, currency: "USD" },
      ],
    });
    globalThis.fetch = mock((_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      const userMsg = body.messages[1].content;
      expect(userMsg).toContain("Default currency: USD");
      return Promise.resolve(
        new Response(
          JSON.stringify({ choices: [{ message: { content: llmResponse } }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }) as any;

    await structureStatement("text", "test-key", { currency: "USD" });
  });

  it("throws on OpenAI API error", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("Server Error", { status: 500 })),
    ) as any;

    expect(structureStatement("text", "test-key")).rejects.toThrow("Failed to process PDF");
  });

  it("throws on invalid JSON from LLM", async () => {
    mockOpenAI("not json at all");
    expect(structureStatement("text", "test-key")).rejects.toThrow("Failed to process PDF");
  });

  it("throws when LLM returns empty transactions array", async () => {
    mockOpenAI(JSON.stringify({ transactions: [] }));
    expect(structureStatement("text", "test-key")).rejects.toThrow("No transactions found");
  });

  it("throws when LLM returns invalid transaction shape", async () => {
    mockOpenAI(JSON.stringify({ transactions: [{ bad: "shape" }] }));
    expect(structureStatement("text", "test-key")).rejects.toThrow("No transactions found");
  });

  it("handles mixed ARS and USD transactions", async () => {
    const llmResponse = JSON.stringify({
      close_date: "2025-02-28",
      transactions: [
        { date: "2025-02-01", payee: "Carrefour", amount: 22150.75, currency: "ARS" },
        { date: "2025-02-03", payee: "Apple.com", amount: 149.99, currency: "USD" },
        { date: "2025-02-05", payee: "Netflix", amount: 17.78, currency: "USD" },
        { date: "2025-02-10", payee: "YPF", amount: 18500, currency: "ARS" },
      ],
    });
    mockOpenAI(llmResponse);

    const result = await structureStatement("text", "test-key");

    expect(result.transactions).toHaveLength(4);
    expect(result.transactions[0].currency).toBe("ARS");
    expect(result.transactions[1].currency).toBe("USD");
    expect(result.transactions[1].amount).toBe(149.99);
    expect(result.transactions[2].currency).toBe("USD");
    expect(result.closeDate).toBe("2025-02-28");
  });

  it("system prompt includes date carry-forward instructions", async () => {
    const llmResponse = JSON.stringify({
      transactions: [{ date: "2025-01-25", payee: "Test", amount: 100 }],
    });
    globalThis.fetch = mock((_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      const systemPrompt = body.messages[0].content;
      expect(systemPrompt).toContain("carry forward");
      expect(systemPrompt).toContain("PLATFORM*MERCHANT");
      expect(systemPrompt).toContain("two amount columns");
      return Promise.resolve(
        new Response(
          JSON.stringify({ choices: [{ message: { content: llmResponse } }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }) as any;

    await structureStatement("text", "test-key");
  });

  it("uses gpt-4o-mini model with json_object response format", async () => {
    const llmResponse = JSON.stringify({
      transactions: [{ date: "2026-03-01", payee: "Test", amount: 100 }],
    });
    globalThis.fetch = mock((_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      expect(body.model).toBe("gpt-4o-mini");
      expect(body.response_format.type).toBe("json_object");
      expect(body.temperature).toBe(0);
      return Promise.resolve(
        new Response(
          JSON.stringify({ choices: [{ message: { content: llmResponse } }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }) as any;

    await structureStatement("text", "test-key");
  });
});
