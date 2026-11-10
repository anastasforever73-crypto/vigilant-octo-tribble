import { date, number, text } from './source-values';
export type PlanRow = { date: string; category: string; amount: number; counterparty: string; note: string };
export class PlanValidationError extends Error {}
export function parsePlanRows(rows: Record<string, unknown>[]): PlanRow[] {
  return rows.map((row, index) => {
    const plannedDate = date(row.date), category = text(row.category);
    if (!plannedDate || !category || !text(row.amount)) throw new PlanValidationError(`План, строка ${index + 1}: заполните дату, категорию и сумму`);
    const amount = number(row.amount);
    if (amount < 0) throw new PlanValidationError(`План, строка ${index + 1}: сумма должна быть положительной или нулевой; направление задаётся набором данных`);
    return { date: plannedDate, category, amount, counterparty: text(row.counterparty), note: text(row.note) };
  });
}
export function summarizePlan(rows: PlanRow[], start: string, end: string) {
  const selected = rows.filter(row => row.date >= start && row.date <= end);
  const categories = new Map<string, { cents: number; count: number }>();
  let cents = 0;
  for (const row of selected) {
    const value = Math.round(row.amount * 100);
    cents += value;
    const category = categories.get(row.category) || { cents: 0, count: 0 };
    category.cents += value; category.count++;
    categories.set(row.category, category);
  }
  return { total: cents / 100, count: selected.length, categories: [...categories].map(([category, value]) => ({ category, amount: value.cents / 100, count: value.count })).sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category, 'ru')), rows: [...selected].sort((a, b) => a.date.localeCompare(b.date) || a.category.localeCompare(b.category, 'ru')) };
}
export function previousPlanPeriod(start: string, end: string) {
  const days = (Date.parse(end) - Date.parse(start)) / 86400000 + 1;
  return { start: new Date(Date.parse(start) - days * 86400000).toISOString().slice(0, 10), end: new Date(Date.parse(start) - 86400000).toISOString().slice(0, 10) };
}
