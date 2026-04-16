import { z } from "zod";
import { BlueplateError } from "../errors.js";
import { logger } from "../logger.js";
import { todayStr } from "../utils.js";
import type { StatementResult } from "../pdf/structure.js";

const transactionSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payee: z.string().min(1),
  amount: z.number(),
  currency: z.string().optional(),
  category_hint: z.string().optional().nullable(),
});

const responseSchema = z.object({
  transactions: z.array(transactionSchema).min(1),
});

function systemPrompt(today: string): string {
  return `You extract transactions from screenshots of receipts, order histories, or payment app screens.

Output JSON: { "transactions": [{ "date": "YYYY-MM-DD", "payee": "...", "amount": ..., "currency": "ARS" | "USD", "category_hint": "..." }, ...] }

Rules:
- Today is ${today}. If a date is shown without a year, assume the current year. If that would place the date in the future (after today), roll it back by one year.
- Argentine date/number conventions:
  - Months in Spanish (ene, feb, mar, abr, may, jun, jul, ago, sep/set, oct, nov, dic). Strip weekday prefixes (lun, mar, mié, jue, vie, sáb, dom).
  - Numbers use "." as thousands separator and "," as decimal: "1.234,56" = 1234.56.
- Payee:
  - Strip branch/location suffixes only when they're clearly noise. Keep neighborhood/store qualifiers that disambiguate (e.g. "PedidosYa Market - Ituzaingo" → keep "PedidosYa Market Ituzaingo"; "McDonald's Palermo" → keep "McDonald's Palermo").
  - Title case, not ALL CAPS.
  - For PLATFORM*MERCHANT patterns (MERPAGO*BIDCOM, RAPPI*BURGER KING), use the merchant.
- Amount:
  - Positive = expense, negative = credit/refund.
  - Default currency: ARS unless clearly marked USD / U$D / US$ / $USD.
- category_hint (optional, free-form, 1-2 words):
  - Suggest a category based on the merchant. The downstream system will fuzzy-match this against the user's configured categories.
  - Examples: "food delivery" for delivery apps, "groceries" for supermarkets/markets, "restaurants" for sit-down food, "coffee shops", "rideshare", "gas", "subscriptions", "shopping".
  - Omit if unsure — do not invent.
- Only include rows that look like actual transactions (have merchant + amount).
- Skip pending/cancelled/refunded items unless they have a clear final amount. Include delivered/completed orders.
- Do NOT invent transactions. Do NOT skip real ones.`;
}

export async function structureImage(
  imageBuffer: ArrayBuffer,
  apiKey: string,
  options?: { mimeType?: string; today?: string; model?: string },
): Promise<StatementResult> {
  const mimeType = options?.mimeType ?? "image/jpeg";
  const today = options?.today ?? todayStr();
  const model = options?.model ?? "gpt-4o";
  const base64 = Buffer.from(imageBuffer).toString("base64");
  const dataUrl = `data:${mimeType};base64,${base64}`;

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt(today) },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract transactions from this image." },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    logger.error("OpenAI vision failed", { status: resp.status, body });
    throw new BlueplateError(
      "Failed to process image. Try again.",
      "IMAGE_STRUCTURE_ERROR",
      resp.status >= 500,
    );
  }

  const data = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new BlueplateError("Failed to process image. Try again.", "IMAGE_STRUCTURE_ERROR");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    logger.error("OpenAI vision returned invalid JSON", { content });
    throw new BlueplateError("Failed to process image. Try again.", "IMAGE_STRUCTURE_ERROR");
  }

  const validated = responseSchema.safeParse(parsed);
  if (!validated.success) {
    logger.error("Vision response failed validation", {
      errors: validated.error.issues,
      content,
    });
    throw new BlueplateError("No transactions found in this image.", "IMAGE_STRUCTURE_ERROR");
  }

  logger.info("Image structured", { transactionCount: validated.data.transactions.length });
  return {
    transactions: validated.data.transactions.map((t) => ({
      date: t.date,
      payee: t.payee,
      amount: t.amount,
      currency: t.currency,
      categoryHint: t.category_hint ?? undefined,
    })),
  };
}
