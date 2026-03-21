import type { ResolutionContext, CachedCategory, CachedAsset } from "../types.js";
import type { Token, ParsedExpense, ParseOutcome, AccountSplit } from "./types.js";

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
  "desayuno": ["coffee shops"],
  "merienda": ["coffee shops"],
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
  "compras": ["groceries"],
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
  "auto": ["car maintenance"],
  "lavado": ["car maintenance"],
  "mecanico": ["car maintenance"],
  "mecánico": ["car maintenance"],
  "taller": ["car maintenance"],
  "estacionamiento": ["car maintenance"],
  "parking": ["car maintenance"],
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
  // Loans & Transfers → Payment, Transfer
  "prestamo": ["payment, transfer"],
  "préstamo": ["payment, transfer"],
  "deuda": ["payment, transfer"],
  "preste": ["payment, transfer"],
};

export function buildExpense(tokens: Token[], ctx: ResolutionContext): ParseOutcome {
  const splitTokens = tokens.filter((t) => t.type === "split");
  let amounts = tokens.filter((t) => t.type === "amount");
  const currencies = tokens.filter((t) => t.type === "currency");
  const dates = tokens.filter((t) => t.type === "date");
  const tags = tokens.filter((t) => t.type === "tag");
  const notes = tokens.filter((t) => t.type === "note");
  const textTokens = tokens.filter((t) => t.type === "text");

  // Handle "split N": extract split count from amount tokens adjacent to split token
  let splitCount: number | undefined;
  if (splitTokens.length > 0) {
    const splitPos = splitTokens[0].position;
    const splitAmountIdx = amounts.findIndex((a) => a.position === splitPos + 1);
    if (splitAmountIdx !== -1) {
      const n = Number(amounts[splitAmountIdx].value);
      if (n >= 2 && n <= 20 && Number.isInteger(n)) {
        splitCount = n;
        amounts = amounts.filter((_, i) => i !== splitAmountIdx);
      }
    }
  }

  // Validate: must have at least one amount
  if (amounts.length === 0) {
    return { ok: false, error: "invalid", message: "No amount found. Try: pizza 1500" };
  }

  // Multiple amounts: try account-split detection before erroring
  if (amounts.length > 1) {
    if (splitCount != null) {
      return { ok: false, error: "ambiguous", message: "Can't combine people-split with multi-account split." };
    }

    const splitResult = detectAccountSplits(amounts, textTokens, ctx);
    if (!splitResult) {
      return {
        ok: false,
        error: "ambiguous",
        message: `Multiple amounts found: ${amounts.map((a) => a.raw).join(", ")}. Send one expense per message.`,
      };
    }

    // Build expense from split result
    const totalAmount = splitResult.total ?? splitResult.legs.reduce((s, l) => s + l.amount, 0);
    const currency = currencies.length > 0 ? currencies[0].value : undefined;
    const date = dates.length > 0 ? dates[0].value : undefined;

    // Match category from remaining text tokens (excluding used ones)
    const remainingTextTokens = textTokens.filter((_, i) => !splitResult.usedTextIndices.has(i));
    const { categoryHint, matchedIndices: catMatchedIndices } = matchCategory(remainingTextTokens, ctx.categories, new Set());

    const payee = extractPayee(remainingTextTokens, catMatchedIndices);
    if (!payee) {
      return { ok: false, error: "invalid", message: "No payee found. Try: café 1500" };
    }

    return {
      ok: true,
      expense: {
        amount: totalAmount,
        currency,
        payee,
        categoryHint,
        tags: tags.map((t) => t.value),
        note: notes.map((n) => n.value).join(" ") || undefined,
        date,
        accountSplits: splitResult.legs,
      },
    };
  }

  const amount = Number(amounts[0].value);
  const currency = currencies.length > 0 ? currencies[0].value : undefined;
  const date = dates.length > 0 ? dates[0].value : undefined;

  // Match categories and accounts from the END of text tokens.
  // Convention: <payee words...> <category> <account>
  // Must leave at least 1 token for payee.
  let { categoryHint, matchedIndices: matchedTokenIndices } = matchCategory(textTokens, ctx.categories, new Set());

  // Scan from end for account matches
  let assetHint: string | undefined;
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

  const payee = extractPayee(textTokens, matchedTokenIndices);
  if (!payee) {
    return { ok: false, error: "invalid", message: "No payee found. Try: café 1500" };
  }

  // If no category was matched via the standard scan, check if the payee itself
  // is a category alias (e.g., "estacionamiento 14000" → payee is the only text token)
  if (!categoryHint) {
    const payeeCategory = fuzzyMatchCategory(payee, ctx.categories);
    if (payeeCategory) {
      categoryHint = payeeCategory.name;
    }
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
    splitCount,
  };

  return { ok: true, expense };
}

function matchCategory(
  textTokens: Token[],
  categories: CachedCategory[],
  preMatched: Set<number>
): { categoryHint: string | undefined; matchedIndices: Set<number> } {
  const matchedIndices = new Set(preMatched);
  let categoryHint: string | undefined;

  outer:
  for (let end = textTokens.length - 1; end >= 1 && !categoryHint; end--) {
    for (let start = 1; start <= end; start++) {
      const phrase = textTokens.slice(start, end + 1).map((t) => t.value).join(" ");
      const catMatch = fuzzyMatchCategory(phrase, categories);
      if (catMatch) {
        const wouldMatch = new Set(matchedIndices);
        for (let k = start; k <= end; k++) wouldMatch.add(k);
        const remaining = textTokens.filter((_, idx) => !wouldMatch.has(idx));
        if (remaining.length >= 1) {
          categoryHint = catMatch.name;
          for (let k = start; k <= end; k++) matchedIndices.add(k);
          break outer;
        }
      }
    }
  }

  return { categoryHint, matchedIndices };
}

function extractPayee(textTokens: Token[], matchedIndices: Set<number>): string {
  const parts: string[] = [];
  for (let i = 0; i < textTokens.length; i++) {
    if (!matchedIndices.has(i)) {
      parts.push(textTokens[i].raw);
    }
  }
  return parts.join(" ");
}

interface SplitDetectionResult {
  legs: AccountSplit[];
  total?: number;
  usedTextIndices: Set<number>;
}

function detectAccountSplits(
  amounts: Token[],
  textTokens: Token[],
  ctx: ResolutionContext
): SplitDetectionResult | null {
  const legs: AccountSplit[] = [];
  const usedTextIndices = new Set<number>();
  const pairedAmounts = new Set<number>(); // indices into amounts[]

  // Pass 1: pair amounts with immediately preceding text token (compound "mp:5k" pattern)
  // This is highest priority — the text was glued to the amount.
  for (let ai = 0; ai < amounts.length; ai++) {
    const amtPos = amounts[ai].position;
    const prevTextIdx = textTokens.findIndex((t) => t.position === amtPos - 1);
    if (prevTextIdx !== -1 && !usedTextIndices.has(prevTextIdx)) {
      const asset = fuzzyMatchAsset(textTokens[prevTextIdx].value, ctx.assets);
      if (asset) {
        legs.push({ assetHint: asset.name, amount: Math.abs(Number(amounts[ai].value)) });
        usedTextIndices.add(prevTextIdx);
        pairedAmounts.add(ai);
      }
    }
  }

  // Pass 2: pair remaining amounts with following text tokens (voice "5000 mercado pago" pattern)
  for (let ai = 0; ai < amounts.length; ai++) {
    if (pairedAmounts.has(ai)) continue;
    const amtPos = amounts[ai].position;

    // Try two-token phrase first (e.g., "mercado pago"), then single token
    for (let len = 2; len >= 1; len--) {
      const nextIndices: number[] = [];
      for (let k = 0; k < len; k++) {
        const idx = textTokens.findIndex((t) => t.position === amtPos + 1 + k);
        if (idx !== -1 && !usedTextIndices.has(idx)) {
          nextIndices.push(idx);
        }
      }
      if (nextIndices.length === len) {
        const phrase = nextIndices.map((i) => textTokens[i].value).join(" ");
        const asset = fuzzyMatchAsset(phrase, ctx.assets);
        if (asset) {
          legs.push({ assetHint: asset.name, amount: Math.abs(Number(amounts[ai].value)) });
          for (const i of nextIndices) usedTextIndices.add(i);
          pairedAmounts.add(ai);
          break;
        }
      }
    }
  }

  // Unpaired amounts → candidate for total (max 1 allowed)
  let total: number | undefined;
  let unpairedCount = 0;
  for (let ai = 0; ai < amounts.length; ai++) {
    if (!pairedAmounts.has(ai)) {
      unpairedCount++;
      if (unpairedCount > 1) return null;
      total = Math.abs(Number(amounts[ai].value));
    }
  }

  // Need at least 2 legs
  if (legs.length < 2) return null;

  // Validate total if given
  if (total != null) {
    const legSum = legs.reduce((s, l) => s + l.amount, 0);
    if (Math.abs(legSum - total) > 0.01) return null;
  }

  return { legs, total, usedTextIndices };
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

export function fuzzyMatchAsset(input: string, assets: CachedAsset[]): CachedAsset | null {
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
