import { logger } from "./logger.js";

export async function transcribe(buffer: ArrayBuffer, apiKey: string): Promise<string> {
  const blob = new Blob([buffer], { type: "audio/ogg" });
  const form = new FormData();
  form.append("file", blob, "voice.ogg");
  form.append("model", "whisper-1");
  form.append("language", "es");

  const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    logger.error("Whisper API error", { status: resp.status, body: text });
    throw new Error(`Whisper API failed: ${resp.status}`);
  }

  const data = (await resp.json()) as { text: string };
  return data.text.trim();
}
