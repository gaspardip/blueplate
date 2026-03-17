import { LunchMoneyError } from "../errors.js";
import { logger } from "../logger.js";
import type {
  LMManualAccountsResponse,
  LMCategoriesResponse,
  LMCreateResponse,
  LMCreateTransactionPayload,
  LMTagsResponse,
  LMTransactionsResponse,
  LMUpdateTransactionPayload,
} from "./types.js";

// v2 API — see https://alpha.lunchmoney.dev/v2/migration-guide
const LM_API_BASE = "https://api.lunchmoney.dev/v2";

export class LunchMoneyClient {
  constructor(private apiKey: string) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    expectNoContent = false
  ): Promise<T> {
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

    // v2: DELETE returns 204 No Content
    if (expectNoContent && resp.status === 204) {
      return undefined as T;
    }

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
    // v2: POST returns 201 with full transaction objects
    const data = await this.request<LMCreateResponse>("POST", "/transactions", {
      transactions: [payload],
      skip_duplicates: true,
    });

    if (data.transactions && data.transactions.length > 0) {
      return data.transactions[0].id;
    }

    // Check if it was a skipped duplicate
    if (data.skipped_duplicates && data.skipped_duplicates.length > 0) {
      return data.skipped_duplicates[0].existing_transaction_id;
    }

    throw new LunchMoneyError("No transaction returned from create");
  }

  async updateTransaction(id: number, payload: LMUpdateTransactionPayload): Promise<void> {
    await this.request("PUT", `/transactions/${id}`, payload);
  }

  async deleteTransaction(id: number): Promise<boolean> {
    try {
      // v2: DELETE returns 204 No Content
      await this.request("DELETE", `/transactions/${id}`, undefined, true);
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

  async getManualAccounts(): Promise<LMManualAccountsResponse> {
    // v2: /assets renamed to /manual_accounts
    return this.request<LMManualAccountsResponse>("GET", "/manual_accounts");
  }

  async getTags(): Promise<LMTagsResponse> {
    return this.request<LMTagsResponse>("GET", "/tags");
  }

  async getTransactions(startDate: string, endDate: string, includeMetadata = true): Promise<LMTransactionsResponse> {
    return this.request<LMTransactionsResponse>(
      "GET",
      `/transactions?start_date=${startDate}&end_date=${endDate}&include_metadata=${includeMetadata}`
    );
  }
}
