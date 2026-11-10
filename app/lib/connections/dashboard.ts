import { withSourceArchive } from '../source-input-archive';
import { adapters } from './adapters';
import { getConnection } from './store';
import 'server-only';
import type { DashboardData } from '../dashboard-data';
import { listConnections, snapshots, recordSync } from './store';
import { syncConnection } from './sync';
import { composeConnections } from './compose';
export async function withConnections(base: DashboardData, start: string, end: string, refresh = false, readOnly = false) {
  if (!process.env.DATABASE_URL) return base;
  try {
    const connections = await listConnections();
    const cached = await snapshots(start, end);
    if (readOnly) {
      // Viewer requests may derive another interval from archived detail, but may not import or sync.
      await Promise.allSettled(connections.filter(c => c.enabled && c.bindings.length && !cached.has(c.id)).map(async c => {
        const { secrets } = await getConnection(c.id);
        const data = await withSourceArchive(false, () => adapters[c.type].read(c, secrets, start, end), true);
        cached.set(c.id, { ...data, syncedAt: c.lastSuccess || base.updatedAt || '' });
      }));
      return composeConnections(base, connections, cached);
    }
    if (!readOnly) {
      await Promise.allSettled(connections.filter(c => c.enabled && c.type === 'debt' && !c.bindings.length).map(c => base.receivables?.current && !base.receivables.current.partial ? recordSync(c, start, end, {}) : recordSync(c, start, end, undefined, base.receivables?.configurationError || 'Не все листы дебиторки доступны')));
      await Promise.allSettled(connections.filter(c => c.enabled && c.bindings.length && (refresh || !cached.has(c.id))).map(c => syncConnection(c.id, start, end)));
    }
    return composeConnections(base, await listConnections(), await snapshots(start, end));
  }
  catch {
    return { ...base, sources: { ...base.sources, connections: { name: 'Сохранённые подключения', configured: true, available: false, status: 'storage_unavailable', error: 'Сохранённые источники недоступны. Администратору нужно проверить серверное хранилище.', freshness: 'Обновление не подтверждено' } } };
  }
}
