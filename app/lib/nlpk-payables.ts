import { date, number, text } from './source-values';
export type NlpkPayable = { date: string; balance: number; document: string; dueDate: string; note: string };
export class NlpkValidationError extends Error {}
/** One complete snapshot at the latest date, never a sum of successive debt balances. */
export function parseNlpkPayables(rows: Record<string, unknown>[], end: string): NlpkPayable[] {
  const entries = rows.map((row, index) => {
    if (!text(row.date) || !text(row.balance)) throw new NlpkValidationError(`Кредиторка НЛПК, строка ${index + 1}: заполните дату и остаток долга`);
    return { date: date(row.date), balance: number(row.balance), document: text(row.document), dueDate: date(row.dueDate), note: text(row.note) };
  });
  const latest = entries.filter(row => row.date <= end).map(row => row.date).sort().at(-1);
  return entries.filter(row => row.date === latest);
}
export function nlpkTotal(rows: NlpkPayable[]) {
  return rows.length ? rows.reduce((sum, row) => sum + Math.round(row.balance * 100), 0) / 100 : null;
}

/** This source is one creditor's balance history, not a register of invoices. */
export const NLPK_HISTORY_SHEET = 'Кредиторка по Заводу (1с)';
export const NLPK_HISTORY_VERSION = 'nlpk-A6-G-closing-v1';
export type NlpkHistory = { kind: typeof NLPK_HISTORY_VERSION; creditor: 'НЛПК'; history: NlpkPayable[] };
export function isNlpkHistory(value: unknown): value is NlpkHistory {
  return !!value && typeof value === 'object' && 'kind' in value && value.kind === NLPK_HISTORY_VERSION && 'history' in value && Array.isArray(value.history);
}
export function parseNlpkHistory(rows: unknown[][], firstRow = 1): NlpkHistory {
  const history: NlpkPayable[] = [];
  rows.forEach((row, index) => {
    if (firstRow + index < 6 || !text(row[0]) || !text(row[6])) return;
    try {
      // Never inspect column A for the creditor or use opening balance C.
      if (typeof row[0] === 'number' && (row[0] < 1 || row[0] > 2958465)) return;
      history.push({ date: date(row[0]), balance: number(row[6]), document: '', dueDate: '', note: 'НЛПК · кредитовое сальдо на конец дня (G)' });
    } catch { /* Headers, service rows and invalid/empty values are not balances. */ }
  });
  return { kind: NLPK_HISTORY_VERSION, creditor: 'НЛПК', history };
}
export function nlpkHistoryAt(history: NlpkPayable[], end: string): NlpkPayable[] {
  let latest: NlpkPayable | undefined;
  for (const row of history) if (row.date <= end && (!latest || row.date >= latest.date)) latest = row;
  // Equal dates use the last physical record; balances are never summed.
  return latest ? [latest] : [];
}
