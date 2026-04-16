import { z } from "zod";
import { BlueplateError } from "../errors.js";
import { logger } from "../logger.js";

export interface StatementTransaction {
  date: string;    // YYYY-MM-DD
  payee: string;
  amount: number;  // positive = expense, negative = credit/payment
  currency?: string;
  categoryHint?: string; // optional free-form category suggestion (fuzzy-matched downstream)
}

export interface StatementResult {
  transactions: StatementTransaction[];
  closeDate?: string; // YYYY-MM-DD — statement close/cutoff date
}

export const statementTransactionSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payee: z.string().min(1),
  amount: z.number(),
  currency: z.string().optional(),
  category_hint: z.string().optional().nullable(),
});

export function toStatementTransaction(
  t: z.infer<typeof statementTransactionSchema>,
): StatementTransaction {
  return {
    date: t.date,
    payee: t.payee,
    amount: t.amount,
    currency: t.currency,
    categoryHint: t.category_hint ?? undefined,
  };
}

const responseSchema = z.object({
  transactions: z.array(statementTransactionSchema).min(1),
  close_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

const SYSTEM_PROMPT = `You extract transactions from Argentine bank/credit card statements.

Rules:
- Output JSON: { "close_date": "YYYY-MM-DD", "transactions": [{ "date": "YYYY-MM-DD", "payee": "...", "amount": ..., "currency": "ARS" }, ...] }
- close_date: the statement close date (fecha de cierre). Look for "Fecha de Cierre", "Cierre", or the end date of the billing period. null if not found.
- Dates: Argentine CC statements group transactions by month. The year and month (e.g. "Enero 2025", "26 Enero") appear ONLY on the first line of each group. Subsequent lines in that group only show the day number. You MUST carry forward the year and month to all lines in the group until a new month/year header appears.
  - Convert to YYYY-MM-DD format.
  - Look for the billing period dates (e.g. "Periodo: 01/01/2025 al 31/01/2025") to determine the correct year if not explicit in transaction rows.
  - Do NOT default to 2023 or any arbitrary year — use the year from the statement header/period.
- Payee: clean up and normalize names into human-readable form:
  - For "PLATFORM*MERCHANT" patterns: use the MERCHANT as the payee, not the platform.
    MERPAGO*BIDCOM → "Bidcom", RAPPI*BURGER KING → "Burger King", PEDIDOSYA*MCDONALDS → "McDonald's"
    Exception: if no merchant after * (e.g. MERPAGO*TRANSFER), use the platform name: "Mercado Pago"
  - Strip installment codes like C.08/12, C.01/03, cuota references
  - Remove trailing codes, IDs, asterisks, branch numbers (e.g. "SUC.42", "STORE 1042")
  - Use proper capitalization (title case), not ALL CAPS
  - Strip company suffixes like SA, SRL, SAS unless they're the recognizable name
  - Examples: "MERPAGO*BIDCOM C.08/12" → "Bidcom", "TELECENTRO SA" → "Telecentro", "YPF ESTACION AV.CABILDO" → "YPF"
- Amount: positive = expense/charge, negative = credit/payment/refund.
- Argentine number format: 1.234,56 means one thousand two hundred thirty four point fifty six. Parse accordingly.
- Skip totals, subtotals, headers, minimum payments, interest rates, and summary lines.
- Skip lines that are clearly not individual transactions (e.g. "TOTAL", "SALDO ANTERIOR", "PAGO MINIMO").
- Currency detection:
  - If a charge appears in a USD or international section of the statement, set currency to "USD"
  - If the amount uses US format (e.g. 7.99, 149.99 — no thousands separator, dot decimal) and the statement indicates it's a foreign/international charge, set currency to "USD"
  - Default to "ARS" for regular charges in Argentine format (e.g. 22.091,42)
- Do NOT invent transactions. Only extract what is explicitly listed.
- Do NOT skip real transactions. If a line has a date, description, and amount, it is a transaction. Extract ALL of them.
- The statement may have two amount columns: $ (ARS) and U$D (USD). A transaction has an amount in one column or the other, not both. Check which column the amount is in to determine the currency.`;

export async function structureStatement(
  text: string,
  apiKey: string,
  hint?: { currency?: string },
): Promise<StatementResult> {
  const userMessage = hint?.currency
    ? `Default currency: ${hint.currency}\n\n${text}`
    : text;

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    logger.error("OpenAI structuring failed", { status: resp.status, body });
    throw new BlueplateError(
      "Failed to process PDF. Try again.",
      "PDF_STRUCTURE_ERROR",
      resp.status >= 500,
    );
  }

  const data = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new BlueplateError("Failed to process PDF. Try again.", "PDF_STRUCTURE_ERROR");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    logger.error("OpenAI returned invalid JSON", { content });
    throw new BlueplateError("Failed to process PDF. Try again.", "PDF_STRUCTURE_ERROR");
  }

  const validated = responseSchema.safeParse(parsed);
  if (!validated.success) {
    logger.error("OpenAI response failed validation", {
      errors: validated.error.issues,
      content,
    });
    throw new BlueplateError("No transactions found in this PDF.", "PDF_STRUCTURE_ERROR");
  }

  logger.info("PDF structured", {
    transactionCount: validated.data.transactions.length,
    closeDate: validated.data.close_date ?? null,
  });
  return {
    transactions: validated.data.transactions.map(toStatementTransaction),
    closeDate: validated.data.close_date ?? undefined,
  };
}
