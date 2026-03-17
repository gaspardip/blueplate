import { FXError } from "../errors.js";
import { logger } from "../logger.js";
import type { FXQuote } from "./types.js";

const DOLAR_API_BASE = "https://dolarapi.com/v1";

interface DolarApiResponse {
  moneda: string;
  casa: string;
  nombre: string;
  compra: number;
  venta: number;
  fechaActualizacion: string;
}

export async function fetchBlueRate(): Promise<FXQuote> {
  try {
    const resp = await fetch(`${DOLAR_API_BASE}/dolares/blue`);
    if (!resp.ok) {
      throw new FXError(`DolarAPI returned ${resp.status}: ${resp.statusText}`);
    }

    const data = (await resp.json()) as DolarApiResponse;

    if (!data.venta || data.venta <= 0) {
      throw new FXError("DolarAPI returned invalid venta rate");
    }

    logger.debug("DolarAPI blue rate fetched", {
      compra: data.compra,
      venta: data.venta,
      updated: data.fechaActualizacion,
    });

    return {
      pair: "ARS/USD",
      rate: data.venta,
      source: "dolarapi.com",
      sourceTimestamp: data.fechaActualizacion,
      fetchedAt: new Date(),
    };
  } catch (error) {
    if (error instanceof FXError) throw error;
    throw new FXError(`Failed to fetch blue rate: ${error}`);
  }
}
