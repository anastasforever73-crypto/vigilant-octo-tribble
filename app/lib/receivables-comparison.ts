import { debtAt, type ReceivablesReport } from './receivables';
import { period } from './source-values';

export function compareReceivables(report: ReceivablesReport | undefined, start: string, end: string) {
  let comparisonStart: string;
  try { ({ comparisonStart } = period(new URLSearchParams({ start, end }))); }
  catch { return { comparisonStart: '', previousEnd: '', current: null, previous: null, change: null, percent: null }; }
  const previousEnd = new Date(Date.parse(start) - 86400000).toISOString().slice(0, 10);
  const full = (date: string) => { const snapshot = report ? debtAt(report, date) : null; return snapshot && !snapshot.partial ? snapshot.totalCents : null; };
  const current = full(end), previous = full(previousEnd);
  const change = current != null && previous != null ? current - previous : null;
  return { comparisonStart, previousEnd, current, previous, change, percent: change != null && previous !== 0 ? change / previous! * 100 : null };
}
