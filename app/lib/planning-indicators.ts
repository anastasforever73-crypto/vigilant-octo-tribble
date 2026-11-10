import type { DashboardData } from './dashboard-data';
import { sectionData } from './connections/compose';
import { summarizePlan } from './planning';
import { missingMetric, type Metric } from './operational';
import { nlpkTotal, nlpkHistoryAt } from './nlpk-payables';
export type PlanningSummary = { start: string; end: string; receipts: number | null; payments: number | null; net: number | null; daily: { date: string; receipts: number | null; payments: number | null }[] };
export function planningSummary(data: DashboardData, start: string, end: string): PlanningSummary {
  const plan = sectionData(data, 'plan');
  const receipts = plan.planReceipts === undefined ? null : summarizePlan(plan.planReceipts, start, end).total;
  const payments = plan.planPayments === undefined ? null : summarizePlan(plan.planPayments, start, end).total;
  const dates = [...new Set([...(plan.planReceipts || []), ...(plan.planPayments || [])].filter(r => r.date >= start && r.date <= end).map(r => r.date))].sort();
  const daily = dates.map(date => ({ date, receipts: plan.planReceipts === undefined ? null : summarizePlan(plan.planReceipts, date, date).total, payments: plan.planPayments === undefined ? null : summarizePlan(plan.planPayments, date, date).total }));
  return { start, end, receipts, payments, daily, net: receipts == null || payments == null ? null : (Math.round(receipts * 100) - Math.round(payments * 100)) / 100 };
}
export function operationalBalance(total: Metric | undefined, plans: PlanningSummary): Metric {
  const source = 'Общий остаток ДС на конец выбранного периода + план поступлений − план списаний';
  const reason = `Остаток денежных средств на ${total?.date || 'неизвестную дату'} плюс план поступлений минус план списаний за ${plans.start} — ${plans.end}. Кредиторка отдельно не вычитается: её оплаты должны входить в план списаний.`;
  if (total?.value == null || plans.receipts == null || plans.payments == null) return missingMetric(`Необходимы подтверждённый остаток на конец периода и оба плана за выбранный период. ${reason}`, source);
  return { value: (Math.round(total.value * 100) + Math.round(plans.receipts * 100) - Math.round(plans.payments * 100)) / 100, reason, source, date: plans.end };
}
/** Recalculate from archived facts on each read so UI and exports share the same period and formula. */
export function withPlanningIndicators(data: DashboardData, start: string, end: string): DashboardData {
  const plans = planningSummary(data, start, end);
  const nlpkHistory = data.sections?.overview?.nlpkHistory ?? data.sections?.debt?.nlpkHistory ?? ((data.sections?.overview?.nlpkPayables ?? data.sections?.debt?.nlpkPayables) === undefined ? data.receivables?.nlpkHistory : undefined);
  const comparisonEnd = new Date(Date.parse(start) - 86400000).toISOString().slice(0, 10);
  const nlpkComparison: Metric | undefined = nlpkHistory ? (() => {
    const rows = nlpkHistoryAt(nlpkHistory.history, comparisonEnd);
    return { value: nlpkTotal(rows), date: rows[0]?.date, source: 'Google Sheets · НЛПК · A / G', reason: `Остаток на последнюю запись не позже ${comparisonEnd}.` };
  })() : undefined;
  const nlpkPayables = nlpkHistory ? nlpkHistoryAt(nlpkHistory.history, end) : data.sections?.overview?.nlpkPayables ?? data.sections?.debt?.nlpkPayables;
  const nlpkConfigured = !!nlpkHistory || data.sections?.overview?.nlpkConfigured || data.sections?.debt?.nlpkConfigured;
  let operational = data.operational;
  if (operational) {
    const metric = (value: number | null, label: string): Metric => ({ value, source: `Планирование · ${label}`, reason: `${label} за ${start} — ${end}.`, date: end });
    operational = { ...operational, planningSource: sectionData(data, 'plan').planningSource, plannedReceipts: metric(plans.receipts, 'План поступлений'), plannedPayments: metric(plans.payments, 'План списаний'), operationalBalance: operationalBalance(operational.total, plans), planningPeriod: { start, end }, planningMonths: Array.from(new Set(plans.daily.map(r => r.date.slice(0, 7)))).map(month => { const rows = plans.daily.filter(r => r.date.startsWith(month)); return { month, receipts: plans.receipts == null ? null : rows.reduce((sum, r) => sum + Math.round((r.receipts || 0) * 100), 0) / 100, payments: plans.payments == null ? null : rows.reduce((sum, r) => sum + Math.round((r.payments || 0) * 100), 0) / 100 }; }) };
    const nlpk = nlpkPayables;
    if (data.sections?.overview?.nlpkConfigured || data.sections?.debt?.nlpkConfigured) operational.payables = missingMetric('Источник НЛПК настроен, но снимок за выбранную дату не получен.', 'Google Sheets · кредиторская задолженность НЛПК');
    if (nlpk !== undefined) operational.payables = { value: nlpkTotal(nlpk), date: nlpk[0]?.date, source: 'Google Sheets · кредиторская задолженность НЛПК', reason: 'Остаток НЛПК из G последней записи не позже конца выбранного периода. Исторические остатки не суммируются.', ...(nlpkComparison ? { comparison: { value: nlpkComparison.value, date: nlpkComparison.date, end: comparisonEnd } } : {}) };
  }
  const sections = { ...data.sections };
  if (nlpkConfigured) {
    const debt = sectionData(data, 'debt');
    sections.debt = { ...debt, nlpkPayables, nlpkHistory, nlpkComparison, nlpkConfigured: true, creditor: { ...debt.creditor, factory: nlpkPayables ? nlpkTotal(nlpkPayables) ?? undefined : undefined, date: nlpkPayables?.[0]?.date } };
  }
  sections.plan = { ...sectionData(data, 'plan'), plannedBalance: operational?.operationalBalance };
  return { ...data, plannedBalance: operational?.operationalBalance, creditor: nlpkConfigured ? { ...data.creditor, factory: nlpkPayables ? nlpkTotal(nlpkPayables) ?? undefined : undefined, date: nlpkPayables?.[0]?.date } : data.creditor, sections, operational, planningSummary: plans, nlpkPayables, nlpkHistory, nlpkComparison, nlpkConfigured };
}
