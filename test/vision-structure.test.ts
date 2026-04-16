import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import { structureImage } from "../src/vision/structure.js";

describe("structureImage", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockVision(responseContent: string, status = 200) {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ choices: [{ message: { content: responseContent } }] }),
          { status, headers: { "Content-Type": "application/json" } },
        ),
      ),
    ) as unknown as typeof fetch;
  }

  const buf = new TextEncoder().encode("fake-image-bytes").buffer;

  it("parses valid response into transactions with category hints", async () => {
    mockVision(JSON.stringify({
      transactions: [
        { date: "2026-04-15", payee: "Abastecedor Barcala", amount: 157880.35, currency: "ARS", category_hint: "groceries" },
        { date: "2026-04-10", payee: "Ramen To Go", amount: 32419, currency: "ARS", category_hint: "restaurants" },
      ],
    }));

    const result = await structureImage(buf, "test-key", { today: "2026-04-16" });

    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0].payee).toBe("Abastecedor Barcala");
    expect(result.transactions[0].categoryHint).toBe("groceries");
    expect(result.transactions[1].categoryHint).toBe("restaurants");
    expect(result.closeDate).toBeUndefined();
  });

  it("handles missing category_hint", async () => {
    mockVision(JSON.stringify({
      transactions: [{ date: "2026-04-15", payee: "Test", amount: 1000, currency: "ARS" }],
    }));

    const result = await structureImage(buf, "test-key");
    expect(result.transactions[0].categoryHint).toBeUndefined();
  });

  it("sends base64 image_url and gpt-4o to OpenAI", async () => {
    globalThis.fetch = mock((_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      expect(body.model).toBe("gpt-4o");
      expect(body.temperature).toBe(0);
      expect(body.response_format.type).toBe("json_object");
      const userMsg = body.messages[1];
      expect(userMsg.role).toBe("user");
      expect(Array.isArray(userMsg.content)).toBe(true);
      const imagePart = userMsg.content.find((c: { type: string }) => c.type === "image_url");
      expect(imagePart).toBeDefined();
      expect(imagePart.image_url.url).toMatch(/^data:image\/png;base64,/);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({
              transactions: [{ date: "2026-04-15", payee: "T", amount: 1 }],
            }) } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }) as unknown as typeof fetch;

    await structureImage(buf, "test-key", { mimeType: "image/png" });
  });

  it("system prompt tells model to use today's date for year inference", async () => {
    globalThis.fetch = mock((_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      const systemPrompt = body.messages[0].content;
      expect(systemPrompt).toContain("Today is 2026-04-16");
      expect(systemPrompt).toContain("roll it back by one year");
      expect(systemPrompt).toContain("category_hint");
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({
              transactions: [{ date: "2026-04-15", payee: "T", amount: 1 }],
            }) } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }) as unknown as typeof fetch;

    await structureImage(buf, "test-key", { today: "2026-04-16" });
  });

  it("throws on OpenAI API error", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("Server Error", { status: 500 })),
    ) as unknown as typeof fetch;

    expect(structureImage(buf, "test-key")).rejects.toThrow("Failed to process image");
  });

  it("throws on invalid JSON", async () => {
    mockVision("not json at all");
    expect(structureImage(buf, "test-key")).rejects.toThrow("Failed to process image");
  });

  it("throws when transactions array is empty", async () => {
    mockVision(JSON.stringify({ transactions: [] }));
    expect(structureImage(buf, "test-key")).rejects.toThrow("No transactions found");
  });
});
