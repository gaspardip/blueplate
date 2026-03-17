import type { BlueplateDatabase } from "./storage/database.js";

const MAX_DISTANCE = 2;

export class PayeeNormalizer {
  constructor(private db: BlueplateDatabase) {}

  normalize(raw: string): string {
    const cleaned = raw.trim().toLowerCase();

    // 1. Check explicit alias table
    const alias = this.db.getPayeeAlias(cleaned);
    if (alias) return alias;

    // 2. Fuzzy match against known payees (Levenshtein ≤ 2)
    const known = this.db.getDistinctPayees();
    let bestMatch: string | null = null;
    let bestDist = MAX_DISTANCE + 1;

    for (const payee of known) {
      const dist = levenshtein(cleaned, payee.toLowerCase());
      if (dist < bestDist) {
        bestDist = dist;
        bestMatch = payee;
      }
    }

    if (bestMatch && bestDist <= MAX_DISTANCE) {
      // Auto-learn: save the alias so future lookups are instant
      this.db.setPayeeAlias(cleaned, bestMatch);
      return bestMatch;
    }

    // 3. New payee — capitalize and store as canonical
    const canonical = capitalize(cleaned);
    this.db.setPayeeAlias(cleaned, canonical);
    return canonical;
  }

  setAlias(alias: string, canonical: string): void {
    this.db.setPayeeAlias(alias.toLowerCase(), canonical);
  }
}

function capitalize(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Quick reject: if length difference > MAX_DISTANCE, skip full computation
  if (Math.abs(a.length - b.length) > MAX_DISTANCE) return MAX_DISTANCE + 1;

  const m = a.length;
  const n = b.length;

  // Use single-row optimization
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,      // deletion
        curr[j - 1] + 1,  // insertion
        prev[j - 1] + cost // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}
