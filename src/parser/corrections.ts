import { tokenize } from "./tokenizer.js";

export interface Correction {
  amount?: number;
  currency?: string;
  categoryHint?: string;
  assetHint?: string;
  payee?: string;
}

// Patterns that indicate a correction to the last transaction:
// "no, 12k" / "wrong, visa" / "actually restaurants" / "it was 15k"
const CORRECTION_PREFIXES = [
  "no", "nah", "wrong", "actually", "wait", "oops",
  "no,", "nah,", "wrong,", "actually,", "wait,", "oops,",
  "it was", "should be", "meant", "quise decir", "era", "en realidad",
];

export function parseCorrection(text: string): Correction | null {
  const lower = text.toLowerCase().trim();

  // Check if the message starts with a correction prefix
  let body = "";
  let isCorrection = false;

  for (const prefix of CORRECTION_PREFIXES) {
    if (lower.startsWith(prefix)) {
      body = text.slice(prefix.length).replace(/^[\s,]+/, "").trim();
      isCorrection = true;
      break;
    }
  }

  if (!isCorrection || !body) return null;

  // Tokenize the correction body
  const tokens = tokenize(body);
  const correction: Correction = {};
  let hasAnything = false;

  for (const token of tokens) {
    if (token.type === "amount" && correction.amount == null) {
      correction.amount = Number(token.value);
      hasAnything = true;
    } else if (token.type === "currency" && correction.currency == null) {
      correction.currency = token.value;
      hasAnything = true;
    } else if (token.type === "text") {
      // Could be a category, account, or payee — store as hint
      // The orchestrator will try to resolve it
      if (!correction.categoryHint) {
        correction.categoryHint = token.value;
        hasAnything = true;
      } else if (!correction.assetHint) {
        correction.assetHint = token.value;
        hasAnything = true;
      }
    }
  }

  return hasAnything ? correction : null;
}
