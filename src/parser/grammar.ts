import type { ResolutionContext, CachedCategory, CachedAsset } from "../types.js";
import type { Token, ParsedExpense, ParseOutcome } from "./types.js";

export function buildExpense(tokens: Token[], ctx: ResolutionContext): ParseOutcome {
  const amounts = tokens.filter((t) => t.type === "amount");
  const currencies = tokens.filter((t) => t.type === "currency");
  const dates = tokens.filter((t) => t.type === "date");
  const tags = tokens.filter((t) => t.type === "tag");
  const notes = tokens.filter((t) => t.type === "note");
  const textTokens = tokens.filter((t) => t.type === "text");

  // Validate: must have exactly one amount
  if (amounts.length === 0) {
    return { ok: false, error: "invalid", message: "No amount found. Try: pizza 1500" };
  }
  if (amounts.length > 1) {
    return {
      ok: false,
      error: "ambiguous",
      message: `Multiple amounts found: ${amounts.map((a) => a.raw).join(", ")}. Send one expense per message.`,
    };
  }

  const amount = Number(amounts[0].value);
  const currency = currencies.length > 0 ? currencies[0].value : undefined;
  const date = dates.length > 0 ? dates[0].value : undefined;

  // Resolve text tokens against known categories and assets
  let categoryHint: string | undefined;
  let assetHint: string | undefined;
  const payeeParts: string[] = [];

  for (const token of textTokens) {
    const catMatch = fuzzyMatchCategory(token.value, ctx.categories);
    if (catMatch && !categoryHint) {
      categoryHint = catMatch.name;
      continue;
    }

    const assetMatch = fuzzyMatchAsset(token.value, ctx.assets);
    if (assetMatch && !assetHint) {
      assetHint = assetMatch.name;
      continue;
    }

    payeeParts.push(token.raw);
  }

  const payee = payeeParts.join(" ");
  if (!payee) {
    return { ok: false, error: "invalid", message: "No payee found. Try: café 1500" };
  }

  const expense: ParsedExpense = {
    amount,
    currency,
    payee,
    categoryHint,
    assetHint,
    tags: tags.map((t) => t.value),
    note: notes.map((n) => n.value).join(" ") || undefined,
    date,
  };

  return { ok: true, expense };
}

function fuzzyMatchCategory(input: string, categories: CachedCategory[]): CachedCategory | null {
  const lower = input.toLowerCase();
  // Exact match first
  const exact = categories.find((c) => c.name.toLowerCase() === lower);
  if (exact) return exact;

  // Prefix match (at least 3 chars)
  if (lower.length >= 3) {
    const prefix = categories.find((c) => c.name.toLowerCase().startsWith(lower));
    if (prefix) return prefix;
  }

  // Contains match (at least 4 chars to reduce false positives)
  if (lower.length >= 4) {
    const contains = categories.find((c) => c.name.toLowerCase().includes(lower));
    if (contains) return contains;
  }

  return null;
}

function fuzzyMatchAsset(input: string, assets: CachedAsset[]): CachedAsset | null {
  const lower = input.toLowerCase();
  const exact = assets.find(
    (a) => a.name.toLowerCase() === lower || (a.displayName && a.displayName.toLowerCase() === lower)
  );
  if (exact) return exact;

  if (lower.length >= 3) {
    const prefix = assets.find(
      (a) =>
        a.name.toLowerCase().startsWith(lower) ||
        (a.displayName && a.displayName.toLowerCase().startsWith(lower))
    );
    if (prefix) return prefix;
  }

  return null;
}
