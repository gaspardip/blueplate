import type { ResolutionContext } from "../types.js";
import type { ParseOutcome } from "./types.js";
import { tokenize } from "./tokenizer.js";
import { buildExpense } from "./grammar.js";

export function parse(text: string, ctx: ResolutionContext): ParseOutcome {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, error: "invalid", message: "Empty message." };
  }

  const tokens = tokenize(trimmed);
  return buildExpense(tokens, ctx);
}

export type { ParseOutcome, ParsedExpense, ParseResult, ParseAmbiguous, ParseInvalid, AccountSplit } from "./types.js";
