export interface ParseResult {
  ok: true;
  expense: ParsedExpense;
}

export interface ParseAmbiguous {
  ok: false;
  error: "ambiguous";
  message: string;
  candidates?: string[];
}

export interface ParseInvalid {
  ok: false;
  error: "invalid";
  message: string;
}

export type ParseOutcome = ParseResult | ParseAmbiguous | ParseInvalid;

export interface ParsedExpense {
  amount: number;
  currency?: string;
  payee: string;
  categoryHint?: string;
  assetHint?: string;
  tags: string[];
  note?: string;
  date?: string; // YYYY-MM-DD or relative like "yesterday"
  splitCount?: number;
}

export type TokenType =
  | "amount"
  | "currency"
  | "date"
  | "tag"
  | "note"
  | "category"
  | "asset"
  | "split"
  | "text";

export interface Token {
  type: TokenType;
  value: string;
  raw: string;
  position: number;
}
