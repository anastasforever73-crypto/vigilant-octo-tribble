import 'server-only';
import { readFintablo, readFintabloPeriodBalances } from './fintablo';
import { getSourceSettings } from './source-settings';
import { getConnection, listConnections } from './connections/store';
import { resolveValues } from './connections/merge';
import { missingMetric, operationalFinancial, type OperationalFinancial } from './operational';
import type { Binding } from './connections/model';

/** Read-only use of the saved accounts and priorities, independent of the historical UI period. */
export async function readOperationalFinancial(day: string, end?: string): Promise<OperationalFinancial> {
  const absent = missingMetric('FinTablo недоступен или для показателя нет включённой связи с источником.', 'FinTablo');
  const result: OperationalFinancial = { account: absent, wallet: absent, deposit: absent, total: absent, receipts: absent };
  try {
    const saved = process.env.DATABASE_URL ? (await listConnections()).filter(c => c.enabled && c.type === 'fintablo') : [];
    if (saved.length) {
      const values = await Promise.all(saved.map(async c => {
        try {
          const { secrets } = await getConnection(c.id);
          const snapshot = await readFintablo(day, day, { fintabloBaseUrl: c.config.baseUrl || 'https://api.fintablo.ru', fintabloToken: secrets.token || '' });
          const ids = c.config.accountIds || [];
          if (ids.some(id => !snapshot.accounts.some(a => a.id === id))) return undefined;
          if (ids.length) { snapshot.accounts = snapshot.accounts.filter(a => ids.includes(a.id)); snapshot.transactions = snapshot.transactions.filter(t => ids.includes(t.accountId)); }
          const financial = operationalFinancial(snapshot, day);
          if (end && c.bindings.some(b => b.dataset === 'balances' && b.confirmed)) {
            const balances = operationalFinancial(await readFintabloPeriodBalances(end, { fintabloBaseUrl: c.config.baseUrl || 'https://api.fintablo.ru', fintabloToken: secrets.token || '' }, ids), day);
            Object.assign(financial, { account: balances.account, wallet: balances.wallet, deposit: balances.deposit, total: balances.total });
          }
          return financial;
        } catch { return undefined; }
      }));
      for (const dataset of ['balances', 'cash'] as const) {
        const candidates = saved.flatMap((c, index) => c.bindings.filter(b => b.dataset === dataset && b.confirmed).map(binding => ({ binding, value: values[index], name: c.name })));
        // Resolve the same source priority once, then expose its distinct account buckets.
        // Cash merge uses transaction identity rather than adding aggregate metrics.
        const value = resolveValues(candidates.map(c => ({ ...c, binding: { ...c.binding, mode: c.binding.mode === 'merge' ? 'primary' : c.binding.mode } as Binding }))) as OperationalFinancial | undefined;
        if (candidates.some(c => c.binding.mode === 'merge')) {
          if (dataset === 'cash') result.receipts = missingMetric('Для ДДС настроено объединение источников; отдельный итог выручки не подтверждён без проверки повторов операций.', 'FinTablo');
          continue;
        }
        if (value && dataset === 'balances') Object.assign(result, { account: value.account, wallet: value.wallet, deposit: value.deposit, total: value.total });
        if (value && dataset === 'cash') result.receipts = value.receipts;
      }
      return result;
    }
    const settings = getSourceSettings();
    if (settings.fintabloEnabled && settings.fintabloToken) {
      const result = operationalFinancial(await readFintablo(day, day), day);
      if (end) { const balances = operationalFinancial(await readFintabloPeriodBalances(end), day); Object.assign(result, { account: balances.account, wallet: balances.wallet, deposit: balances.deposit, total: balances.total }); }
      return result;
    }
  } catch { /* A missing operational source must not break the existing dashboard. */ }
  return result;
}
