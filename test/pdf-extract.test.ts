import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { extractPdfText } from "../src/pdf/extract.js";

describe("extractPdfText", () => {
  it("extracts text from the Visa statement fixture", async () => {
    const buf = readFileSync(
      new URL("./fixtures/visa-statement.pdf", import.meta.url),
    ).buffer;

    const text = await extractPdfText(buf);

    // Header
    expect(text).toContain("RESUMEN DE CUENTA");
    expect(text).toContain("Tarjeta Visa Gold");
    expect(text).toContain("GARCIA, JUAN MARTIN");

    // Transactions present
    expect(text).toContain("MERCADOLIBRE*VENDEDOR");
    expect(text).toContain("NETFLIX.COM");
    expect(text).toContain("CARREFOUR HIP SUC.42");
    expect(text).toContain("SPOTIFY AB");
    expect(text).toContain("YPF ESTACION AV.CABILDO");
    expect(text).toContain("FARMACITY SUC 128");
    expect(text).toContain("PEDIDOSYA*MCDONALDS");
    expect(text).toContain("UBER *TRIP");
    expect(text).toContain("STARBUCKS STORE 1042");
    expect(text).toContain("HAVANNA SUC RECOLETA");

    // Amounts in Argentine format
    expect(text).toContain("15.200,00");
    expect(text).toContain("22.150,75");
    expect(text).toContain("-25.000,00"); // credit
    expect(text).toContain("-45.000,00"); // payment

    // Dates in DD/MM/YYYY format
    expect(text).toContain("03/03/2026");
    expect(text).toContain("03/21/2026");

    // Summary section
    expect(text).toContain("DETALLE DE CONSUMOS");
    expect(text).toContain("251.895,16");
  });

  it("throws on empty/corrupt PDF", async () => {
    const emptyBuf = new ArrayBuffer(0);
    expect(extractPdfText(emptyBuf)).rejects.toThrow("PDF extraction failed");
  });

  it("throws on non-PDF data", async () => {
    const textBuf = new TextEncoder().encode("this is not a pdf").buffer;
    expect(extractPdfText(textBuf)).rejects.toThrow("PDF extraction failed");
  });
});
