import { tokenize } from "./tokenizer.js";

export interface Correction {
  amount?: number;
  currency?: string;
  categoryHint?: string;
  assetHint?: string;
  payee?: string;
}

// Patterns that indicate a correction to the last transaction.
// Sorted longest-first so "en realidad" matches before "en".
const CORRECTION_PREFIXES = [
  // Spanish (longer first)
  "en realidad", "quise decir", "deberia ser", "debería ser",
  "no era", "mal,", "mal ", "perdon,", "perdón,",
  "eran", "fueron", "quisé decir", "era",
  // English (longer first)
  "it was", "should be", "i meant", "actually",
  "wrong,", "wrong ", "wait,", "wait ", "oops,", "oops ",
  "nah,", "nah ",
  // Short — must be last (match "no" carefully)
  "no,", "no ",
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
