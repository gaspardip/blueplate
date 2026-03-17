export interface FXQuote {
  pair: string;
  rate: number;
  source: string;
  sourceTimestamp: string;
  fetchedAt: Date;
}

export interface FXConversion {
  originalAmount: number;
  originalCurrency: string;
  convertedAmount: number;
  convertedCurrency: string;
  rate: number;
  source: string;
}
