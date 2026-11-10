import { createHash } from 'node:crypto';
/** Stable content identity: ordering of object keys and transport sync times are not data changes. */
export function contentHash(value: unknown): string {
  function canonical(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'syncedAt').sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)]));
    return item;
  }
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
// Bump explicitly whenever formulas, exclusions or interpretation of source fields change.
export const CALCULATION_VERSION = 'dashboard-2026-09-28-v1';

/** Compare facts rather than read timestamps; preserve all receivables detail and archive series. */
export function reportContentHash(value: unknown): string {
  function facts(item: unknown, root = false): unknown {
    if (Array.isArray(item)) return item.map(child => facts(child));
    if (!item || typeof item !== 'object') return item;
    const row = item as Record<string, unknown>;
    const dashboard = Array.isArray(row.cash) && Array.isArray(row.orders);
    return Object.fromEntries(Object.entries(row).filter(([key, child]) =>
      !['updatedAt', 'syncedAt', 'checkedAt', 'freshness', 'dataAsOf'].includes(key) &&
      !(root && key === 'archive') && !(dashboard && key === 'sources') &&
      !(key === 'date' && 'reason' in row && 'value' in row && typeof child === 'string' && child.includes('T'))
    ).map(([key, child]) => [key, facts(child)]));
  }
  return contentHash(facts(value, true));
}
