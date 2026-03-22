import { InlineKeyboard } from "grammy";
import type { TransactionRow, FxRateRow, TemplateRow } from "../storage/database.js";
import type { ProcessResult } from "../orchestrator.js";
import type { StatementTransaction } from "../pdf/index.js";
import type { CachedAsset } from "../types.js";

export function formatConfirmation(result: ProcessResult): string {
  const { transaction: tx, fxRate, categoryName, accountName, autoTags } = result;
  const isIncome = tx.amount < 0;
  const absAmount = Math.abs(tx.amount);

  // Multi-account split display
  if (result.accountLegs && result.accountLegs.length >= 2) {
    const sign = isIncome ? "+" : "";
    let line1 = `${tx.payee} — ${sign}$${absAmount.toFixed(2)} ${tx.currency}`;

    const legLines = result.accountLegs.map((leg) => {
      let line = `  ${leg.accountName}: $${Math.abs(leg.amount).toFixed(2)}`;
      if (leg.originalAmount != null && tx.originalCurrency) {
        line += ` (${tx.originalCurrency} ${formatNumber(Math.abs(leg.originalAmount))})`;
      }
      return line;
    });

    if (tx.originalAmount != null && tx.originalCurrency && fxRate) {
      const absOriginal = Math.abs(tx.originalAmount);
      line1 += `\n${tx.originalCurrency} ${formatNumber(absOriginal)} @ ${formatNumber(fxRate)}`;
    }

    const details: string[] = [];
    if (categoryName) details.push(`Category: ${categoryName}`);
    if (autoTags && autoTags.length > 0) details.push(`Tags: ${autoTags.map((t) => `#${t}`).join(" ")}`);
    if (tx.date) details.push(`Date: ${tx.date}`);

    return [line1, ...legLines, ...details].join("\n");
  }

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

  if (result.splitCount) details.push(`Split ${result.splitCount} ways`);

  if (details.length > 0) {
    return line1 + "\n" + details.join("\n");
  }
  return line1;
}

export function buildReceiptKeyboard(localRecordId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("Undo", `undo:${localRecordId}`)
    .text("Edit", `edit:${localRecordId}`);
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

export function formatSearchResults(rows: TransactionRow[], query: string, offset: number, total: number): string {
  if (total === 0) return `No results for "${query}".`;

  const lines = rows.map((r, i) => {
    let line = `${offset + i + 1}. ${capitalize(r.payee)} $${r.amount.toFixed(2)} ${r.currency}`;
    if (r.date) line += ` (${r.date})`;
    if (r.category_name) line += ` → ${r.category_name}`;
    return line;
  });

  const showing = `Showing ${offset + 1}-${offset + rows.length} of ${total}`;
  return [`Search: "${query}" — ${showing}`, ...lines].join("\n");
}

export function formatTemplateList(templates: TemplateRow[]): string {
  if (templates.length === 0) return "No templates saved. Use /template add <name> <expense text>";
  const lines = templates.map((t) => `  /${t.name} → ${t.text}`);
  return ["Templates (use /t <name> to apply):", ...lines].join("\n");
}

export function formatWeeklySummary(
  rows: TransactionRow[],
  weekStart: string,
  weekEnd: string,
  prevRows?: TransactionRow[]
): string {
  if (rows.length === 0) return `No expenses this week (${weekStart} – ${weekEnd}).`;

  let total = 0;
  const byCategory = new Map<string, number>();
  const byPayee = new Map<string, number>();

  for (const r of rows) {
    total += r.amount;
    const cat = r.category_name ?? "Uncategorized";
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + r.amount);
    byPayee.set(r.payee, (byPayee.get(r.payee) ?? 0) + r.amount);
  }

  const catLines = [...byCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cat, amt]) => `  ${cat}: $${amt.toFixed(2)}`);

  const topPayees = [...byPayee.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([p, amt]) => `  ${capitalize(p)}: $${amt.toFixed(2)}`);

  const lines = [
    `Week ${weekStart} – ${weekEnd}`,
    `${rows.length} transactions, $${total.toFixed(2)} USD total`,
    "",
    "By category:",
    ...catLines,
    "",
    "Top payees:",
    ...topPayees,
  ];

  if (prevRows && prevRows.length > 0) {
    const prevTotal = prevRows.reduce((s, r) => s + r.amount, 0);
    const diff = total - prevTotal;
    const pct = prevTotal > 0 ? ((diff / prevTotal) * 100).toFixed(0) : "—";
    const arrow = diff > 0 ? "↑" : diff < 0 ? "↓" : "→";
    lines.push("", `vs last week: $${prevTotal.toFixed(2)} (${arrow} ${pct}%)`);
  }

  return lines.join("\n");
}

export function formatFxRate(
  current: { compra: number; venta: number; fechaActualizacion: string },
  history: FxRateRow[]
): string {
  const lines = [
    `Blue Dollar`,
    `  Buy:  $${formatNumber(current.compra)}`,
    `  Sell: $${formatNumber(current.venta)}`,
    `  Updated: ${new Date(current.fechaActualizacion).toLocaleString("en-US", { timeZone: "America/Argentina/Buenos_Aires" })}`,
  ];

  if (history.length >= 2) {
    const latest = history[0].rate;
    const previous = history[1].rate;
    const diff = latest - previous;
    const arrow = diff > 0 ? "↑" : diff < 0 ? "↓" : "→";
    lines.push(`  Trend: ${arrow} ${diff > 0 ? "+" : ""}${formatNumber(diff)}`);
  }

  return lines.join("\n");
}

export function formatImportSummary(
  transactions: StatementTransaction[],
  usdPreview?: Array<{ usdAmount: number; rate: number }>,
): string {
  const dates = transactions.map((t) => t.date).sort();
  const dateRange = dates[0] === dates[dates.length - 1]
    ? dates[0]
    : `${dates[0]} — ${dates[dates.length - 1]}`;

  const arsTotal = transactions.reduce((s, t) => s + Math.abs(t.amount), 0);
  const currency = transactions[0]?.currency ?? "ARS";

  const lines = transactions.map((t, i) => {
    const usd = usdPreview?.[i];
    const arsStr = formatNumber(Math.abs(t.amount));
    if (usd) {
      return `  ${t.date.slice(5)} ${t.payee} — ${arsStr} ($${Math.abs(usd.usdAmount).toFixed(2)})`;
    }
    return `  ${t.date.slice(5)} ${t.payee} — ${arsStr}`;
  });

  const header = [`PDF Import: ${transactions.length} transactions`, `${dateRange} | ${currency} ${formatNumber(arsTotal)}`];

  if (usdPreview) {
    const usdTotal = usdPreview.reduce((s, u) => s + Math.abs(u.usdAmount), 0);
    header[1] += ` ($${usdTotal.toFixed(2)} USD)`;
  }

  return [...header, "", ...lines].join("\n");
}

export function formatImportResult(created: number, skipped: number, accountName: string): string {
  const parts = [`Imported ${created} transactions to ${accountName}.`];
  if (skipped > 0) parts.push(`${skipped} skipped.`);
  return parts.join(" ");
}

export function buildImportKeyboard(
  importKey: string,
  accounts: CachedAsset[],
  selectedAccountId?: number,
): InlineKeyboard {
  const kb = new InlineKeyboard();

  if (selectedAccountId != null) {
    const account = accounts.find((a) => a.id === selectedAccountId);
    kb.text(`Confirm → ${account?.name ?? "Account"}`, `imp_confirm:${importKey}`);
    kb.text("Cancel", `imp_cancel:${importKey}`);
    return kb;
  }

  // Account picker — 2 per row
  for (let i = 0; i < accounts.length; i++) {
    kb.text(accounts[i].name, `imp_acct:${importKey}:${accounts[i].id}`);
    if (i % 2 === 1) kb.row();
  }
  if (accounts.length % 2 === 1) kb.row();
  kb.text("Cancel", `imp_cancel:${importKey}`);
  return kb;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
