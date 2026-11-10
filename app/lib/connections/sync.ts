import { hasSourceArchive, withSourceArchive } from '../source-input-archive';
import 'server-only';
import { adapters, safeConnectionError } from './adapters';
import { ConnectionError } from './model';
import { getConnection, recordSync } from './store';
export async function syncConnection(id: string, start: string, end: string) {
  const { connection, secrets } = await getConnection(id);
  if (!connection.enabled) throw new ConnectionError('disabled', 'Источник отключён. Сначала включите его.');
  if (connection.type === 'debt' && !connection.bindings.length) {
    const report = await (await import('../read-receivables')).readReceivables();
    if (!report.current || report.current.partial) throw new ConnectionError('debt', report.configurationError || Object.values(report.errors).join('; ') || 'Дебиторка недоступна');
    await recordSync(connection, start, end, {});
    return { status: 'connected', message: 'Дебиторка обновлена из исходных листов', syncedAt: report.updatedAt };
  }
  if (!connection.bindings.length) throw new ConnectionError('mapping', 'Сначала подтвердите связи с разделами и соответствие полей');
  try {
    const read = () => adapters[connection.type].read(connection, secrets, start, end);
    const data = await (hasSourceArchive() ? read() : withSourceArchive(true, read));
    await recordSync(connection, start, end, data);
    return { status: 'connected', message: 'Данные получены и сохранены на сервере', syncedAt: new Date().toISOString() };
  } catch (error) {
    const safe = safeConnectionError(error);
    await recordSync(connection, start, end, undefined, safe.message);
    throw safe;
  }
}
