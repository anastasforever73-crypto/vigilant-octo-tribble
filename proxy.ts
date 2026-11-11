import { NextRequest, NextResponse } from 'next/server';
import { requestSession, json, temporaryProxySession, SESSION_COOKIE } from '@/app/lib/auth';
import { canView } from '@/app/lib/user-access';
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path === '/login' || path === '/api/auth/login') return NextResponse.next();
  const session = temporaryProxySession(request.cookies.get(SESSION_COOKIE)?.value) || await requestSession(request);
  if (!session) {
    if (path.startsWith('/api/')) return json({ error: 'Требуется вход' }, 401);
    return NextResponse.redirect(new URL('/login', request.url));
  }
  if (session.role !== 'admin') {
    const adminPath = /^\/(settings|sources|users|admin)(\/|$)/.test(path);
    const adminApi = path.startsWith('/api/') && !['/api/dashboard', '/api/opiu', '/api/export', '/api/auth/logout'].includes(path);
    const mutation = path.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method) && path !== '/api/auth/logout';
    const section = path === '/balance' ? 'balance' : request.nextUrl.searchParams.get('tab');
    if (adminPath || adminApi || mutation || (section && !canView(session, section)) || (path === '/api/opiu' && !canView(session, 'opiu'))) return json({ error: 'Доступ запрещён' }, 403);
  }
  const response = NextResponse.next();
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.svg|build-info.json).*)'] };
