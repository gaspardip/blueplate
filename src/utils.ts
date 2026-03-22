export function stripEmoji(s: string): string {
  return s
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D]/gu, "")
    .trim();
}

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function yearMonthStr(): string {
  return new Date().toISOString().slice(0, 7);
}
