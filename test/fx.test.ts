import { describe, expect, it, mock, beforeEach } from "bun:test";
import { FXService } from "../src/fx/index.js";

// Mock database
function createMockDb() {
  return {
    saveFxRate: mock(() => {}),
    getLatestFxRate: mock(() => null),
    // Add other methods as stubs
  } as any;
}

describe("FXService", () => {
  describe("convert", () => {
    it("converts ARS to USD", async () => {
      const db = createMockDb();
      const service = new FXService(db, 300);

      // Mock the fetch to return a rate
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              moneda: "USD",
              casa: "blue",
              nombre: "Blue",
              compra: 1380,
              venta: 1425,
              fechaActualizacion: "2026-03-17T12:00:00.000Z",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        )
      ) as any;

      try {
        const result = await service.convert(14500, "ARS", "USD");
        expect(result.convertedAmount).toBe(10.18); // 14500 / 1425 = 10.175... → 10.18
        expect(result.rate).toBe(1425);
        expect(result.originalAmount).toBe(14500);
        expect(result.originalCurrency).toBe("ARS");
        expect(result.convertedCurrency).toBe("USD");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("rejects unsupported conversion pairs", async () => {
      const db = createMockDb();
      const service = new FXService(db, 300);

      expect(service.convert(100, "EUR", "USD")).rejects.toThrow("Unsupported conversion");
    });

    it("uses cached rate within TTL", async () => {
      const db = createMockDb();
      const service = new FXService(db, 300);

      const originalFetch = globalThis.fetch;
      let fetchCount = 0;
      globalThis.fetch = mock(() => {
        fetchCount++;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              moneda: "USD",
              casa: "blue",
              nombre: "Blue",
              compra: 1380,
              venta: 1425,
              fechaActualizacion: "2026-03-17T12:00:00.000Z",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      }) as any;

      try {
        await service.convert(14500, "ARS", "USD");
        await service.convert(20000, "ARS", "USD");
        expect(fetchCount).toBe(1); // Only one fetch — second used cache
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
