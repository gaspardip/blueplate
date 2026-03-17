import { FXError } from "../errors.js";
import { logger } from "../logger.js";
import type { BlueplateDatabase } from "../storage/database.js";
import { fetchBlueRate } from "./dolar-api.js";
import type { FXConversion, FXQuote } from "./types.js";

export class FXService {
  private cache: FXQuote | null = null;
  private cacheTtlMs: number;

  constructor(
    private db: BlueplateDatabase,
    cacheTtlSeconds: number
  ) {
    this.cacheTtlMs = cacheTtlSeconds * 1000;
  }

  async getBlueRate(): Promise<FXQuote> {
    // Check in-memory cache
    if (this.cache && Date.now() - this.cache.fetchedAt.getTime() < this.cacheTtlMs) {
      logger.debug("Using cached blue rate", { rate: this.cache.rate });
      return this.cache;
    }

    // Try fetching fresh rate
    try {
      const quote = await fetchBlueRate();
      this.cache = quote;
      this.db.saveFxRate(quote.pair, quote.rate, quote.source, quote.sourceTimestamp);
      return quote;
    } catch (error) {
      // Fall back to DB cache if recent enough (< 1 hour)
      const dbRate = this.db.getLatestFxRate("ARS/USD");
      if (dbRate) {
        const age = Date.now() - new Date(dbRate.fetched_at).getTime();
        if (age < 3600_000) {
          logger.warn("Using stale DB rate", { age: Math.round(age / 1000), rate: dbRate.rate });
          this.cache = {
            pair: dbRate.pair,
            rate: dbRate.rate,
            source: dbRate.source,
            sourceTimestamp: dbRate.source_timestamp,
            fetchedAt: new Date(dbRate.fetched_at),
          };
          return this.cache;
        }
      }
      throw new FXError("Can't get blue rate. Try again shortly.");
    }
  }

  async convert(amount: number, from: string, to: string): Promise<FXConversion> {
    if (from !== "ARS" || to !== "USD") {
      throw new FXError(`Unsupported conversion: ${from} → ${to}`);
    }

    const quote = await this.getBlueRate();
    const converted = Math.round((amount / quote.rate) * 100) / 100;

    return {
      originalAmount: amount,
      originalCurrency: from,
      convertedAmount: converted,
      convertedCurrency: to,
      rate: quote.rate,
      source: quote.source,
    };
  }
}

export type { FXQuote, FXConversion } from "./types.js";
