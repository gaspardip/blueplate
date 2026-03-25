import { BlueplateError } from "../errors.js";
import { logger } from "../logger.js";
import { todayStr, yearMonthStr } from "../utils.js";
import type { TransactionRow } from "../storage/database.js";

const QUESTION_WORDS = /^(what|how|which|when|where|who|why|did i|do i|have i|am i|cuánto|cuanto|cuál|cual|qué es|qué fue|que es|que fue|cómo|como|dónde|donde|cuándo|cuando|quién|quien|en qué|en que)\s/i;

export function isQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.endsWith("?")) return true;
  return QUESTION_WORDS.test(trimmed);
}

const SYSTEM_PROMPT = `You are a concise expense analyst for a personal finance Telegram bot. The user tracks expenses in Lunch Money. You will be given their transaction data and a question.

Rules:
- Answer in the same language the question was asked in (Spanish or English).
- Be concise — this is a Telegram chat. 2-5 lines max.
- Use dollar amounts with 2 decimal places.
- When listing items, use a simple numbered or bulleted format.
- If the data doesn't contain enough information to answer, say so briefly.
- All amounts are in USD (converted from ARS at the blue dollar rate).
- Do not make up data. Only reference transactions provided.`;

export function formatTransactionsForLLM(rows: TransactionRow[]): string {
  if (rows.length === 0) return "(no transactions)";
  const header = "date,payee,amount_usd,category,account";
  const lines = rows.map((r) =>
    `${r.date},${r.payee},${r.amount.toFixed(2)},${r.category_name ?? ""},${r.asset_name ?? ""}`,
  );
  return [header, ...lines].join("\n");
}

export async function askQuestion(
  question: string,
  transactions: TransactionRow[],
  apiKey: string,
): Promise<string> {
  const context = formatTransactionsForLLM(transactions);
  const today = todayStr();
  const month = yearMonthStr();

  const userMessage = `Today is ${today}. Current month: ${month}.\n\nTransactions:\n${context}\n\nQuestion: ${question}`;

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.3,
      max_tokens: 300,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    logger.error("Question API error", { status: resp.status, body });
    throw new BlueplateError("Couldn't answer that. Try again.", "QUESTION_ERROR", resp.status >= 500);
  }

  const data = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const answer = data.choices?.[0]?.message?.content?.trim();
  if (!answer) {
    throw new BlueplateError("Couldn't answer that. Try again.", "QUESTION_ERROR");
  }

  return answer;
}
