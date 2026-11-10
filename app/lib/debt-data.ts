// Legacy stored snapshot types, retained for existing connections. Current DZ is calculated in receivables.ts.
export type DebtRow = {
  category: string;
  paymentMethod: string;
  recipient: string;
  direction: string;
  marker: string;
  balance: number;
};

export type DebtData = {
  source: "debt-google-sheet";
  sheet: string;
  updatedAt: string;
  totalBalance: number;
  unavailableMetrics: string[];
  rows: DebtRow[];
};

