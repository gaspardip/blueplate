import { LunchMoneyError } from "../errors.js";
import { logger } from "../logger.js";
import type {
  LMAssetsResponse,
  LMCategoriesResponse,
  LMCreateResponse,
  LMCreateTransactionPayload,
  LMTagsResponse,
  LMTransactionsResponse,
  LMUpdateTransactionPayload,
} from "./types.js";

const LM_API_BASE = "https://dev.lunchmoney.app/v2";

export class LunchMoneyClient {
  constructor(private apiKey: string) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${LM_API_BASE}${path}`;
    logger.debug("LM API request", { method, path });

    const resp = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      logger.error("LM API error", { status: resp.status, path, body: text });

      if (resp.status === 401) {
        throw new LunchMoneyError("API key invalid. Check config.", 401);
      }
      throw new LunchMoneyError(
        `Lunch Money rejected: ${resp.status} ${text}`,
        resp.status
      );
    }

    return resp.json() as Promise<T>;
  }

  async createTransaction(payload: LMCreateTransactionPayload): Promise<number> {
    const data = await this.request<LMCreateResponse>("POST", "/transactions", {
      transactions: [payload],
      skip_duplicates: true,
    });

    if (!data.ids || data.ids.length === 0) {
      throw new LunchMoneyError("No transaction ID returned — possible duplicate");
    }

    return data.ids[0];
  }

  async updateTransaction(id: number, payload: LMUpdateTransactionPayload): Promise<void> {
    await this.request("PUT", `/transactions/${id}`, { transaction: payload });
  }

  async deleteTransaction(id: number): Promise<boolean> {
    try {
      await this.request("DELETE", `/transactions/${id}`);
      return true;
    } catch (error) {
      if (error instanceof LunchMoneyError && error.statusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  async getCategories(): Promise<LMCategoriesResponse> {
    return this.request<LMCategoriesResponse>("GET", "/categories");
  }

  async getAssets(): Promise<LMAssetsResponse> {
    return this.request<LMAssetsResponse>("GET", "/assets");
  }

  async getTags(): Promise<LMTagsResponse> {
    return this.request<LMTagsResponse>("GET", "/tags");
  }

  async getTransactions(startDate: string, endDate: string): Promise<LMTransactionsResponse> {
    return this.request<LMTransactionsResponse>(
      "GET",
      `/transactions?start_date=${startDate}&end_date=${endDate}`
    );
  }
}
