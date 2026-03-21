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
