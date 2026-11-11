import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { guard, hashPin, json } from '@/app/lib/auth';
import { validAccountPassword } from '@/app/lib/password-policy.mjs';
import { validSections } from '@/app/lib/user-access';
import { publicViewer, readRegistry, registryConfigured, updateRegistry, UserRegistryError, validLogin } from '@/app/lib/user-registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function failure(error: unknown) {
  return json({ error: error instanceof UserRegistryError ? error.message : 'Не удалось изменить пользователей.' }, error instanceof UserRegistryError ? error.status : 503);
}
export async function GET(request: NextRequest) {
  const denied = await guard(request, 'admin'); if (denied) return denied;
  try {
    const registry = await readRegistry();
    const legacy = process.env.USER_LOGIN && !registry.users.some(user => user.login === process.env.USER_LOGIN) ? { login: process.env.USER_LOGIN, legacy: true } : null;
    return json({ users: registry.users.map(publicViewer), version: registry.version, writable: registryConfigured(), legacy });
  } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  const denied = await guard(request, 'admin'); if (denied) return denied;
  if (request.nextUrl.search || request.headers.get('content-type')?.split(';')[0] !== 'application/json') return json({ error: 'Нужен JSON в теле запроса.' }, 400);
  if (Number(request.headers.get('content-length') || 0) > 4096) return json({ error: 'Слишком большой запрос.' }, 413);
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 4096) return json({ error: 'Слишком большой запрос.' }, 413);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: 'Некорректный JSON.' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || !['create', 'update'].includes(body.action) || !validLogin(body.login) || body.login === process.env.ADMIN_LOGIN ||
      typeof body.enabled !== 'boolean' || !validSections(body.sections) || typeof body.version !== 'string' ||
      (body.action === 'update' && !validLogin(body.originalLogin)) ||
      typeof body.pin !== 'string' || (body.pin !== '' && !validAccountPassword(body.pin)) || (body.action === 'create' && !validAccountPassword(body.pin)) ||
      Object.keys(body).some(key => !['action', 'login', 'originalLogin', 'pin', 'enabled', 'sections', 'version'].includes(key))) return json({ error: 'Проверьте логин, пароль (8–128 символов или PIN из 4 цифр) и доступные разделы.' }, 422);
  try {
    const saved = await updateRegistry(body.version, async users => {
      const current = body.action === 'update' ? users.find(user => user.login === body.originalLogin) : undefined;
      if (body.action === 'update' && !current) throw new UserRegistryError('Пользователь не найден.', 404);
      if (users.some(user => user.login === body.login && user !== current)) throw new UserRegistryError('Логин уже занят.', 409);
      if (current && current.login === process.env.USER_LOGIN && body.login !== current.login) throw new UserRegistryError('Логин прежнего пользователя нельзя изменить, пока задан USER_LOGIN.', 422);
      const viewer = { login: body.login, passwordHash: body.pin ? await hashPin(body.pin) : current!.passwordHash, enabled: body.enabled, sections: body.sections, revision: randomUUID() };
      return current ? users.map(user => user === current ? viewer : user) : [...users, viewer];
    });
    return json({ users: saved.users.map(publicViewer), version: saved.version, writable: true });
  } catch (error) { return failure(error); }
}
