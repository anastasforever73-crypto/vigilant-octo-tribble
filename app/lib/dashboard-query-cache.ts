import type { DashboardData } from './dashboard-data';
import { MemoryCache } from './memory-cache';
import { period } from './source-values';

/** Reuse only provable coverage. Stocks require the SAME end date; viewer debtPayments
 * is already aggregated by the server and cannot be re-aggregated in the browser. */
export function coveredDashboard(data: DashboardData, start: string, end: string): DashboardData | undefined {
  const p = period(new URLSearchParams({ start, end }));
  // Plan totals and the operational forecast are aggregates of the exact selected interval.
  if (data.nlpkHistory || data.operational?.payables?.comparison || data.planningSummary || data.operational?.planningPeriod || data.sections?.cash?.planningSummary) return;
  if (!data.period || data.period.end !== end || data.period.comparisonStart > p.comparisonStart || data.debtPayments !== undefined) return;
  return { ...data, period: p };
}
export class DashboardQueryCache {
  private memory = new MemoryCache<DashboardData>(32 * 1024 * 1024, 12);
  private pending = new Map<string, Promise<DashboardData | undefined>>();
  private epoch = 0;
  private version?: string;
  constructor(readonly scope: string) {}
  private key(start: string, end: string) { return JSON.stringify([this.scope, this.version, start, end]); }
  get(start: string, end: string) {
    const exact = this.memory.get(this.key(start, end));
    if (exact) return exact;
    for (const value of this.memory.values()) {
      const covered = coveredDashboard(value, start, end);
      if (covered) return covered;
    }
  }
  clear() { this.epoch++; this.memory.clear(); this.pending.clear(); this.version = undefined; }
  async load(start: string, end: string, options: { force?: boolean; prefetch?: boolean; revalidate?: boolean } = {}) {
    if (!options.force && !options.revalidate) { const hit = this.get(start, end); if (hit) return hit; }
    if (options.force) this.clear();
    const flight = JSON.stringify([start, end, Boolean(options.force), Boolean(options.prefetch)]);
    const existing = this.pending.get(flight);
    if (existing) return existing;
    const epoch = this.epoch;
    const promise = (async () => {
      const query = new URLSearchParams({ start, end });
      if (options.prefetch) query.set('archiveOnly', '1');
      if (options.revalidate) query.set('maintenance', '1');
      const response = await fetch(`/api/dashboard?${query}`, { method: options.force ? 'POST' : 'GET', cache: 'no-store', credentials: 'same-origin' });
      if (response.status === 401 || response.status === 403) { this.clear(); window.location.replace('/login'); throw new Error('Сессия завершена'); }
      if (response.status === 204) return;
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Данные недоступны');
      if (epoch !== this.epoch) return;
      const data = payload as DashboardData;
      const version = data.archive?.cacheVersion || data.archive?.sourceVersion;
      // Do not retain partial imports, failures or unidentified source versions.
      if (version && data.archive?.createdAt) {
        if (this.version && this.version !== version) this.memory.clear();
        this.version = version;
        this.memory.set(this.key(start, end), data);
      }
      return data;
    })();
    this.pending.set(flight, promise);
    try { return await promise; } finally { if (this.pending.get(flight) === promise) this.pending.delete(flight); }
  }
}

/** At most two neighbouring months; prefetch never starts a source import. */
export function neighbourMonths(start: string) {
  return [-1, 1].map(offset => {
    const date = new Date(`${start.slice(0, 7)}-01T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + offset);
    const from = date.toISOString().slice(0, 10);
    date.setUTCMonth(date.getUTCMonth() + 1, 0);
    return { start: from, end: date.toISOString().slice(0, 10) };
  });
}
