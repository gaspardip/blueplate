export interface Transaction {
  amount: number;
  currency: string;
  originalAmount?: number;
  originalCurrency?: string;
  payee: string;
  categoryId?: number;
  categoryName?: string;
  assetId?: number;
  date: string; // YYYY-MM-DD
  notes?: string;
  tags?: string[];
  externalId: string;
}

export interface ResolutionContext {
  categories: CachedCategory[];
  assets: CachedAsset[];
  tags: CachedTag[];
  defaultCurrency: string;
}

export interface CachedCategory {
  id: number;
  name: string;
  isIncome: boolean;
  archived: boolean;
}

export interface CachedAsset {
  id: number;
  name: string;
  displayName?: string;
  currency: string;
}

export interface CachedTag {
  id: number;
  name: string;
}
