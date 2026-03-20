import type { Token } from "./types.js";

const CURRENCY_MAP: Record<string, string> = {
  ars: "ARS",
  pesos: "ARS",
  peso: "ARS",
  usd: "USD",
  dolares: "USD",
  dólares: "USD",
  dolar: "USD",
  dólar: "USD",
  dollars: "USD",
  eur: "EUR",
  euros: "EUR",
  euro: "EUR",
  brl: "BRL",
  reales: "BRL",
  reais: "BRL",
  gbp: "GBP",
  clp: "CLP",
  uyu: "UYU",
};

const DATE_KEYWORDS: Record<string, () => string> = {
  hoy: () => today(),
  today: () => today(),
  ayer: () => yesterday(),
  yesterday: () => yesterday(),
  anteayer: () => daysAgo(2),
};

function today(): string {
  return formatDate(new Date());
}

function yesterday(): string {
  return daysAgo(1);
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return formatDate(d);
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  const words = input.trim().split(/\s+/);
  let position = 0;

  for (const word of words) {
    const lower = word.toLowerCase();

    // Tag: #something
    if (lower.startsWith("#") && lower.length > 1) {
      tokens.push({ type: "tag", value: lower.slice(1), raw: word, position });
      position++;
      continue;
    }

    // Note: note:...
    if (lower.startsWith("note:") && word.length > 5) {
      tokens.push({ type: "note", value: word.slice(5), raw: word, position });
      position++;
      continue;
    }

    // Date: date:YYYY-MM-DD or date:yesterday
    if (lower.startsWith("date:") && word.length > 5) {
      const dateVal = word.slice(5);
      const dateLower = dateVal.toLowerCase();
      if (DATE_KEYWORDS[dateLower]) {
        tokens.push({ type: "date", value: DATE_KEYWORDS[dateLower](), raw: word, position });
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
        tokens.push({ type: "date", value: dateVal, raw: word, position });
      } else {
        tokens.push({ type: "text", value: word, raw: word, position });
      }
      position++;
      continue;
    }

    // Date keywords
    if (DATE_KEYWORDS[lower]) {
      tokens.push({ type: "date", value: DATE_KEYWORDS[lower](), raw: word, position });
      position++;
      continue;
    }

    // Split marker
    if (lower === "split") {
      tokens.push({ type: "split", value: word, raw: word, position });
      position++;
      continue;
    }

    // Amount: optional -/$ prefix, digits with commas/dots, k/m suffix
    // Match: 1500, 1.500, 14,500, $1500, 12.50, 500k, 1.5m, $2M, -7500, -500k
    const amountMatch = word.match(/^-?\$?([\d]+(?:[.,]\d{3})*(?:[.,]\d{1,2})?[kmKM]?)$|^-?\$?([\d]+(?:[.,]\d+)?[kmKM]?)$/);
    if (amountMatch) {
      const isNegative = word.startsWith("-");
      const raw = (amountMatch[1] || amountMatch[2] || "").replace(/\$/g, "");
      const parsed = parseAmount(raw);
      if (parsed !== null) {
        const value = isNegative ? -parsed : parsed;
        tokens.push({ type: "amount", value: String(value), raw: word, position });
        position++;
        continue;
      }
    }

    // Currency
    if (CURRENCY_MAP[lower]) {
      tokens.push({ type: "currency", value: CURRENCY_MAP[lower], raw: word, position });
      position++;
      continue;
    }

    // Default: text (potential payee or category)
    tokens.push({ type: "text", value: word, raw: word, position });
    position++;
  }

  return tokens;
}

function parseAmount(raw: string): number | null {
  if (!raw) return null;

  // Extract and apply k/m suffix multiplier
  let multiplier = 1;
  let numStr = raw;
  const lastChar = raw.slice(-1).toLowerCase();
  if (lastChar === "k") {
    multiplier = 1_000;
    numStr = raw.slice(0, -1);
  } else if (lastChar === "m") {
    multiplier = 1_000_000;
    numStr = raw.slice(0, -1);
  }

  if (!numStr) return null;

  // Determine if comma or dot is the decimal separator
  // "1.500" → 1500 (thousand separator), "1.50" → 1.50 (decimal)
  // "1,500" → 1500 (thousand separator), "1,50" → 1.50 (decimal)
  const dotParts = numStr.split(".");
  const commaParts = numStr.split(",");

  let normalized: string;

  if (dotParts.length === 2 && commaParts.length === 1) {
    // Only dots: if multiplier is set, always treat as decimal (1.5k = 1500)
    if (multiplier > 1 || dotParts[1].length <= 2) {
      normalized = numStr; // decimal point
    } else {
      normalized = numStr.replace(/\./g, ""); // thousand separator
    }
  } else if (commaParts.length === 2 && dotParts.length === 1) {
    if (multiplier > 1 || commaParts[1].length <= 2) {
      normalized = numStr.replace(",", "."); // decimal comma
    } else {
      normalized = numStr.replace(/,/g, ""); // thousand separator
    }
  } else if (dotParts.length > 2) {
    normalized = numStr.replace(/\./g, "");
  } else if (commaParts.length > 2) {
    normalized = numStr.replace(/,/g, "");
  } else if (dotParts.length === 2 && commaParts.length === 2) {
    const dotPos = numStr.lastIndexOf(".");
    const commaPos = numStr.lastIndexOf(",");
    if (dotPos > commaPos) {
      normalized = numStr.replace(/,/g, "");
    } else {
      normalized = numStr.replace(/\./g, "").replace(",", ".");
    }
  } else {
    normalized = numStr;
  }

  const num = Number(normalized) * multiplier;
  return isNaN(num) || num <= 0 ? null : num;
}

export { CURRENCY_MAP };
