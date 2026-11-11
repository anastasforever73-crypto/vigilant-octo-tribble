import { NLPK_HISTORY_SHEET, isNlpkHistory } from '../nlpk-payables';
import { bindingKey } from './merge';
import { contentHash } from '../archive-version';
import 'server-only';
import { randomUUID } from 'node:crypto';
import { postgres, temporaryStorage } from '../postgres';
import { seal, unseal } from './crypto';
import { storageConfiguration, storageFailure } from './storage-health';
import { conflictIssues, maskedSecrets, ConnectionError, type Binding, type Connection, type ConnectionInput, type Secrets, type StoredData, type StorageStatus } from './model';
function database() {
  const issue = temporaryStorage() ? undefined : storageConfiguration();
  if (issue) throw new ConnectionError(issue.code!, issue.message, 503);
  return postgres(process.env.DATABASE_URL!, { statementTimeoutMs: 15000 });
}
function dbError(error: unknown): never {
  if (error instanceof ConnectionError) throw error;
  const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
  if (code === '23505' || code === '40001') throw new ConnectionError('conflict', 'Для показателя уже выбран другой источник. Выберите приоритетный источник и повторите сохранение.', 409);
  const issue = storageFailure(error);
  throw new ConnectionError(issue.code!, issue.message, 503);
}
export async function storageStatus(): Promise<StorageStatus> {
  if (temporaryStorage()) { await database()`SELECT 1`; return { available: true, mode: 'temporary', checks: { database: 'ready', migration: 'ready', encryption: 'ready' }, message: 'Временное хранилище в памяти. После перезапуска данные исчезнут. Скачивайте резервную копию после изменений.' }; }
  const checks: NonNullable<StorageStatus['checks']> = { database: 'unchecked', migration: 'unchecked', encryption: 'unchecked' };
  const key = process.env.CONNECTIONS_ENCRYPTION_KEY;
  checks.encryption = !key ? 'missing' : /^[a-f0-9]{64}$/i.test(key) && key !== process.env.AUTH_SECRET ? 'ready' : 'error';
  // Check infrastructure independently, even when the encryption key is missing.
  const issue = storageConfiguration({ ...process.env, CONNECTIONS_ENCRYPTION_KEY: '0'.repeat(64), AUTH_SECRET: undefined });
  if (issue) {
    checks.database = process.env.DATABASE_URL ? 'error' : 'missing';
    return { ...issue, checks };
  }
  try {
    const sql = postgres(process.env.DATABASE_URL!, { statementTimeoutMs: 15000 });
    await sql`SELECT 1`;
    checks.database = 'ready';
    await sql`SELECT c.id,c.name,c.type,c.enabled,c.revision,c.write_token,c.config,c.secrets,c.secret_fields,
      c.status,c.last_error,c.last_success,c.checked_at,c.created_at,
      l.section,l.dataset,l.definition,s.period_start,s.period_end,s.revision,s.payload,s.synced_at,
      r.id,r.status,r.message,r.created_at FROM mart_connections c
      LEFT JOIN mart_source_links l ON l.connection_id=c.id
      LEFT JOIN mart_source_snapshots s ON s.connection_id=c.id
      LEFT JOIN mart_source_runs r ON r.connection_id=c.id LIMIT 0`;
    checks.migration = 'ready';
    const configurationIssue = storageConfiguration();
    if (configurationIssue) return { ...configurationIssue, checks };
    return { available: true, checks, message: 'Система готова. Подключайте источники здесь: реквизиты, связи с вкладками и обновление данных управляются через панель.' };
  }
  catch (error) {
    const issue = storageFailure(error);
    if (checks.database === 'ready') checks.migration = issue.code === 'migration_required' ? 'missing' : 'error';
    else checks.database = 'error';
    return { ...issue, checks };
  }
}
type Row = Record<string, unknown>;
function publicView(row: Row): Connection {
  return {
    id: String(row.id), name: String(row.name), type: row.type as Connection['type'], enabled: Boolean(row.enabled), revision: Number(row.revision),
    config: row.config as Connection['config'], bindings: (row.bindings || []) as Connection['bindings'],
    status: String(row.status), error: row.last_error ? String(row.last_error) : undefined,
    lastSuccess: row.last_success ? new Date(String(row.last_success)).toISOString() : undefined,
    checkedAt: row.checked_at ? new Date(String(row.checked_at)).toISOString() : undefined,
    secretFields: row.secret_fields as string[],
    secretMasks: maskedSecrets(row.secret_fields as string[]),
  };
}
export async function listConnections(): Promise<Connection[]> {
  try {
    const rows = await database()`SELECT c.id,c.name,c.type,c.enabled,c.revision,c.config,c.status,c.last_error,c.last_success,c.checked_at,c.secret_fields,
      COALESCE(jsonb_agg(l.definition) FILTER (WHERE l.connection_id IS NOT NULL),'[]'::jsonb) AS bindings
      FROM mart_connections c LEFT JOIN mart_source_links l ON l.connection_id=c.id GROUP BY c.id ORDER BY c.created_at`;
    return rows.map(publicView);
  } catch (error) { dbError(error); }
}
export async function getConnection(id: string): Promise<{ connection: Connection; secrets: Secrets }> {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new ConnectionError('not_found', 'Подключение не найдено', 404);
  try {
    const rows = await database()`SELECT c.*, COALESCE(jsonb_agg(l.definition) FILTER (WHERE l.connection_id IS NOT NULL),'[]'::jsonb) AS bindings
      FROM mart_connections c LEFT JOIN mart_source_links l ON l.connection_id=c.id WHERE c.id=${id} GROUP BY c.id`;
    if (!rows[0]) throw new ConnectionError('not_found', 'Подключение не найдено', 404);
    return { connection: publicView(rows[0]), secrets: unseal<Secrets>(String(rows[0].secrets), id) };
  } catch (error) { dbError(error); }
}
export async function saveConnection(input: ConnectionInput, secrets: Secrets, id?: string, revision = 0, priority = false) {
  const sql = database(), identity = id || randomUUID(), token = randomUUID();
  if (id && (!/^[a-f0-9-]{36}$/i.test(id) || !Number.isInteger(revision) || revision < 1)) throw new ConnectionError('revision', 'Откройте актуальную версию подключения', 409);
  const others = (await listConnections()).filter(c => c.id !== identity);
  const issues = conflictIssues([...others, { ...input, bindings: input.bindings.map(b => priority ? { ...b, mode: 'primary' as const, priority: 0 } : b) }]);
  if (issues.length) throw new ConnectionError('conflict', issues.join(' '), 409);
  const encrypted = seal(secrets, identity), secretFields = JSON.stringify(Object.keys(secrets));
  const links = JSON.stringify(input.bindings.map(b => priority ? { ...b, mode: 'primary', priority: 0 } : b));
  try {
    const write = id
      ? sql`UPDATE mart_connections SET name=${input.name},enabled=${input.enabled},config=${JSON.stringify(input.config)}::jsonb,secrets=${encrypted},secret_fields=${secretFields}::jsonb,
          revision=revision+1,write_token=${token},status=${input.enabled ? 'needs_sync' : 'disabled'},last_error=NULL WHERE id=${identity} AND revision=${revision} AND type=${input.type} RETURNING id`
      : sql`INSERT INTO mart_connections(id,name,type,enabled,config,secrets,secret_fields,write_token,status) VALUES (${identity},${input.name},${input.type},${input.enabled},${JSON.stringify(input.config)}::jsonb,${encrypted},${secretFields}::jsonb,${token},${input.enabled ? 'not_checked' : 'disabled'}) RETURNING id`;
    const result = await sql.transaction([
      write,
      sql`DELETE FROM mart_source_links WHERE connection_id=${identity} AND EXISTS(SELECT 1 FROM mart_connections WHERE id=${identity} AND write_token=${token})`,
      sql`INSERT INTO mart_source_links(connection_id,section,dataset,definition)
        SELECT ${identity},b->>'section',b->>'dataset',b FROM jsonb_array_elements(${links}::jsonb) b
        WHERE EXISTS(SELECT 1 FROM mart_connections WHERE id=${identity} AND write_token=${token})`,
    ], { isolationLevel: 'Serializable' });
    if (!result[0].length) throw new ConnectionError('revision', 'Подключение изменилось. Откройте его заново.', 409);
    return (await getConnection(identity)).connection;
  } catch (error) { dbError(error); }
}
export async function removeConnection(id: string, revision: number) {
  try {
    const rows = await database()`DELETE FROM mart_connections WHERE id=${id} AND revision=${revision} RETURNING id`;
    if (!rows.length) throw new ConnectionError('revision', 'Подключение изменилось. Откройте его заново.', 409);
  } catch (error) { dbError(error); }
}
export async function recordCheck(c: Connection, status: string, error?: string) {
  try { await database()`UPDATE mart_connections SET checked_at=now(),status=${status},last_error=${error || null} WHERE id=${c.id} AND revision=${c.revision}`; }
  catch (e) { dbError(e); }
}
export async function recordSync(c: Connection, start: string, end: string, data?: StoredData, error?: string) {
  const sql = database();
  try {
    const operations = [
      sql`UPDATE mart_connections SET status=${error ? 'sync_error' : 'connected'},last_error=${error || null},last_success=CASE WHEN ${!error} THEN now() ELSE last_success END
        WHERE id=${c.id} AND revision=${c.revision} AND enabled=true RETURNING id`,
      sql`INSERT INTO mart_source_runs(connection_id,status,message) SELECT id,${error ? 'error' : 'success'},${error || null} FROM mart_connections WHERE id=${c.id} AND revision=${c.revision}`,
    ];
    if (data) operations.push(sql`INSERT INTO mart_source_snapshots(connection_id,period_start,period_end,revision,payload,content_hash)
      SELECT id,${start}::date,${end}::date,revision,${seal(data, `${c.id}:${start}:${end}`)},${contentHash(data)} FROM mart_connections WHERE id=${c.id} AND revision=${c.revision} AND enabled=true
      ON CONFLICT(connection_id,period_start,period_end) DO UPDATE SET revision=EXCLUDED.revision,payload=EXCLUDED.payload,content_hash=EXCLUDED.content_hash,synced_at=now()`);
    const result = await sql.transaction(operations);
    if (!result[0].length) throw new ConnectionError('revision', 'Настройки изменились во время обновления. Повторите синхронизацию.', 409);
  } catch (e) { dbError(e); }
}
export function nlpkSnapshotCompatible(bindings: Binding[], data: StoredData) {
  return bindings.every(b => b.sheet !== NLPK_HISTORY_SHEET || (b.dataset !== 'nlpkPayables' && b.dataset !== 'payables') || isNlpkHistory(data.byBinding?.[bindingKey(b)]));
}
export async function snapshots(start: string, end: string) {
  try {
    const rows = await database()`SELECT s.connection_id,s.payload,s.synced_at,COALESCE((SELECT jsonb_agg(l.definition) FROM mart_source_links l WHERE l.connection_id=c.id),'[]'::jsonb) AS bindings FROM mart_source_snapshots s JOIN mart_connections c ON c.id=s.connection_id AND c.revision=s.revision
      WHERE s.period_start=${start}::date AND s.period_end=${end}::date AND c.enabled=true`;
    return new Map(rows.flatMap(row => {
      const id = String(row.connection_id), data = unseal<StoredData>(String(row.payload), `${id}:${start}:${end}`);
      const bindings = (row.bindings || []) as Binding[];
      if (!nlpkSnapshotCompatible(bindings, data)) return [];
      return [[id, { ...data, syncedAt: new Date(String(row.synced_at)).toISOString() }] as const];
    }));
  } catch (error) { dbError(error); }
}
