export function stripEmoji(s: string): string {
  return s
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D]/gu, "")
    .trim();
}

export function todayStr(): string {
  return localDateStr(new Date());
}

/** Format a Date as YYYY-MM-DD in the local timezone (not UTC). */
export function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function yearMonthStr(): string {
  return todayStr().slice(0, 7);
}

const DATE_KEYWORDS: Record<string, () => string> = {
  hoy: () => todayStr(),
  today: () => todayStr(),
  ayer: () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return localDateStr(d);
  },
  yesterday: () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return localDateStr(d);
  },
  anteayer: () => {
    const d = new Date();
    d.setDate(d.getDate() - 2);
    return localDateStr(d);
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
    weekStart: localDateStr(monday),
    weekEnd: localDateStr(now),
  };
}
