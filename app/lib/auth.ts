import 'server-only';
import { validPassword } from './password-policy.mjs';
import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { redirect } from 'next/navigation';
import { trustedRequestOrigin } from './request-origin';

export type Role = 'user' | 'admin';
export const SESSION_COOKIE = 'mart_trade_session';
const lifetime = 8 * 60 * 60;
export type Session = { role: Role; exp: number; nonce: string; version: string };
function secret() { const value = process.env.AUTH_SECRET || ''; return value.length >= 32 ? value : ''; }
function signature(value: string) { return createHmac('sha256', secret()).update(value).digest('base64url'); }
function equal(a: string, b: string) { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
function version(role: Role) { return signature(`${role}:${process.env[`${role.toUpperCase()}_LOGIN`] || ''}:${process.env[`${role.toUpperCase()}_PASSWORD_HASH`] || ''}`); }
export function createSession(role: Role) {
  if (!secret()) throw new Error('AUTH_NOT_CONFIGURED');
  const payload = Buffer.from(JSON.stringify({ role, exp: Math.floor(Date.now() / 1000) + lifetime, nonce: randomBytes(24).toString('base64url'), version: version(role) })).toString('base64url');
  return `${payload}.${signature(payload)}`;
}
export function verifySession(value?: string): Session | null {
  if (!secret() || !value || value.length > 2048) return null;
  const [payload, mac, extra] = value.split('.');
  if (!payload || !mac || extra || !equal(mac, signature(payload))) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Session;
    if (!['admin', 'user'].includes(s.role) || !Number.isInteger(s.exp) || s.exp <= Date.now() / 1000 || s.exp > Date.now() / 1000 + lifetime || s.version !== version(s.role)) return null;
    return s;
  } catch { return null; }
}
export const cookieOptions = { httpOnly: true, secure: true, sameSite: 'strict' as const, path: '/', maxAge: lifetime };
export async function requirePageSession() {
  const session = verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) redirect('/login');
  return session;
}
export function json(body: unknown, status = 200) { return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' } }); }
export function guard(request: NextRequest, role?: Role) {
  const s = verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!s) return json({ error: 'Требуется вход' }, 401);
  if (role && s.role !== role) return json({ error: 'Требуется роль администратора' }, 403);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !trustedRequestOrigin(request)) return json({ error: 'Недопустимый источник запроса' }, 403);
  return null;
}
export function authConfigured() {
  return Boolean(secret() && process.env.USER_LOGIN && process.env.ADMIN_LOGIN && process.env.USER_LOGIN !== process.env.ADMIN_LOGIN && validHash(process.env.USER_PASSWORD_HASH || '') && validHash(process.env.ADMIN_PASSWORD_HASH || ''));
}
function validHash(hash: string) { return /^scrypt\$32768\$8\$3\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(hash); }
export async function verifyPassword(password: string, hash: string) {
  if (!validHash(hash) || !validPassword(password)) return false;
  const parts = hash.split('$');
  const derived = await new Promise<Buffer>((resolve, reject) => scrypt(password, Buffer.from(parts[4], 'hex'), 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
  return timingSafeEqual(derived, Buffer.from(parts[5], 'hex'));
}
