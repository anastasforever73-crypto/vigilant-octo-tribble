import type { DashboardData } from './dashboard-data';
import type { Access } from './user-access';
import { sectionData } from './connections/compose';
import { buildLive } from './live-data';

export function visibleDashboard(data: DashboardData, access: Access): DashboardData {
  if (access.role === 'admin') return data;
  const empty = (): DashboardData => ({ source: '', cash: [], orders: [], debtor: {}, creditor: {}, balances: {} });
  const result: DashboardData = { ...empty(), updatedAt: data.updatedAt, archive: data.archive, period: data.period, sections: {} };
  // Whitelist payload fields, including nested section fallbacks, before sending to a viewer.
  for (const section of access.sections) {
    const source = sectionData(data, section);
    const visible = empty();
    if (section === 'overview') result.operational = data.operational;
    if (section === 'plan') Object.assign(visible, { planningSource: source.planningSource, planReceipts: source.planReceipts, planPayments: source.planPayments, plannedBalance: source.plannedBalance });
    if (section === 'cash') Object.assign(visible, { planningSummary: data.planningSummary, cash: source.cash, balances: source.balances, fields: { cash: source.fields?.cash, balances: source.fields?.balances, orders: false } });
    if (section === 'sales') Object.assign(visible, { orders: source.orders, fields: { orders: source.fields?.orders, cash: false, balances: false } });
    if (section === 'debt') {
      result.receivables = data.receivables;
      Object.assign(visible, { creditor: source.creditor, debt: source.debt, nlpkPayables: source.nlpkPayables ?? data.nlpkPayables, nlpkConfigured: source.nlpkConfigured || data.nlpkConfigured, nlpkComparison: source.nlpkComparison ?? data.nlpkComparison });
      if (data.period) result.debtPayments = buildLive(source, data.period.start, data.period.end, false).factoryPayments;
    }
    if (section === 'balance' && data.sections?.balance) visible.balanceSheet = source.balanceSheet;
    if (section !== 'balance' || data.sections?.balance) result.sections![section] = visible;
  }
  return result;
}
