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

const DATE_KEYWORDS: Record<string, () => string> = {
  hoy: () => todayStr(),
  today: () => todayStr(),
  ayer: () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  },
  yesterday: () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  },
  anteayer: () => {
    const d = new Date();
    d.setDate(d.getDate() - 2);
    return d.toISOString().slice(0, 10);
  },
};

/** Resolve a date string: keywords (ayer, hoy), YYYY-MM-DD, or undefined for today */
export function resolveDate(input?: string): string {
  if (!input) return todayStr();
  const lower = input.toLowerCase();
  if (DATE_KEYWORDS[lower]) return DATE_KEYWORDS[lower]();
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  return todayStr();
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
