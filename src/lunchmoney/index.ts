import { logger } from "../logger.js";
import type { BlueplateDatabase } from "../storage/database.js";
import type { CachedAsset, CachedCategory, CachedTag } from "../types.js";
import { LunchMoneyClient } from "./client.js";
import type { LMCategory } from "./types.js";

export class LunchMoneyService {
  private client: LunchMoneyClient;

  constructor(
    apiKey: string,
    private db: BlueplateDatabase,
    private metadataCacheTtlMs: number
  ) {
    this.client = new LunchMoneyClient(apiKey);
  }

  get rawClient(): LunchMoneyClient {
    return this.client;
  }

  async getCategories(forceRefresh = false): Promise<CachedCategory[]> {
    if (!forceRefresh) {
      const fetchedAt = this.db.getCategoriesFetchedAt();
      if (fetchedAt && Date.now() - new Date(fetchedAt).getTime() < this.metadataCacheTtlMs) {
        const rows = this.db.getCategories();
        if (rows.length > 0) {
          return rows.map((r) => ({
            id: r.id,
            name: r.name,
            isIncome: r.is_income === 1,
            archived: r.archived === 1,
          }));
        }
      }
    }

    logger.info("Refreshing LM categories");
    const resp = await this.client.getCategories();

    // v2 returns nested categories by default — flatten them
    const flat = flattenCategories(resp.categories);

    const categories = flat.map((c) => ({
      id: c.id,
      name: c.name,
      isIncome: c.is_income,
      archived: c.archived,
    }));
    this.db.upsertCategories(categories);
    return categories.filter((c) => !c.archived);
  }

  async getAccounts(forceRefresh = false): Promise<CachedAsset[]> {
    if (!forceRefresh) {
      const fetchedAt = this.db.getAssetsFetchedAt();
      if (fetchedAt && Date.now() - new Date(fetchedAt).getTime() < this.metadataCacheTtlMs) {
        const rows = this.db.getAssets();
        if (rows.length > 0) {
          return rows.map((r) => ({
            id: r.id,
            name: r.name,
            displayName: r.display_name ?? undefined,
            currency: r.currency,
          }));
        }
      }
    }

    logger.info("Refreshing LM accounts");
    // v2: /assets → /manual_accounts
    const resp = await this.client.getManualAccounts();
    const accounts = resp.manual_accounts.map((a) => ({
      id: a.id,
      name: a.name,
      displayName: a.display_name ?? undefined,
      currency: a.currency,
    }));
    this.db.upsertAssets(accounts);
    return accounts;
  }

  async getTags(forceRefresh = false): Promise<CachedTag[]> {
    if (!forceRefresh) {
      const rows = this.db.getTags();
      if (rows.length > 0) {
        return rows.map((r) => ({ id: r.id, name: r.name }));
      }
    }

    logger.info("Refreshing LM tags");
    const resp = await this.client.getTags();
    const tags = resp.tags.map((t) => ({ id: t.id, name: t.name }));
    this.db.upsertTags(tags);
    return tags;
  }
}

function flattenCategories(categories: LMCategory[]): LMCategory[] {
  const result: LMCategory[] = [];
  for (const cat of categories) {
    // Add the category itself (skip groups — they're containers, not assignable)
    if (!cat.is_group) {
      result.push(cat);
    }
    // Add children
    if (cat.children && cat.children.length > 0) {
      result.push(...cat.children);
    }
  }
  return result;
}

export { LunchMoneyClient } from "./client.js";
