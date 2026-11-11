import 'server-only';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Pool } from 'pg';
import { poolConfig } from '../../scripts/lib/postgres.cjs';
import { temporaryTransaction } from '../../scripts/lib/runtime-storage.cjs';
import { temporaryStorage, storageEnabled, memoryStatus, environmentOverride, setEnvironmentOverride } from './postgres';
import { seal, unseal } from './connections/crypto';
import { parseViewers, readRegistry, validHash } from './user-registry';
import { parseWalletPercentage } from './wallet-percentage';
import { parseConnection, parseSecrets } from './connections/model';
import { BackupError } from './backup-codec';
const tables = ['mart_connections', 'mart_source_links', 'mart_source_snapshots', 'mart_source_runs', 'mart_dashboard_archive', 'mart_source_input_archive', 'mart_wallet_percentage', 'mart_user_registry'] as const;
type Table = typeof tables[number];
type Row = Record<string, unknown>;
type Data = Record<Table, Row[]>;
type Tx = { query(text: string, values?: unknown[]): Promise<{ rows: Row[] }> };
export const environmentKeys = ['GOOGLE_SHEET_ID', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY', 'DEBT_GOOGLE_SHEET_ID', 'DEBT_TRANSIT_SHEET', 'DEBT_STOCK_SHEET', 'GOOGLE_SHEETS_ENABLED', 'DEBT_ENABLED', 'FINTABLO_API_URL', 'FINTABLO_API_BASE_URL', 'FINTABLO_API_TOKEN', 'FINTABLO_ENABLED', 'CASH_SHEET', 'ORDERS_SHEET', 'DEBTOR_SHEET', 'FACTORY_SHEET', 'WALLET_SHEET', 'ACCOUNT_SHEET', 'DEBT_SHEET'] as const;
type Backup = { format: 'mart-application-state'; version: 1; createdAt: string; tables: Data; environment: Record<string, string>; legacyViewer?: { login: string; passwordHash: string } };
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
async function transaction<T>(write: boolean, fn: (tx: Tx) => Promise<T>, expectedRevision?: number): Promise<T> {
  if (!storageEnabled()) throw new BackupError('Включите временное хранилище или подключите PostgreSQL.', 503);
  if (temporaryStorage()) return temporaryTransaction(write, fn, expectedRevision);
  const pool = new Pool(poolConfig(process.env.DATABASE_URL!, { statementTimeoutMs: 60000 }));
  const client = await pool.connect();
  try { await client.query(`BEGIN ISOLATION LEVEL REPEATABLE READ ${write ? 'READ WRITE' : 'READ ONLY'}`); const value = await fn(client); await client.query('COMMIT'); return value; }
  catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); await pool.end(); }
}
async function readTables(tx: Tx): Promise<Data> {
  const result = {} as Data;
  for (const table of tables) {
    const row = (await tx.query(`SELECT COALESCE(json_agg(t ORDER BY row_to_json(t)::text), '[]'::json) AS data FROM ${table} t`)).rows[0];
    result[table] = row.data as Row[];
  }
  return result;
}
function context(table: Table, row: Row) {
  if (table === 'mart_connections') return String(row.id);
  if (table === 'mart_source_snapshots') return `${row.connection_id}:${row.period_start}:${row.period_end}`;
  return String(table === 'mart_dashboard_archive' ? row.archive_key : row.input_key);
}
function payloadField(table: Table) { return table === 'mart_connections' ? 'secrets' : ['mart_source_snapshots', 'mart_dashboard_archive', 'mart_source_input_archive'].includes(table) ? 'payload' : undefined; }
export function validateBackup(value: unknown): Backup {
  const fail = () => { throw new BackupError('Структура резервной копии некорректна.'); };
  if (!value || typeof value !== 'object') return fail();
  const b = value as Backup;
  if (b.format !== 'mart-application-state' || b.version !== 1 || !Number.isFinite(Date.parse(b.createdAt)) || !b.tables || !b.environment || Array.isArray(b.environment)) return fail();
  if (Object.keys(b.tables).sort().join() !== [...tables].sort().join() || tables.some(t => !Array.isArray(b.tables[t]) || b.tables[t].length > 200000 || b.tables[t].some(row => !row || typeof row !== 'object' || Array.isArray(row)))) return fail();
  if (Object.entries(b.environment).some(([k, v]) => !environmentKeys.includes(k as typeof environmentKeys[number]) || typeof v !== 'string' || v.length > 65536)) return fail();
  if (b.tables.mart_user_registry.length > 1 || b.tables.mart_user_registry.some(row => row.id !== 1 || typeof row.value !== 'string')) return fail();
  for (const row of b.tables.mart_user_registry) parseViewers(String(row.value));
  if (b.legacyViewer && (!validHash(b.legacyViewer.passwordHash) || typeof b.legacyViewer.login !== 'string')) return fail();
  for (const row of b.tables.mart_wallet_percentage) parseWalletPercentage({ percent: Number(row.percent), effectiveFrom: row.effective_from });
  const ids = new Set<string>();
  for (const row of b.tables.mart_connections) {
    if (typeof row.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(row.id) || ids.has(row.id) || !Number.isInteger(row.revision) || Number(row.revision) < 1) return fail();
    ids.add(row.id);
    const bindings = b.tables.mart_source_links.filter(link => link.connection_id === row.id).map(link => link.definition);
    parseConnection({ name: row.name, type: row.type, enabled: row.enabled, config: row.config, bindings }); parseSecrets(row.secrets);
  }
  if (b.tables.mart_source_links.some(row => !ids.has(String(row.connection_id)))) return fail();
  return b;
}
export function summary(b: Backup) { return { createdAt: b.createdAt, users: b.tables.mart_user_registry.reduce((n, row) => n + parseViewers(String(row.value)).length, 0) + (b.legacyViewer ? 1 : 0), connections: b.tables.mart_connections.length, rates: b.tables.mart_wallet_percentage.length, snapshots: b.tables.mart_source_snapshots.length, reports: b.tables.mart_dashboard_archive.length, sourceArchives: b.tables.mart_source_input_archive.length, environmentIncluded: Object.keys(b.environment).length > 0 }; }
export async function exportState() {
  await readRegistry();
  const revision = memoryStatus().revision;
  const raw = await transaction(false, readTables);
  const data = structuredClone(raw);
  for (const table of tables) { const field = payloadField(table); if (field) for (const row of data[table]) if (row[field] != null) row[field] = unseal(String(row[field]), context(table, row)); }
  const env = { ...process.env, ...environmentOverride() };
  const environment = Object.fromEntries(environmentKeys.filter(k => typeof env[k] === 'string').map(k => [k, env[k]!])) as Record<string, string>;
  const managed = data.mart_user_registry.flatMap(row => parseViewers(String(row.value)));
  const legacyHash = (process.env.USER_PASSWORD_HASH || '').replace(/\\\$/g, '$');
  const b: Backup = { format: 'mart-application-state', version: 1, createdAt: new Date().toISOString(), tables: data, environment, ...(process.env.USER_LOGIN && validHash(legacyHash) && !managed.some(u => u.login === process.env.USER_LOGIN) ? { legacyViewer: { login: process.env.USER_LOGIN, passwordHash: legacyHash } } : {}) };
  validateBackup(b); return { backup: b, revision };
}
function sign(value: string) { if (!process.env.AUTH_SECRET) throw new BackupError('Авторизация не настроена.', 503); return createHmac('sha256', process.env.AUTH_SECRET).update(value).digest('hex'); }
function environmentMatches(backup: Backup) { return Object.entries(backup.environment).every(([key, value]) => process.env[key] === value); }
export async function previewState(backup: Backup, fileDigest: string, sessionNonce: string) {
  const revision = memoryStatus().revision;
  const currentDigest = await transaction(false, async tx => hash(await readTables(tx)));
  const payload = Buffer.from(JSON.stringify({ digest: fileDigest, currentDigest, revision, nonce: sessionNonce, exp: Date.now() + 5 * 60000 })).toString('base64url');
  return { summary: summary(backup), token: payload + '.' + sign(payload), environmentRestore: temporaryStorage() ? 'temporary' : environmentMatches(backup) ? 'matched' : 'manual', temporary: temporaryStorage() };
}
export async function restoreState(backup: Backup, fileDigest: string, token: unknown, sessionNonce: string) {
  if (typeof token !== 'string' || token.length > 2048) throw new BackupError('Повторите предварительный просмотр.');
  let claims;
  try { const [payload, mac, extra] = token.split('.'); const expected = sign(payload); if (extra || !mac || mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) throw new Error(); claims = JSON.parse(Buffer.from(payload, 'base64url').toString()); if (claims.exp < Date.now() || claims.digest !== fileDigest || claims.nonce !== sessionNonce || !Number.isInteger(claims.revision)) throw new Error(); } catch { throw new BackupError('Подтверждение истекло или файл изменился. Повторите предварительный просмотр.'); }
  if (!temporaryStorage() && !environmentMatches(backup)) throw new BackupError('Эта копия содержит серверные переменные. Для восстановления в PostgreSQL сначала перенесите их в настройки хостинга.', 409);
  await transaction(true, async tx => {
    await tx.query(`LOCK TABLE ${tables.join(',')} IN ACCESS EXCLUSIVE MODE`);
    const current = await readTables(tx);
    if (hash(current) !== claims.currentDigest) throw new BackupError('Данные изменились. Повторите предварительный просмотр.', 409);
    const restored = structuredClone(backup.tables);
    let users = restored.mart_user_registry.flatMap(row => parseViewers(String(row.value)));
    if (backup.legacyViewer && !users.some(u => u.login === backup.legacyViewer!.login)) users = parseViewers(JSON.stringify([...users, { ...backup.legacyViewer, enabled: true, sections: ['overview','cash','opiu','balance','debt','sales','goods','logistics','plan'] }]));
    restored.mart_user_registry = [{ id: 1, value: JSON.stringify(users.map(u => ({ ...u, revision: randomUUID() }))), revision: randomUUID(), updated_at: new Date().toISOString() }];
    for (const row of restored.mart_connections) { row.revision = Math.max(Number(row.revision), Number(current.mart_connections.find(c => c.id === row.id)?.revision || 0)) + 1; row.write_token = randomUUID(); }
    for (const row of restored.mart_source_snapshots) row.revision = restored.mart_connections.find(c => c.id === row.connection_id)?.revision;
    for (const table of tables) for (const row of restored[table]) { const field = payloadField(table); if (field && row[field] != null) row[field] = seal(row[field], context(table, row)); if ('lease_token' in row) row.lease_token = null; if ('lease_until' in row) row.lease_until = null; }
    for (const table of [...tables].reverse()) await tx.query(`DELETE FROM ${table}`);
    for (const table of tables) if (restored[table].length) {
      const columns = (await tx.query('SELECT column_name FROM information_schema.columns WHERE table_schema=\'public\' AND table_name=$1 ORDER BY ordinal_position', [table])).rows.map(r => String(r.column_name));
      if (restored[table].some(row => Object.keys(row).some(k => !columns.includes(k)))) throw new BackupError('В копии есть неизвестные поля.');
      await tx.query(`INSERT INTO ${table} (${columns.join(',')}) OVERRIDING SYSTEM VALUE SELECT ${columns.join(',')} FROM json_populate_recordset(NULL::${table}, $1::json)`, [JSON.stringify(restored[table])]);
    }
    for (const table of ['mart_source_links','mart_source_runs']) await tx.query(`SELECT setval(pg_get_serial_sequence('${table}','id'), GREATEST(COALESCE((SELECT MAX(id) FROM ${table}), 0),1), COALESCE((SELECT MAX(id) FROM ${table}),0)>0)`);
  }, claims.revision);
  if (temporaryStorage()) setEnvironmentOverride(backup.environment);
}
