import 'server-only';
import { validAccountPassword, validLoginPassword } from './password-policy.mjs';
import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { redirect } from 'next/navigation';
import { trustedRequestOrigin } from './request-origin';
import { allSections, canView, type Role } from './user-access';
import { parseViewers, readRegistry, validHash, type Viewer } from './user-registry';
import type { Section } from './connections/model';

export type { Role } from './user-access';
export const SESSION_COOKIE = 'mart_trade_session';
const lifetime = 8 * 60 * 60;
type Account = { login: string; role: Role; passwordHash: string; enabled: boolean; sections: Section[]; revision?: string };
export type Session = { login: string; role: Role; exp: number; nonce: string; version: string; sections: Section[] };
function secret() { const value = process.env.AUTH_SECRET || ''; return value.length >= 32 ? value : ''; }
function signature(value: string) { return createHmac('sha256', secret()).update(value).digest('base64url'); }
function equal(a: string, b: string) { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
function version(account: Account) { return signature(`${account.role}:${account.login}:${account.passwordHash}` + (account.role === 'user' ? `:${JSON.stringify(account.sections)}:${account.enabled}:${account.revision || ''}` : '')); }
export function createSession(role: Role, login?: string, viewers?: Viewer[]) {
  const account = accounts(viewers)?.find(account => account.enabled && account.role === role && (login === undefined || account.login === login));
  if (!secret() || !account) throw new Error('AUTH_NOT_CONFIGURED');
  const payload = Buffer.from(JSON.stringify({ login: account.login, role, exp: Math.floor(Date.now() / 1000) + lifetime, nonce: randomBytes(24).toString('base64url'), version: version(account) })).toString('base64url');
  return `${payload}.${signature(payload)}`;
}
export function verifySession(value?: string, viewers?: Viewer[]): Session | null {
  if (!secret() || !value || value.length > 2048) return null;
  const [payload, mac, extra] = value.split('.');
  if (!payload || !mac || extra || !equal(mac, signature(payload))) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Session;
    if (!['admin', 'user'].includes(s.role) || !Number.isInteger(s.exp) || s.exp <= Date.now() / 1000 || s.exp > Date.now() / 1000 + lifetime) return null;
    const legacy = typeof s.login !== 'string';
    const account = findAccount(legacy ? process.env[`${s.role.toUpperCase()}_LOGIN`] || '' : s.login, viewers);
    if (!account?.enabled || account.role !== s.role) return null;
    // Accept already signed Timeweb demo sessions only while their original account remains unchanged.
    const legacyVersion = legacy && isLegacyAccount(account, viewers ?? (s.role === 'admin' ? [] : parseViewers(process.env.DASHBOARD_USERS_JSON || '[]')))
      ? signature(`${account.role}:${account.login}:${account.passwordHash}`) : null;
    if (legacy ? !legacyVersion || s.version !== legacyVersion : s.version !== version(account)) return null;
    return { ...s, login: account.login, sections: account.sections };
  } catch { return null; }
}
export const cookieOptions = { httpOnly: true, secure: true, sameSite: 'strict' as const, path: '/', maxAge: lifetime };
export async function resolveSession(value?: string): Promise<Session | null> {
  if (!value || value.length > 2048 || !secret()) return null;
  const [payload, mac, extra] = value.split('.');
  if (!payload || !mac || extra || !equal(mac, signature(payload))) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (claims.role === 'admin') return verifySession(value, []);
    if (claims.role !== 'user' || !Number.isInteger(claims.exp) || claims.exp <= Date.now() / 1000) return null;
    return verifySession(value, (await readRegistry()).users);
  } catch { return null; }
}
const sessions = new WeakMap<NextRequest, Promise<Session | null>>();
export function requestSession(request: NextRequest) {
  let result = sessions.get(request);
  if (!result) { result = resolveSession(request.cookies.get(SESSION_COOKIE)?.value); sessions.set(request, result); }
  return result;
}
export async function requirePageSession() {
  const session = await resolveSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) redirect('/login');
  return session;
}
export function json(body: unknown, status = 200) { return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' } }); }
export async function guard(request: NextRequest, role?: Role, section?: Section) {
  const s = await requestSession(request);
  if (!s) return json({ error: 'Требуется вход' }, 401);
  if (role && s.role !== role) return json({ error: 'Требуется роль администратора' }, 403);
  if (section && !canView(s, section)) return json({ error: 'Раздел недоступен' }, 403);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !trustedRequestOrigin(request)) return json({ error: 'Недопустимый источник запроса' }, 403);
  return null;
}
// Keep existing single-user settings compatible; additional accounts are always viewers.
// Invalid or duplicate entries fail closed rather than silently granting ambiguous access.
function accounts(viewers?: Viewer[]): Account[] | null {
  const result: Account[] = [];
  const add = (login: unknown, passwordHash: unknown, role: Role) => {
    if (typeof login !== 'string' || !login.trim() || login !== login.trim() || login.length > 200 ||
        typeof passwordHash !== 'string' || !validHash(passwordHash) || result.some(account => account.login === login)) return false;
    result.push({ login, passwordHash, role, enabled: true, sections: [...allSections] });
    return true;
  };
  if (!add(process.env.ADMIN_LOGIN, process.env.ADMIN_PASSWORD_HASH, 'admin')) return null;
  try {
    const users = viewers ?? parseViewers(process.env.DASHBOARD_USERS_JSON || '[]');
    // A managed entry takes precedence over the legacy viewer, including disabling it.
    if (!users.some(user => user.login === process.env.USER_LOGIN) && (process.env.USER_LOGIN || process.env.USER_PASSWORD_HASH)) add(process.env.USER_LOGIN, process.env.USER_PASSWORD_HASH, 'user');
    for (const user of users) result.push({ ...user, role: 'user' });
  } catch { /* A broken viewer registry must not lock out the administrator. */ }
  return result;
}
export function findAccount(login: string, viewers?: Viewer[]) { return accounts(viewers)?.find(account => account.login === login); }
export function authConfigured() { return Boolean(secret() && accounts()); }
export async function hashPin(pin: string) {
  if (!validAccountPassword(pin)) throw new Error('Пароль должен содержать от 8 до 128 символов или PIN из 4 цифр.');
  const salt = randomBytes(16);
  const key = await new Promise<Buffer>((resolve, reject) => scrypt(pin, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
  return `scrypt$32768$8$3$${salt.toString('hex')}$${key.toString('hex')}`;
}
export function isLegacyAccount(account: Account | undefined, viewers: Viewer[] = []) {
  return Boolean(account && account.login === process.env[`${account.role.toUpperCase()}_LOGIN`]
    && account.passwordHash === process.env[`${account.role.toUpperCase()}_PASSWORD_HASH`]
    && (account.role === 'admin' || !viewers.some(user => user.login === account.login)));
}
export async function verifyPassword(password: string, hash: string, allowLegacyPassword = false) {
  if (!validHash(hash) || !(allowLegacyPassword ? validLoginPassword(password) : validAccountPassword(password))) return false;
  const parts = hash.split('$');
  const derived = await new Promise<Buffer>((resolve, reject) => scrypt(password, Buffer.from(parts[4], 'hex'), 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
  return timingSafeEqual(derived, Buffer.from(parts[5], 'hex'));
}
