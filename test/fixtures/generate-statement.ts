/**
 * Generates a realistic Argentine Visa credit card statement PDF for testing.
 * Run: bun test/fixtures/generate-statement.ts
 *
 * Produces test/fixtures/visa-statement.pdf — a text-based PDF that unpdf can extract.
 * The transactions match what the integration test expects.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { writeFileSync } from "fs";

const TRANSACTIONS = [
  { date: "03/03/2026", description: "MERCADOLIBRE*VENDEDOR", amount: "15.200,00" },
  { date: "03/03/2026", description: "NETFLIX.COM", amount: "4.499,00" },
  { date: "03/04/2026", description: "CARREFOUR HIP SUC.42", amount: "22.150,75" },
  { date: "03/05/2026", description: "SPOTIFY AB", amount: "3.299,00" },
  { date: "03/06/2026", description: "YPF ESTACION AV.CABILDO", amount: "18.500,00" },
  { date: "03/07/2026", description: "FARMACITY SUC 128", amount: "8.750,50" },
  { date: "03/08/2026", description: "PEDIDOSYA*MCDONALDS", amount: "6.890,00" },
  { date: "03/09/2026", description: "RAPPI*BURGER KING", amount: "5.420,00" },
  { date: "03/10/2026", description: "PAGO SERVICIOS - EDENOR", amount: "12.340,00" },
  { date: "03/10/2026", description: "PAGO SERVICIOS - METROGAS", amount: "8.960,00" },
  { date: "03/11/2026", description: "MERCADOPAGO*TRANSFER", amount: "-25.000,00" },
  { date: "03/12/2026", description: "GARBARINO ELECTRONICA", amount: "45.890,00" },
  { date: "03/13/2026", description: "JUMBO SUC PALERMO", amount: "31.200,00" },
  { date: "03/14/2026", description: "UBER *TRIP", amount: "4.850,00" },
  { date: "03/14/2026", description: "STARBUCKS STORE 1042", amount: "3.780,00" },
  { date: "03/15/2026", description: "TIENDANUBE*LIBRERIA", amount: "7.650,00" },
  { date: "03/16/2026", description: "PAGO MINIMO ANTERIOR", amount: "-45.000,00" },
  { date: "03/17/2026", description: "CINEMARK HOYTS ABASTO", amount: "5.200,00" },
  { date: "03/18/2026", description: "OPEN 25 SUC CABALLITO", amount: "2.890,50" },
  { date: "03/19/2026", description: "CABIFY AR*VIAJE", amount: "3.650,00" },
  { date: "03/20/2026", description: "AMAZON PRIME VIDEO", amount: "2.999,00" },
  { date: "03/20/2026", description: "GOOGLE*YOUTUBE PREMIUM", amount: "1.799,00" },
  { date: "03/21/2026", description: "HAVANNA SUC RECOLETA", amount: "4.150,00" },
];

async function generate() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595, 842]); // A4

  const black = rgb(0, 0, 0);
  const gray = rgb(0.4, 0.4, 0.4);
  const darkBlue = rgb(0.1, 0.2, 0.5);
  let y = 800;

  const drawText = (text: string, x: number, yPos: number, size = 10, f = font, color = black) => {
    page.drawText(text, { x, y: yPos, size, font: f, color });
  };

  // Header
  drawText("VISA", 50, y, 24, fontBold, darkBlue);
  drawText("RESUMEN DE CUENTA", 150, y, 16, fontBold, darkBlue);
  y -= 20;
  drawText("Tarjeta Visa Gold", 150, y, 10, font, gray);
  y -= 30;

  // Account info
  drawText("Titular: GARCIA, JUAN MARTIN", 50, y, 10, fontBold);
  drawText("Numero de Tarjeta: XXXX XXXX XXXX 4532", 350, y, 9, font, gray);
  y -= 15;
  drawText("DNI: XX.XXX.XXX", 50, y, 9, font, gray);
  drawText("Moneda: Pesos Argentinos (ARS)", 350, y, 9, font, gray);
  y -= 25;

  // Period
  drawText("Periodo: 01/03/2026 al 31/03/2026", 50, y, 10, fontBold);
  drawText("Fecha de Cierre: 31/03/2026", 350, y, 10);
  y -= 15;
  drawText("Fecha de Vencimiento: 10/04/2026", 50, y, 10);
  drawText("Pago Minimo: $ 35.000,00", 350, y, 10);
  y -= 30;

  // Summary box
  drawText("RESUMEN", 50, y, 12, fontBold, darkBlue);
  y -= 18;
  drawText("Saldo Anterior:", 50, y, 10);
  drawText("$ 120.450,00", 250, y, 10);
  y -= 14;
  drawText("Pagos y Creditos:", 50, y, 10);
  drawText("$ -70.000,00", 250, y, 10);
  y -= 14;
  drawText("Consumos del Periodo:", 50, y, 10);
  drawText("$ 196.068,75", 250, y, 10);
  y -= 14;
  drawText("Intereses:", 50, y, 10);
  drawText("$ 0,00", 250, y, 10);
  y -= 14;
  drawText("IVA:", 50, y, 10);
  drawText("$ 4.200,00", 250, y, 10);
  y -= 14;
  drawText("Imp. Sellos:", 50, y, 10);
  drawText("$ 1.176,41", 250, y, 10);
  y -= 14;
  drawText("Total:", 50, y, 10, fontBold);
  drawText("$ 251.895,16", 250, y, 10, fontBold);
  y -= 30;

  // Transaction header
  drawText("DETALLE DE CONSUMOS", 50, y, 12, fontBold, darkBlue);
  y -= 20;
  drawText("FECHA", 50, y, 9, fontBold, gray);
  drawText("DESCRIPCION", 130, y, 9, fontBold, gray);
  drawText("MONTO ($)", 470, y, 9, fontBold, gray);
  y -= 5;
  page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 0.5, color: gray });
  y -= 14;

  // Transactions
  for (const tx of TRANSACTIONS) {
    if (y < 60) {
      // Would need a second page, but for this fixture we stop
      drawText("... continua en pagina siguiente ...", 50, y, 8, font, gray);
      break;
    }
    drawText(tx.date, 50, y, 9);
    drawText(tx.description, 130, y, 9);
    // Right-align amount
    const amountWidth = font.widthOfTextAtSize(tx.amount, 9);
    drawText(tx.amount, 535 - amountWidth, y, 9);
    y -= 13;
  }

  // Footer
  y -= 10;
  page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 0.5, color: gray });
  y -= 14;
  drawText("TNA Compensatorio: 157,00% | TEA: 360,32% | CFT: 420,15%", 50, y, 8, font, gray);
  y -= 12;
  drawText("Centro de Atencion al Cliente: 0-800-666-VISA (8472)", 50, y, 8, font, gray);
  y -= 12;
  drawText("Entidad Emisora - CUIT: 30-XXXXXXXX-X", 50, y, 8, font, gray);

  const bytes = await doc.save();
  const outPath = new URL("./visa-statement.pdf", import.meta.url).pathname;
  writeFileSync(outPath, bytes);
  console.log(`Written: ${outPath} (${bytes.length} bytes)`);
}

generate();
