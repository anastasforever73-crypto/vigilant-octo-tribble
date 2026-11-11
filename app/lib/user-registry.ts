import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { postgres, storageEnabled } from './postgres';
import { allSections, validSections } from './user-access';
import type { Section } from './connections/model';

export type Viewer = { login: string; passwordHash: string; enabled: boolean; sections: Section[]; revision?: string };
export class UserRegistryError extends Error {
  constructor(message = 'Хранилище пользователей временно недоступно.', public status = 503) { super(message); }
}
export const validHash = (value: unknown): value is string => typeof value === 'string' && /^scrypt\$32768\$8\$3\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(value);
export const validLogin = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200 && value === value.trim() && !/[\x00-\x1f\x7f]/.test(value);
export function parseViewers(raw: string): Viewer[] {
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data) || data.length > 100) throw new Error();
    const logins = new Set<string>();
    return data.map(value => {
      if (!value || typeof value !== 'object' || !validLogin(value.login) || !validHash(value.passwordHash) ||
          value.login === process.env.ADMIN_LOGIN || (value.role !== undefined && value.role !== 'user') ||
          (value.enabled !== undefined && typeof value.enabled !== 'boolean') ||
          (value.sections !== undefined && !validSections(value.sections)) ||
          (value.revision !== undefined && (typeof value.revision !== 'string' || value.revision.length > 100)) || logins.has(value.login)) throw new Error();
      logins.add(value.login);
      return { login: value.login, passwordHash: value.passwordHash, enabled: value.enabled ?? true, sections: value.sections ?? [...allSections], ...(value.revision ? { revision: value.revision } : {}) };
    });
  } catch { throw new UserRegistryError('Некорректная конфигурация пользователей.'); }
}
export function registryConfigured() { return storageEnabled(); }
function legacyRegistryConfigured() {
  return Boolean(process.env.DASHBOARD_USERS_VERCEL_TOKEN && process.env.DASHBOARD_USERS_PROJECT_ID && process.env.DASHBOARD_USERS_ENV_ID && process.env.DASHBOARD_USERS_TEAM_ID);
}
function hasRegistrySettings() {
  return Boolean(process.env.DASHBOARD_USERS_VERCEL_TOKEN);
}
async function vercelEnv(method: 'GET' | 'PATCH', value?: string) {
  if (!legacyRegistryConfigured()) throw new UserRegistryError('Управление пользователями ещё не настроено.');
  if (process.env.VERCEL && process.env.VERCEL_ENV !== 'production') throw new UserRegistryError('Управление production-пользователями недоступно из preview.');
  const project = encodeURIComponent(process.env.DASHBOARD_USERS_PROJECT_ID!);
  const id = encodeURIComponent(process.env.DASHBOARD_USERS_ENV_ID!);
  const url = `https://api.vercel.com/${method === 'GET' ? 'v1' : 'v9'}/projects/${project}/env/${id}?teamId=${encodeURIComponent(process.env.DASHBOARD_USERS_TEAM_ID!)}`;
  try {
    const response = await fetch(url, { method, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000), headers: { Authorization: `Bearer ${process.env.DASHBOARD_USERS_VERCEL_TOKEN}`, 'Content-Type': 'application/json' }, ...(method === 'PATCH' ? { body: JSON.stringify({ value }) } : {}) });
    if (!response.ok) throw new Error();
    const env = await response.json();
    if (method === 'GET' && (env.key !== 'DASHBOARD_USERS_JSON' || env.type !== 'encrypted' || !Array.isArray(env.target) || env.target.length !== 1 || env.target[0] !== 'production' || typeof env.value !== 'string')) throw new Error();
    return env;
  } catch { throw new UserRegistryError(); }
}
function version(raw: string) { return createHash('sha256').update(raw).digest('hex'); }
async function legacyRaw(): Promise<string> {
  return hasRegistrySettings() ? (await vercelEnv('GET')).value as string : process.env.DASHBOARD_USERS_JSON || '[]';
}
function database() {
  if (!storageEnabled()) throw new UserRegistryError('Хранилище пользователей не настроено.');
  return postgres(process.env.DATABASE_URL || '', { statementTimeoutMs: 8000 });
}
export async function readRegistry() {
  try {
    if (!storageEnabled()) { const raw = await legacyRaw(); return { users: parseViewers(raw), version: version(raw) }; }
    let rows = await database()`SELECT value, revision FROM mart_user_registry WHERE id=1`;
    if (!rows.length) { await initializeRegistry(); rows = await database()`SELECT value, revision FROM mart_user_registry WHERE id=1`; }
    if (!rows.length) throw new UserRegistryError();
    return { users: parseViewers(rows[0].value), version: rows[0].revision as string };
  } catch (error) { throw error instanceof UserRegistryError ? error : new UserRegistryError(); }
}
/** Operator migration: import existing hashes once without overwriting managed users. */
export async function initializeRegistry() {
  const sql = database();
  if ((await sql`SELECT id FROM mart_user_registry WHERE id=1`).length) return;
  const raw = JSON.stringify(parseViewers(await legacyRaw()));
  await sql`INSERT INTO mart_user_registry(id,value,revision) VALUES(1,${raw},${version(raw)}) ON CONFLICT(id) DO NOTHING`;
}
export async function updateRegistry(expected: string, change: (users: Viewer[]) => Promise<Viewer[]>) {
  try {
    const sql = database();
    const current = await readRegistry();
    if (current.version !== expected) throw new UserRegistryError('Список пользователей изменился. Обновите список и повторите сохранение.', 409);
    const users = parseViewers(JSON.stringify(await change(current.users)));
    const raw = JSON.stringify(users), revision = randomUUID();
    if (Buffer.byteLength(raw) > 50000) throw new UserRegistryError('Превышен размер списка пользователей.', 422);
    const rows = await sql`UPDATE mart_user_registry SET value=${raw}, revision=${revision}, updated_at=now() WHERE id=1 AND revision=${expected} RETURNING revision`;
    if (!rows.length) throw new UserRegistryError('Список пользователей изменился. Обновите список и повторите сохранение.', 409);
    return { users, version: revision };
  } catch (error) { throw error instanceof UserRegistryError ? error : new UserRegistryError(); }
}
export const publicViewer = ({ login, enabled, sections }: Viewer) => ({ login, enabled, sections });
