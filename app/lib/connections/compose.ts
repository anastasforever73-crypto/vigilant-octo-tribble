import { isNlpkHistory, nlpkHistoryAt, nlpkTotal } from '../nlpk-payables';
import type { DashboardData } from '../dashboard-data';
import type { DebtRow } from '../debt-data';
import { bindingKey, resolveValues, mergeRows } from './merge';
import type { Binding, Connection, Section, StoredData } from './model';
// Resolve each metric independently; never add snapshot totals together.
export function composeConnections(base: DashboardData, connections: Connection[], values: Map<string, StoredData>): DashboardData {
  const result: DashboardData = { ...base, sources: { ...base.sources }, sections: {} };
  const claimed = new Set<string>();
  for (const c of connections) {
    const payload = c.enabled ? values.get(c.id) : undefined;
    if (payload?.syncedAt && (!result.updatedAt || payload.syncedAt > result.updatedAt)) result.updatedAt = payload.syncedAt;
    result.sources![c.id] = { name: c.name, configured: true, available: Boolean(payload), status: c.enabled ? c.status : 'disabled', updatedAt: c.lastSuccess, error: c.enabled ? c.error : undefined, purpose: c.type === 'fintablo' ? 'ДДС, остатки и финансовые показатели' : c.type === 'debt' ? 'Google Sheets — дебиторка / кредиторка' : c.bindings.map(b => b.sheet).join(', '), freshness: !c.enabled ? 'Источник отключён' : payload ? 'Сохранённый результат синхронизации выбранного периода' : 'Выбранный период ещё не синхронизирован' };
    if (c.enabled && c.type === 'debt' && !c.bindings.length && base.sources?.debt) { result.sources![c.id] = { ...base.sources.debt, updatedAt: base.sources.debt.updatedAt || c.lastSuccess, name: c.name }; delete result.sources!.debt; if (result.receivables && !result.receivables.updatedAt) result.receivables = { ...result.receivables, updatedAt: c.lastSuccess }; }
    for (const b of c.bindings) {
      const slot = `${b.section}:${b.dataset}`;
      if (claimed.has(slot)) continue;
      claimed.add(slot);
      const section: DashboardData = result.sections![b.section] || { ...base, fields: { cash: Boolean(base.fields?.cash), orders: Boolean(base.fields?.orders), balances: Boolean(base.fields?.balances) } };
      result.sections![b.section] = section;
      const candidates: { binding: Binding; value: unknown; name: string }[] = connections.filter(other => other.enabled).flatMap(other => other.bindings.filter(link => link.section === b.section && link.dataset === b.dataset).map(link => {
        const snapshot = other.status === 'sync_error' ? undefined : values.get(other.id);
        return { binding: link, value: snapshot?.byBinding ? snapshot.byBinding[bindingKey(link)] : snapshot?.[b.dataset], name: `${other.name} · ${link.sheet}` };
      }));
      if (b.dataset === 'nlpkPayables') section.nlpkConfigured = connections.some(c => c.enabled && c.bindings.some(link => link.section === b.section && link.dataset === b.dataset));
      const value = resolveValues(candidates);
      const missing = candidates.filter(e => e.binding.mode === 'merge' && e.value === undefined);
      if (missing.length) result.sources![`merge:${slot}`] = { name: 'Объединение данных', configured: true, available: false, status: 'partial', error: `Не удалось объединить ${b.dataset}: обновите источники ${missing.map(e => e.name).join(', ')}. Частичная сумма не используется.`, freshness: 'Полное обновление не подтверждено' };
      // An unavailable saved connection must not erase a successful live source.
      if (value === undefined) continue;
      if ((b.dataset === 'nlpkPayables' || b.dataset === 'payables') && isNlpkHistory(value)) {
        section.nlpkHistory = value;
        section.nlpkConfigured = true;
        section.nlpkPayables = nlpkHistoryAt(value.history, base.period!.end);
        section.creditor = { ...section.creditor, factory: nlpkTotal(section.nlpkPayables) ?? undefined, date: section.nlpkPayables[0]?.date };
        continue;
      }
      if (b.dataset === 'nlpkPayables') {
        section.nlpkPayables = value as DashboardData['nlpkPayables'];
        const rows = section.nlpkPayables || [];
        section.creditor = { ...section.creditor, factory: rows.length ? rows.reduce((sum, row) => sum + Math.round(row.balance * 100), 0) / 100 : undefined, date: rows[0]?.date };
      }
      if (b.dataset === 'planReceipts' || b.dataset === 'planPayments') section[b.dataset] = value as DashboardData['planReceipts'];
      if (b.dataset === 'cash') { section.cash = (value || []) as DashboardData['cash']; section.fields!.cash = value !== undefined; }
      if (b.dataset === 'orders') { section.orders = (value || []) as DashboardData['orders']; section.fields!.orders = value !== undefined; }
      if (b.dataset === 'balances') { section.balances = (value || {}) as DashboardData['balances']; section.fields!.balances = value !== undefined; }
      if (b.dataset === 'balanceSheet') section.balanceSheet = value as DashboardData['balanceSheet'];
      if (b.dataset === 'pnl') section.pnl = value === undefined ? undefined : value as DashboardData['pnl'];
      if (b.dataset === 'payables') {
        const rows = mergeRows([value]) as { balance: number }[];
        delete result.sources!.payables;
        section.creditor = { total: rows.reduce((sum, row) => sum + Math.round(row.balance * 100), 0) / 100, date: payload?.syncedAt?.slice(0, 10) };
      }
      if (b.dataset === 'debt') {
        const rows = (value || []) as DebtRow[];
        // Replaces legacy debt figures; the same aggregate is never added to them.
        // Current receivables and independently read payables remain authoritative.
        section.debt = value ? { source: 'debt-google-sheet', sheet: b.sheet, updatedAt: c.lastSuccess || '', rows, totalBalance: rows.reduce((total, row) => total + row.balance, 0), unavailableMetrics: ['Просрочка', 'Количество контрагентов', 'Срок погашения'] } : undefined;
      }
    }
  }
  const cash = result.sections!.cash;
  if (cash && !base.fields?.cash) { result.cash = cash.cash; result.balances = cash.balances; result.fields = { ...result.fields!, cash: !!cash.fields?.cash, balances: !!cash.fields?.balances }; }
  if (connections.some(c => c.enabled && c.type === 'fintablo')) delete result.sources!.fintablo;
  if (!base.sources?.googleSheets?.configured) delete result.sources!.googleSheets;
  for (const [key, section] of Object.entries(result.sections!)) {
    section.sources = result.sources;
    if (!claimed.has(`${key}:cash`)) { section.cash = result.cash; section.fields!.cash = !!result.fields?.cash; }
    if (!claimed.has(`${key}:balances`)) { section.balances = result.balances; section.fields!.balances = !!result.fields?.balances; }
  }
  return result;
}
export const sectionData = (data: DashboardData, section: Section) => data.sections?.[section] || data;
