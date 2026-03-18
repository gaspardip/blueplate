import type { ResolutionContext, CachedCategory, CachedAsset } from "../types.js";
import type { Token, ParsedExpense, ParseOutcome } from "./types.js";

// Strip leading emojis and whitespace from category/asset names for matching
function stripEmoji(s: string): string {
  return s
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D]/gu, "")
    .trim();
}

// Spanish (and common shorthand) aliases → English category name fragments
// Used for fuzzy matching when the user types in Spanish
const CATEGORY_ALIASES: Record<string, string[]> = {
  // Food & Drinks
  "cafe": ["coffee shops"],
  "café": ["coffee shops"],
  "cafeteria": ["coffee shops"],
  "cafetería": ["coffee shops"],
  "comida": ["restaurants", "groceries"],
  "restaurante": ["restaurants"],
  "resto": ["restaurants"],
  "bar": ["alcohol, bars"],
  "birra": ["alcohol, bars"],
  "cerveza": ["alcohol, bars"],
  "trago": ["alcohol, bars"],
  "super": ["groceries"],
  "supermercado": ["groceries"],
  "verduleria": ["groceries"],
  "verdulería": ["groceries"],
  "almacen": ["groceries"],
  "almacén": ["groceries"],
  "delivery": ["food delivery"],
  "pedido": ["food delivery"],
  // Transportation
  "taxi": ["rideshare, taxi"],
  "remis": ["rideshare, taxi"],
  "colectivo": ["public transit"],
  "subte": ["public transit"],
  "bondi": ["public transit"],
  "sube": ["public transit"],
  "nafta": ["gas"],
  "combustible": ["gas"],
  // Housing
  "alquiler": ["rent, mortgage"],
  "renta": ["rent, mortgage"],
  "expensas": ["hoa fees"],
  "luz": ["electricity"],
  "agua": ["water"],
  "internet": ["internet"],
  "telefono": ["phone"],
  "teléfono": ["phone"],
  "celular": ["phone"],
  // Entertainment
  "streaming": ["streaming services"],
  "juegos": ["gaming"],
  "libros": ["books, media"],
  "cine": ["events"],
  "teatro": ["events"],
  "recital": ["events"],
  // Shopping
  "ropa": ["clothing"],
  "electronica": ["electronics"],
  "electrónica": ["electronics"],
  "tech": ["electronics"],
  // Personal Care
  "gym": ["fitness"],
  "gimnasio": ["fitness"],
  "medico": ["healthcare"],
  "médico": ["healthcare"],
  "farmacia": ["healthcare"],
  "salud": ["healthcare"],
  // Financial
  "impuestos": ["taxes"],
  "banco": ["bank fees"],
  "transferencia": ["payment, transfer"],
  // Income
  "sueldo": ["income"],
  "ingreso": ["income"],
  // Tools
  "tools": ["tools"],
  "software": ["tools"],
  "saas": ["tools"],
  "herramientas": ["tools"],
  // Hobbies
  "hobbies": ["hobbies"],
  "hobby": ["hobbies"],
  "musica": ["hobbies"],
  "música": ["hobbies"],
  // Professional Services
  "contador": ["professional services"],
  "abogado": ["professional services"],
  "profesional": ["professional services"],
  // Household
  "casa": ["household"],
  "hogar": ["household"],
  "empleada": ["household"],
  "limpieza": ["household"],
  "domestica": ["household"],
  "doméstica": ["household"],
  // Loans & Transfers
  "prestamo": ["loans"],
  "préstamo": ["loans"],
  "deuda": ["loans"],
  "preste": ["loans"],
};

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

  // Match categories and accounts from the END of text tokens.
  // Convention: <payee words...> <category> <account>
  // Must leave at least 1 token for payee.
  let categoryHint: string | undefined;
  let assetHint: string | undefined;
  const matchedTokenIndices = new Set<number>();

  // Scan for category: try phrases from end, longest first.
  // Must leave at least 1 unmatched token for payee.
  outer:
  for (let end = textTokens.length - 1; end >= 1 && !categoryHint; end--) {
    // Try longest phrase ending at `end`, starting from earliest possible position (1, to leave payee)
    for (let start = 1; start <= end; start++) {
      const phrase = textTokens
        .slice(start, end + 1)
        .map((t) => t.value)
        .join(" ");
      const catMatch = fuzzyMatchCategory(phrase, ctx.categories);
      if (catMatch) {
        const wouldMatch = new Set(matchedTokenIndices);
        for (let k = start; k <= end; k++) wouldMatch.add(k);
        const remaining = textTokens.filter((_, idx) => !wouldMatch.has(idx));
        if (remaining.length >= 1) {
          categoryHint = catMatch.name;
          for (let k = start; k <= end; k++) matchedTokenIndices.add(k);
          break outer;
        }
      }
    }
  }

  // Scan from end for account matches
  for (let i = textTokens.length - 1; i >= 0 && !assetHint; i--) {
    if (matchedTokenIndices.has(i)) continue;
    const assetMatch = fuzzyMatchAsset(textTokens[i].value, ctx.assets);
    if (assetMatch) {
      const wouldMatch = new Set(matchedTokenIndices);
      wouldMatch.add(i);
      const remaining = textTokens.filter((_, idx) => !wouldMatch.has(idx));
      if (remaining.length >= 1) {
        assetHint = assetMatch.name;
        matchedTokenIndices.add(i);
      }
    }
  }

  // Remaining tokens = payee
  const payeeParts: string[] = [];
  for (let i = 0; i < textTokens.length; i++) {
    if (!matchedTokenIndices.has(i)) {
      payeeParts.push(textTokens[i].raw);
    }
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

export function fuzzyMatchCategory(input: string, categories: CachedCategory[]): CachedCategory | null {
  const lower = input.toLowerCase();

  // Check Spanish/shorthand aliases first
  const aliases = CATEGORY_ALIASES[lower];
  if (aliases) {
    for (const alias of aliases) {
      for (const c of categories) {
        const name = stripEmoji(c.name).toLowerCase();
        if (name === alias) return c;
      }
    }
  }

  for (const c of categories) {
    const name = stripEmoji(c.name).toLowerCase();
    // Exact match (with or without emoji)
    if (name === lower || c.name.toLowerCase() === lower) return c;
  }

  if (lower.length >= 3) {
    for (const c of categories) {
      const name = stripEmoji(c.name).toLowerCase();
      if (name.startsWith(lower)) return c;
    }
  }

  if (lower.length >= 4) {
    for (const c of categories) {
      const name = stripEmoji(c.name).toLowerCase();
      if (name.includes(lower)) return c;
    }
  }

  return null;
}

function fuzzyMatchAsset(input: string, assets: CachedAsset[]): CachedAsset | null {
  const lower = input.toLowerCase();

  // Exact match
  for (const a of assets) {
    const name = stripEmoji(a.name).toLowerCase();
    const display = a.displayName ? stripEmoji(a.displayName).toLowerCase() : null;
    if (name === lower || display === lower || a.name.toLowerCase() === lower) return a;
  }

  // Abbreviation / short alias matching (e.g. "mp" → "Mercado Pago", "amex" → "Amex")
  if (lower.length >= 2) {
    for (const a of assets) {
      const name = stripEmoji(a.name).toLowerCase();
      // Initials: "mp" matches "mercado pago"
      const initials = name
        .split(/\s+/)
        .map((w) => w[0])
        .join("");
      if (initials === lower) return a;
    }
  }

  // Prefix match
  if (lower.length >= 3) {
    for (const a of assets) {
      const name = stripEmoji(a.name).toLowerCase();
      const display = a.displayName ? stripEmoji(a.displayName).toLowerCase() : null;
      if (name.startsWith(lower) || (display && display.startsWith(lower))) return a;
    }
  }

  return null;
}
