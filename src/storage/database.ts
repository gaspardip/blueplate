import { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id TEXT UNIQUE NOT NULL,
  lm_transaction_id INTEGER NOT NULL,
  telegram_chat_id INTEGER NOT NULL,
  telegram_message_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  original_amount REAL,
  original_currency TEXT,
  payee TEXT NOT NULL,
  category_name TEXT,
  asset_name TEXT,
  date TEXT NOT NULL,
  fx_rate REAL,
  fx_source TEXT,
  undone INTEGER NOT NULL DEFAULT 0,
  undone_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lm_categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  is_income INTEGER DEFAULT 0,
  archived INTEGER DEFAULT 0,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lm_assets (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  display_name TEXT,
  currency TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lm_tags (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fx_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pair TEXT NOT NULL,
  rate REAL NOT NULL,
  source TEXT NOT NULL,
  source_timestamp TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_defaults (
  telegram_chat_id INTEGER PRIMARY KEY,
  default_currency TEXT NOT NULL DEFAULT 'ARS',
  default_asset_id INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payee_aliases (
  alias TEXT PRIMARY KEY,
  canonical TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

export class BlueplateDatabase {
  private db: Database;

  private constructor(db: Database) {
    this.db = db;
  }

  static async create(path: string): Promise<BlueplateDatabase> {
    await mkdir(dirname(path), { recursive: true });
    const db = new Database(path);
    db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA foreign_keys = ON");
    db.run(SCHEMA_SQL);
    return new BlueplateDatabase(db);
  }

  close(): void {
    this.db.close();
  }

  // --- Transactions (undo records) ---

  saveTransaction(params: {
    externalId: string;
    lmTransactionId: number;
    telegramChatId: number;
    telegramMessageId: number;
    amount: number;
    currency: string;
    originalAmount?: number;
    originalCurrency?: string;
    payee: string;
    categoryName?: string;
    assetName?: string;
    date: string;
    fxRate?: number;
    fxSource?: string;
  }): void {
    this.db
      .query(
        `INSERT INTO transactions (
          external_id, lm_transaction_id, telegram_chat_id, telegram_message_id,
          amount, currency, original_amount, original_currency,
          payee, category_name, asset_name, date, fx_rate, fx_source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        params.externalId,
        params.lmTransactionId,
        params.telegramChatId,
        params.telegramMessageId,
        params.amount,
        params.currency,
        params.originalAmount ?? null,
        params.originalCurrency ?? null,
        params.payee,
        params.categoryName ?? null,
        params.assetName ?? null,
        params.date,
        params.fxRate ?? null,
        params.fxSource ?? null
      );
  }

  getByExternalId(externalId: string): TransactionRow | null {
    return (
      this.db
        .query<TransactionRow, [string]>(
          "SELECT * FROM transactions WHERE external_id = ?"
        )
        .get(externalId) ?? null
    );
  }

  getLastUndoable(chatId: number): TransactionRow | null {
    return (
      this.db
        .query<TransactionRow, [number]>(
          "SELECT * FROM transactions WHERE telegram_chat_id = ? AND undone = 0 ORDER BY id DESC LIMIT 1"
        )
        .get(chatId) ?? null
    );
  }

  markUndone(id: number): void {
    this.db
      .query("UPDATE transactions SET undone = 1, undone_at = datetime('now') WHERE id = ?")
      .run(id);
  }

  getTransactionsForDate(chatId: number, date: string): TransactionRow[] {
    return this.db
      .query<TransactionRow, [number, string]>(
        "SELECT * FROM transactions WHERE telegram_chat_id = ? AND date = ? AND undone = 0 ORDER BY id ASC"
      )
      .all(chatId, date);
  }

  getTransactionsForMonth(chatId: number, yearMonth: string): TransactionRow[] {
    return this.db
      .query<TransactionRow, [number, string]>(
        "SELECT * FROM transactions WHERE telegram_chat_id = ? AND date LIKE ? AND undone = 0 ORDER BY id ASC"
      )
      .all(chatId, `${yearMonth}%`);
  }

  // --- LM Categories ---

  upsertCategories(categories: { id: number; name: string; isIncome: boolean; archived: boolean }[]): void {
    const now = new Date().toISOString();
    const stmt = this.db.query(
      "INSERT OR REPLACE INTO lm_categories (id, name, is_income, archived, fetched_at) VALUES (?, ?, ?, ?, ?)"
    );
    for (const c of categories) {
      stmt.run(c.id, c.name, c.isIncome ? 1 : 0, c.archived ? 1 : 0, now);
    }
  }

  getCategories(): CategoryRow[] {
    return this.db
      .query<CategoryRow, []>("SELECT * FROM lm_categories WHERE archived = 0 ORDER BY name")
      .all();
  }

  getCategoriesFetchedAt(): string | null {
    const row = this.db
      .query<{ fetched_at: string }, []>("SELECT fetched_at FROM lm_categories ORDER BY fetched_at DESC LIMIT 1")
      .get();
    return row?.fetched_at ?? null;
  }

  // --- LM Assets ---

  upsertAssets(assets: { id: number; name: string; displayName?: string; currency: string }[]): void {
    const now = new Date().toISOString();
    const stmt = this.db.query(
      "INSERT OR REPLACE INTO lm_assets (id, name, display_name, currency, fetched_at) VALUES (?, ?, ?, ?, ?)"
    );
    for (const a of assets) {
      stmt.run(a.id, a.name, a.displayName ?? null, a.currency, now);
    }
  }

  getAssets(): AssetRow[] {
    return this.db
      .query<AssetRow, []>("SELECT * FROM lm_assets ORDER BY name")
      .all();
  }

  getAssetsFetchedAt(): string | null {
    const row = this.db
      .query<{ fetched_at: string }, []>("SELECT fetched_at FROM lm_assets ORDER BY fetched_at DESC LIMIT 1")
      .get();
    return row?.fetched_at ?? null;
  }

  // --- LM Tags ---

  upsertTags(tags: { id: number; name: string }[]): void {
    const now = new Date().toISOString();
    const stmt = this.db.query(
      "INSERT OR REPLACE INTO lm_tags (id, name, fetched_at) VALUES (?, ?, ?)"
    );
    for (const t of tags) {
      stmt.run(t.id, t.name, now);
    }
  }

  getTags(): TagRow[] {
    return this.db
      .query<TagRow, []>("SELECT * FROM lm_tags ORDER BY name")
      .all();
  }

  // --- FX Rates ---

  saveFxRate(pair: string, rate: number, source: string, sourceTimestamp: string): void {
    this.db
      .query(
        "INSERT INTO fx_rates (pair, rate, source, source_timestamp) VALUES (?, ?, ?, ?)"
      )
      .run(pair, rate, source, sourceTimestamp);
  }

  getLatestFxRate(pair: string): FxRateRow | null {
    return (
      this.db
        .query<FxRateRow, [string]>(
          "SELECT * FROM fx_rates WHERE pair = ? ORDER BY id DESC LIMIT 1"
        )
        .get(pair) ?? null
    );
  }

  // --- Payee Aliases ---

  getPayeeAlias(alias: string): string | null {
    const row = this.db
      .query<{ canonical: string }, [string]>(
        "SELECT canonical FROM payee_aliases WHERE alias = ?"
      )
      .get(alias.toLowerCase());
    return row?.canonical ?? null;
  }

  setPayeeAlias(alias: string, canonical: string): void {
    this.db
      .query(
        "INSERT OR REPLACE INTO payee_aliases (alias, canonical) VALUES (?, ?)"
      )
      .run(alias.toLowerCase(), canonical);
  }

  getDistinctPayees(): string[] {
    const rows = this.db
      .query<{ payee: string }, []>(
        "SELECT DISTINCT payee FROM transactions WHERE undone = 0 ORDER BY payee"
      )
      .all();
    return rows.map((r) => r.payee);
  }
}

// Row types
export interface TransactionRow {
  id: number;
  external_id: string;
  lm_transaction_id: number;
  telegram_chat_id: number;
  telegram_message_id: number;
  amount: number;
  currency: string;
  original_amount: number | null;
  original_currency: string | null;
  payee: string;
  category_name: string | null;
  asset_name: string | null;
  date: string;
  fx_rate: number | null;
  fx_source: string | null;
  undone: number;
  undone_at: string | null;
  created_at: string;
}

export interface CategoryRow {
  id: number;
  name: string;
  is_income: number;
  archived: number;
  fetched_at: string;
}

export interface AssetRow {
  id: number;
  name: string;
  display_name: string | null;
  currency: string;
  fetched_at: string;
}

export interface TagRow {
  id: number;
  name: string;
  fetched_at: string;
}

export interface FxRateRow {
  id: number;
  pair: string;
  rate: number;
  source: string;
  source_timestamp: string;
  fetched_at: string;
}
