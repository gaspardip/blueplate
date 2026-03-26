// Lunch Money API v2 types
// Source: OpenAPI spec v2.9.0 — /Users/gaspar/Downloads/api-1.json
// Docs: https://alpha.lunchmoney.dev/v2/docs

export interface LMTransaction {
  id: number;
  date: string;
  amount: string;
  currency: string;
  to_base: number;
  recurring_id: number | null;
  payee: string;
  original_name: string | null;
  category_id: number | null;
  manual_account_id: number | null;
  plaid_account_id: number | null;
  external_id: string | null;
  tag_ids: number[];
  notes: string | null;
  status: "reviewed" | "unreviewed" | "delete_pending";
  is_pending: boolean;
  created_at: string;
  updated_at: string;
  is_split_parent: boolean;
  split_parent_id: number | null;
  is_group_parent: boolean;
  group_parent_id: number | null;
  source: "api" | "csv" | "manual" | "merge" | "plaid" | "recurring" | "rule" | "split" | "user" | null;
  // Only present when include_metadata=true
  custom_metadata?: Record<string, unknown> | null;
  plaid_metadata?: Record<string, unknown> | null;
}

export interface LMCategory {
  id: number;
  name: string;
  description: string | null;
  is_income: boolean;
  exclude_from_budget: boolean;
  exclude_from_totals: boolean;
  is_group: boolean;
  group_id: number | null;
  archived: boolean;
  archived_at: string | null;
  order: number | null;
  collapsed: boolean;
  created_at: string;
  updated_at: string;
  children?: LMCategory[];
}

export interface LMManualAccount {
  id: number;
  name: string;
  institution_name: string | null;
  display_name: string | null;
  type: string;
  subtype: string | null;
  balance: string;
  currency: string;
  to_base: number;
  balance_as_of: string;
  status: "active" | "closed";
  closed_on: string | null;
  external_id: string | null;
  custom_metadata?: Record<string, unknown> | null;
  exclude_from_transactions: boolean;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

export interface LMTag {
  id: number;
  name: string;
  description: string | null;
  text_color: string | null;
  background_color: string | null;
  archived: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LMCreateTransactionPayload {
  date: string;
  amount: string | number;
  currency?: string;
  payee?: string;
  original_name?: string | null;
  category_id?: number | null;
  notes?: string | null;
  manual_account_id?: number | null;
  plaid_account_id?: number | null;
  recurring_id?: number | null;
  status?: "reviewed" | "unreviewed";
  tag_ids?: number[];
  external_id?: string | null;
  custom_metadata?: Record<string, unknown> | null;
}

export interface LMUpdateTransactionPayload {
  date?: string;
  amount?: string | number;
  currency?: string;
  payee?: string;
  category_id?: number | null;
  notes?: string | null;
  manual_account_id?: number | null;
  tag_ids?: number[];
  additional_tag_ids?: number[];
  external_id?: string | null;
  custom_metadata?: Record<string, unknown> | null;
  status?: "reviewed" | "unreviewed";
}

export interface LMCreateRequest {
  transactions: LMCreateTransactionPayload[];
  apply_rules?: boolean;
  skip_duplicates?: boolean;
  skip_balance_update?: boolean;
}

export interface LMSkippedDuplicate {
  reason: "duplicate_external_id" | "duplicate_payee_amount_date";
  request_transactions_index: number;
  existing_transaction_id: number;
  request_transaction: LMCreateTransactionPayload;
}

export interface LMCreateResponse {
  transactions: LMTransaction[] | null;
  skipped_duplicates: LMSkippedDuplicate[] | null;
}

export interface LMCategoriesResponse {
  categories: LMCategory[];
}

export interface LMManualAccountsResponse {
  manual_accounts: LMManualAccount[];
}

export interface LMTagsResponse {
  tags: LMTag[];
}

export interface LMTransactionsResponse {
  transactions: LMTransaction[];
  has_more: boolean;
}

// Blueplate custom_metadata schema
export interface BlueplateMetadata {
  blueplate_version: number;
  ingested_via: "telegram";
  original_amount?: number;
  original_currency?: string;
  fx_rate?: number;
  fx_mode?: "blue_buy" | "manual_sell";
  fx_source?: string;
  telegram_chat_id?: number;
  telegram_message_id?: number;
  [key: string]: unknown; // index signature for Record<string, unknown> compat
}
