import { NextRequest, NextResponse } from 'next/server';
import { authConfigured, cookieOptions, createSession, json, SESSION_COOKIE, verifyPassword, findAccount, isLegacyAccount } from '@/app/lib/auth';
import { trustedRequestOrigin } from '@/app/lib/request-origin';
import { readRegistry, type Viewer } from '@/app/lib/user-registry';
import { reserveLoginAttempt } from '@/app/lib/login-limiter';
type Attempt = { count: number; blockedUntil: number; pending: Promise<void> };
// Bounded account buckets. A shared persistent store is required across server instances.
const attempts = new Map<string, Attempt>();
const lockoutMs = 15 * 60 * 1000;
export async function POST(request: NextRequest) {
  const contentType = request.headers.get('content-type')?.split(';')[0].trim();
  const nativeForm = contentType === 'application/x-www-form-urlencoded';
  const origin = trustedRequestOrigin(request);
  const redirect = (path: string) => {
    const response = NextResponse.redirect(new URL(path, origin || request.url), 303);
    response.headers.set('Cache-Control', 'private, no-store, max-age=0');
    response.headers.set('Referrer-Policy', 'strict-origin');
    return response;
  };
  const fail = (error: string, status: number) => {
    console.info('AUTH_LOGIN', JSON.stringify({ outcome: 'rejected', status, format: nativeForm ? 'form' : 'json' }));
    return nativeForm ? redirect('/login?error=auth') : json({ error }, status);
  };
  if (!origin) {
    console.info('AUTH_LOGIN', JSON.stringify({ outcome: 'origin_rejected', status: 403 }));
    return json({ error: 'Недопустимый источник запроса' }, 403);
  }
  if (!authConfigured()) return fail('Вход ещё не настроен. Обратитесь к владельцу дашборда.', 503);
  if (Number(request.headers.get('content-length') || 0) > 4096) return fail('Слишком большой запрос', 413);
  // Credentials are accepted only from the POST body, never from query parameters.
  if (request.nextUrl.search) return fail('Параметры URL недопустимы', 400);
  if (!nativeForm && contentType !== 'application/json') return fail('Неподдерживаемый формат запроса', 415);
  const body: unknown = nativeForm
    ? await request.formData().then(data => ({ login: data.get('login'), password: data.get('password') })).catch(() => null)
    : await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || !('login' in body) || !('password' in body) || typeof body.login !== 'string' || typeof body.password !== 'string' || body.login.length > 200 || body.password.length > 1024) return fail('Укажите логин и пароль', 400);
  let viewers: Viewer[] = [];
  if (body.login !== process.env.ADMIN_LOGIN) {
    try { viewers = (await readRegistry()).users; }
    catch { return fail('Вход временно недоступен. Повторите позже.', 503); }
  }
  const account = findAccount(body.login, viewers);
  let reservation: Awaited<ReturnType<typeof reserveLoginAttempt>> = null;
  try { reservation = await reserveLoginAttempt(account ? account.login : 'unknown'); }
  catch { return fail('Вход временно недоступен. Повторите позже.', 503); }
  if (reservation && reservation.count > 5) {
    const response = fail('Слишком много попыток. Повторите через 15 минут.', 429);
    response.headers.set('Retry-After', String(reservation.retryAfter));
    return response;
  }
  const key = account ? `account:${account.login}` : 'unknown';
  const attempt = attempts.get(key) || { count: 0, blockedUntil: 0, pending: Promise.resolve() };
  attempts.set(key, attempt);
  // Serialize verification per bucket so concurrent requests cannot bypass the fifth failure.
  const previous = attempt.pending;
  let release!: () => void;
  attempt.pending = new Promise<void>(resolve => { release = resolve; });
  await previous;
  const blocked = () => {
    const response = fail('Слишком много попыток. Повторите через 15 минут.', 429);
    response.headers.set('Retry-After', String(Math.max(1, Math.ceil((attempt.blockedUntil - Date.now()) / 1000))));
    return response;
  };
  try {
    if (attempt.blockedUntil > Date.now()) return blocked();
    if (attempt.blockedUntil) { attempt.count = 0; attempt.blockedUntil = 0; }
    // Run the same expensive hash check for unknown logins, without exposing account existence.
    const hash = account?.passwordHash || process.env.ADMIN_PASSWORD_HASH!;
    if (!(await verifyPassword(body.password, hash, isLegacyAccount(account, viewers))) || !account?.enabled) {
      attempt.count++;
      if (attempt.count >= 5 || (reservation && reservation.count >= 5)) { attempt.blockedUntil = Date.now() + lockoutMs; return blocked(); }
      return fail('Неверный логин или пароль', 401);
    }
    attempt.count = 0;
    if (reservation) {
      try { await reservation.reset(); } catch { return fail('Вход временно недоступен. Повторите позже.', 503); }
    }
    const role = account.role;
    const response = nativeForm ? redirect('/') : json({ authenticated: true, role });
    response.cookies.set(SESSION_COOKIE, createSession(role, account.login, viewers), cookieOptions);
    console.info('AUTH_LOGIN', JSON.stringify({ outcome: 'authenticated', status: nativeForm ? 303 : 200, role }));
    return response;
  } finally { release(); }
}
