import type { Transaction } from "../types.js";
import type { LMCreateTransactionPayload } from "./types.js";

export function buildMetadataBlock(tx: Transaction): string {
  const lines = ["[blueplate:v1]"];

  if (tx.originalAmount != null && tx.originalCurrency) {
    lines.push(`original_amount=${tx.originalAmount}`);
    lines.push(`original_currency=${tx.originalCurrency}`);
  }

  // FX metadata is derived from originalCurrency being different from currency
  lines.push("ingested_via=telegram");

  return lines.join("\n");
}

export function buildMetadataBlockWithFX(
  tx: Transaction,
  fxRate: number,
  fxSource: string
): string {
  const lines = ["[blueplate:v1]"];
  lines.push(`original_amount=${tx.originalAmount}`);
  lines.push(`original_currency=${tx.originalCurrency}`);
  lines.push(`fx_rate=${fxRate}`);
  lines.push("fx_mode=blue_sell");
  lines.push(`fx_source=${fxSource}`);
  lines.push("ingested_via=telegram");
  return lines.join("\n");
}

export function transactionToPayload(tx: Transaction, notes: string): LMCreateTransactionPayload {
  // Lunch Money expects negative amounts for debits
  const payload: LMCreateTransactionPayload = {
    date: tx.date,
    payee: capitalize(tx.payee),
    amount: tx.amount.toFixed(2),
    currency: tx.currency.toLowerCase(),
    external_id: tx.externalId,
    status: "cleared",
  };

  if (tx.categoryId) {
    payload.category_id = tx.categoryId;
  }

  if (tx.assetId) {
    payload.asset_id = tx.assetId;
  }

  if (notes) {
    payload.notes = notes;
  }

  return payload;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
