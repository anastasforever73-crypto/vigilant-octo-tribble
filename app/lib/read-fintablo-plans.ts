import 'server-only';
import type { DashboardData } from './dashboard-data';
import { readFintabloPlans } from './fintablo';
import { listConnections, getConnection } from './connections/store';
import { resolveValues } from './connections/merge';
/** Explicit planning bindings, including unavailable ones, always take precedence. */
export async function withNativeFintabloPlans(data: DashboardData, start: string, end: string): Promise<DashboardData> {
  if (data.sections?.plan || data.planReceipts !== undefined || data.planPayments !== undefined || !process.env.DATABASE_URL) return data;
  try {
    const connections = (await listConnections()).filter(c => c.enabled && c.type === 'fintablo');
    const values = await Promise.all(connections.map(async c => {
      if (!c.bindings.some(b => b.confirmed && b.dataset === 'cash')) return undefined;
      try { const { secrets } = await getConnection(c.id); return await readFintabloPlans(start, end, { fintabloBaseUrl: c.config.baseUrl || 'https://api.fintablo.ru', fintabloToken: secrets.token || '' }, c.config.accountIds || []); }
      catch { return undefined; }
    }));
    const candidates = connections.flatMap((c, i) => c.bindings.filter(b => b.confirmed && b.dataset === 'cash').map(binding => ({ binding, value: binding.mode === 'merge' ? undefined : values[i], name: c.name })));
    const plans = resolveValues(candidates) as Awaited<ReturnType<typeof readFintabloPlans>> | undefined;
    return plans ? { ...data, ...plans, planningSource: 'FinTablo · плановые операции (isPlan=1) · источник ДДС' } : data;
  } catch { return data; }
}
