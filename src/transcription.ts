import { BlueplateError } from "./errors.js";
import { logger } from "./logger.js";

export async function transcribe(buffer: ArrayBuffer, apiKey: string): Promise<string> {
  const blob = new Blob([buffer], { type: "audio/ogg" });
  const form = new FormData();
  form.append("file", blob, "voice.ogg");
  form.append("model", "gpt-4o-mini-transcribe");
  form.append("prompt", "Output numbers as digits, not words. Examples: starbucks 8000, uber 12.50 dólares, pizza 15000 pesos visa, paula 12000 desayuno");

  const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    logger.error("Transcription API error", { status: resp.status, body: text });
    throw new BlueplateError(`Transcription failed: ${resp.status}`, "TRANSCRIPTION_ERROR", true);
  }

  const data = (await resp.json()) as { text?: string };
  if (!data.text) {
    throw new BlueplateError("Transcription returned empty result", "TRANSCRIPTION_ERROR", false);
  }

  return data.text.trim();
}
