import type { CachedTag } from "./types.js";
import { stripEmoji } from "./utils.js";

// Category name (emoji-stripped, lowercased) → tag names to auto-apply
const CATEGORY_TAG_RULES: Record<string, string[]> = {
  "streaming services": ["recurring"],
  "rent, mortgage": ["recurring"],
  "phone": ["recurring"],
  "internet": ["recurring"],
  "electricity": ["recurring"],
  "water": ["recurring"],
  "hoa fees": ["recurring"],
  "home insurance": ["recurring"],
  "auto insurance": ["recurring"],
  "pet insurance": ["recurring"],
  "food delivery": ["delivery"],
  "restaurants": ["eating-out"],
  "coffee shops": ["eating-out"],
  "alcohol, bars": ["eating-out"],
  "rideshare, taxi": ["transit"],
  "public transit": ["transit"],
  "gas": ["transit"],
  "tools": ["recurring"],
};

export function inferTagNames(categoryName?: string): string[] {
  if (!categoryName) return [];
  const key = stripEmoji(categoryName).toLowerCase();
  return CATEGORY_TAG_RULES[key] ?? [];
}

export function resolveTagIds(tagNames: string[], cachedTags: CachedTag[]): number[] {
  const ids: number[] = [];
  for (const name of tagNames) {
    const tag = cachedTags.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (tag) ids.push(tag.id);
  }
  return ids;
}
