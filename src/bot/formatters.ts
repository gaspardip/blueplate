import type { TransactionRow } from "../storage/database.js";
import type { ProcessResult } from "../orchestrator.js";

export function formatConfirmation(result: ProcessResult): string {
  const { transaction: tx, fxRate, categoryName, accountName, autoTags } = result;
  const isIncome = tx.amount < 0;
  const absAmount = Math.abs(tx.amount);

  // Amount line
  const sign = isIncome ? "+" : "";
  let line1 = `${tx.payee} — ${sign}$${absAmount.toFixed(2)} ${tx.currency}`;
  if (tx.originalAmount != null && tx.originalCurrency && fxRate) {
    const absOriginal = Math.abs(tx.originalAmount);
    line1 += `\n${tx.originalCurrency} ${formatNumber(absOriginal)} @ ${formatNumber(fxRate)}`;
  }

  const details: string[] = [];
  if (categoryName) details.push(`Category: ${categoryName}`);
  if (accountName) details.push(`Account: ${accountName}`);
  if (autoTags && autoTags.length > 0) details.push(`Tags: ${autoTags.map((t) => `#${t}`).join(" ")}`);
  if (tx.date) details.push(`Date: ${tx.date}`);

  if (details.length > 0) {
    return line1 + "\n" + details.join("\n");
  }
  return line1;
}

export function formatUndone(payee: string, amount: number, currency: string): string {
  return `Undone: ${capitalize(payee)} $${amount.toFixed(2)} ${currency}`;
}

export function formatDaySummary(rows: TransactionRow[], date: string): string {
  if (rows.length === 0) {
    return `No transactions for ${date}.`;
  }

  let total = 0;
  const lines = rows.map((r) => {
    total += r.amount;
    let line = `  ${capitalize(r.payee)} $${r.amount.toFixed(2)} ${r.currency}`;
    if (r.original_amount != null && r.original_currency) {
      line += ` (${r.original_currency} ${formatNumber(r.original_amount)})`;
    }
    if (r.category_name) {
      line += ` → ${r.category_name}`;
    }
    return line;
  });

  return [`${date} (${rows.length} transactions, $${total.toFixed(2)} USD):`, ...lines].join(
    "\n"
  );
}

export function formatMonthSummary(rows: TransactionRow[], yearMonth: string): string {
  if (rows.length === 0) {
    return `No transactions for ${yearMonth}.`;
  }

  let total = 0;
  const byCategory = new Map<string, number>();

  for (const r of rows) {
    total += r.amount;
    const cat = r.category_name ?? "Uncategorized";
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + r.amount);
  }

  const catLines = [...byCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cat, amt]) => `  ${cat}: $${amt.toFixed(2)}`);

  return [
    `${yearMonth} — ${rows.length} transactions, $${total.toFixed(2)} USD total:`,
    ...catLines,
  ].join("\n");
}

export function formatCategories(categories: { id: number; name: string }[]): string {
  if (categories.length === 0) return "No categories found.";
  return "Categories:\n" + categories.map((c) => `  ${c.name}`).join("\n");
}

export function formatAssets(assets: { id: number; name: string; currency: string }[]): string {
  if (assets.length === 0) return "No accounts found.";
  return "Accounts:\n" + assets.map((a) => `  ${a.name} (${a.currency})`).join("\n");
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
