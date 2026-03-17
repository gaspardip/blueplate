// Lunch Money API v2 types

export interface LMTransaction {
  id: number;
  date: string;
  payee: string;
  amount: string; // LM uses string amounts
  currency: string;
  category_id: number | null;
  asset_id: number | null;
  notes: string | null;
  status: string;
  external_id: string | null;
  tags: LMTag[];
}

export interface LMCategory {
  id: number;
  name: string;
  is_income: boolean;
  archived: boolean;
  group_id: number | null;
}

export interface LMAsset {
  id: number;
  name: string;
  display_name: string | null;
  type_name: string;
  balance: string;
  currency: string;
}

export interface LMTag {
  id: number;
  name: string;
}

export interface LMCreateTransactionPayload {
  date: string;
  payee: string;
  amount: string;
  currency: string;
  category_id?: number;
  asset_id?: number;
  notes?: string;
  status?: string;
  external_id?: string;
  tags?: number[];
}

export interface LMUpdateTransactionPayload {
  payee?: string;
  amount?: string;
  currency?: string;
  category_id?: number;
  notes?: string;
  status?: string;
}

export interface LMCreateResponse {
  ids: number[];
}

export interface LMCategoriesResponse {
  categories: LMCategory[];
}

export interface LMAssetsResponse {
  assets: LMAsset[];
}

export interface LMTagsResponse {
  tags?: LMTag[];
}

export interface LMTransactionsResponse {
  transactions: LMTransaction[];
}
