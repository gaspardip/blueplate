import { logger } from "./logger.js";

export async function transcribe(buffer: ArrayBuffer, apiKey: string): Promise<string> {
  const blob = new Blob([buffer], { type: "audio/ogg" });
  const form = new FormData();
  form.append("file", blob, "voice.ogg");
  form.append("model", "gpt-4o-mini-transcribe");
  form.append("prompt", "Expense in Argentine Spanish. Examples: starbucks ocho mil, uber doce cincuenta dólares, pizza quince mil pesos visa");

  const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    logger.error("Transcription API error", { status: resp.status, body: text });
    throw new Error(`Transcription API failed: ${resp.status}`);
  }

  const data = (await resp.json()) as { text: string };
  return data.text.trim();
}
