import { z } from "zod";
import { BlueplateError } from "../errors.js";
import { logger } from "../logger.js";

export interface StatementTransaction {
  date: string;    // YYYY-MM-DD
  payee: string;
  amount: number;  // positive = expense, negative = credit/payment
  currency?: string;
}

export interface StatementResult {
  transactions: StatementTransaction[];
  closeDate?: string; // YYYY-MM-DD — statement close/cutoff date
}

const transactionSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payee: z.string().min(1),
  amount: z.number(),
  currency: z.string().optional(),
});

const responseSchema = z.object({
  transactions: z.array(transactionSchema).min(1),
  close_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

const SYSTEM_PROMPT = `You extract transactions from Argentine bank/credit card statements.

Rules:
- Output JSON: { "close_date": "YYYY-MM-DD", "transactions": [{ "date": "YYYY-MM-DD", "payee": "...", "amount": ..., "currency": "ARS" }, ...] }
- close_date: the statement close date (fecha de cierre). Look for "Fecha de Cierre", "Cierre", or the end date of the billing period. null if not found.
- Dates: convert DD/MM/YYYY or DD/MM/YY to YYYY-MM-DD. Infer the year from context if not explicit.
- Payee: clean up names — remove trailing codes, IDs, asterisks. Keep the recognizable merchant name.
- Amount: positive = expense/charge, negative = credit/payment/refund.
- Argentine number format: 1.234,56 means one thousand two hundred thirty four point fifty six. Parse accordingly.
- Skip totals, subtotals, headers, minimum payments, interest rates, and summary lines.
- Skip lines that are clearly not individual transactions (e.g. "TOTAL", "SALDO ANTERIOR", "PAGO MINIMO").
- If a currency is stated (USD, ARS, etc.), include it. Default to ARS if not specified.
- Do NOT invent transactions. Only extract what is explicitly listed.`;

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
    transactions: validated.data.transactions,
    closeDate: validated.data.close_date ?? undefined,
  };
}
