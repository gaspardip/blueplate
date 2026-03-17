import type { Transaction } from "../types.js";
import type { BlueplateMetadata, LMCreateTransactionPayload } from "./types.js";

export function buildMetadata(
  tx: Transaction,
  chatId: number,
  messageId: number,
  fxRate?: number,
  fxSource?: string
): BlueplateMetadata {
  const meta: BlueplateMetadata = {
    blueplate_version: 1,
    ingested_via: "telegram",
    telegram_chat_id: chatId,
    telegram_message_id: messageId,
  };

  if (tx.originalAmount != null && tx.originalCurrency) {
    meta.original_amount = tx.originalAmount;
    meta.original_currency = tx.originalCurrency;
  }

  if (fxRate != null && fxSource) {
    meta.fx_rate = fxRate;
    meta.fx_mode = "blue_sell";
    meta.fx_source = fxSource;
  }

  return meta;
}

export function transactionToPayload(
  tx: Transaction,
  metadata: BlueplateMetadata,
  userNote?: string
): LMCreateTransactionPayload {
  const payload: LMCreateTransactionPayload = {
    date: tx.date,
    payee: tx.payee, // already normalized by PayeeNormalizer
    amount: tx.amount.toFixed(2),
    currency: tx.currency.toLowerCase(),
    external_id: tx.externalId,
    status: "reviewed",
    custom_metadata: metadata as Record<string, unknown>,
  };

  if (tx.categoryId) {
    payload.category_id = tx.categoryId;
  }

  if (tx.assetId) {
    payload.manual_account_id = tx.assetId;
  }

  if (userNote) {
    payload.notes = userNote;
  }

  return payload;
}