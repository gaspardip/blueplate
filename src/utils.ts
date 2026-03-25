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

export function weekRangeStr(): { weekStart: string; weekEnd: string } {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - diffToMonday);
  return {
    weekStart: monday.toISOString().slice(0, 10),
    weekEnd: now.toISOString().slice(0, 10),
  };
}
