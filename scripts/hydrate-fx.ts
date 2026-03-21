/**
 * One-off script to backfill fx_rates with historical blue dollar data
 * from ArgentinaDatos API.
 *
 * Usage: bun scripts/hydrate-fx.ts [--db path/to/blueplate.db] [--since YYYY-MM-DD]
 *
 * Defaults to rates from 2024-01-01 onward (~800 records).
 * Safe to re-run — skips dates that already exist.
 */
import { BlueplateDatabase } from "../src/storage/database.js";

const ARGENTINA_DATOS_URL = "https://api.argentinadatos.com/v1/cotizaciones/dolares/blue";
const DEFAULT_SINCE = "2024-01-01";

interface HistoricalRate {
  casa: string;
  compra: number;
  venta: number;
  fecha: string; // YYYY-MM-DD
}

async function main() {
  const dbPath = process.argv.includes("--db")
    ? process.argv[process.argv.indexOf("--db") + 1]
    : "./data/blueplate.db";

  const since = process.argv.includes("--since")
    ? process.argv[process.argv.indexOf("--since") + 1]
    : DEFAULT_SINCE;

  console.log(`Database: ${dbPath}`);
  console.log(`Since: ${since}`);

  const db = await BlueplateDatabase.create(dbPath);

  console.log("Fetching blue dollar rates from ArgentinaDatos...");
  const resp = await fetch(ARGENTINA_DATOS_URL);
  if (!resp.ok) {
    console.error(`Failed: ${resp.status} ${resp.statusText}`);
    process.exit(1);
  }

  const allRates: HistoricalRate[] = await resp.json() as HistoricalRate[];
  const rates = allRates.filter((r) => r.fecha >= since);
  console.log(`Fetched ${allRates.length} total, using ${rates.length} from ${since}`);

  let inserted = 0;
  let skipped = 0;

  for (const rate of rates) {
    // Use compra (buy) rate — what you'd get selling USD to cover ARS expenses
    const timestamp = `${rate.fecha}T18:00:00.000Z`;

    // Skip if we already have a rate for this exact date
    const existing = db.getRateNearDate("ARS/USD", rate.fecha);
    if (existing && existing.source_timestamp.startsWith(rate.fecha)) {
      skipped++;
      continue;
    }

    db.saveFxRate("ARS/USD", rate.compra, "argentinadatos-blue", timestamp);
    inserted++;
  }

  console.log(`Done. Inserted: ${inserted}, Skipped: ${skipped}`);
  db.close();
}

main();
