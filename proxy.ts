import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySession, json } from '@/app/lib/auth';
export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path === '/login' || path === '/api/auth/login') return NextResponse.next();
  if (!verifySession(request.cookies.get(SESSION_COOKIE)?.value)) {
    if (path.startsWith('/api/')) return json({ error: 'Требуется вход' }, 401);
    return NextResponse.redirect(new URL('/login', request.url));
  }
  const response = NextResponse.next();
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.svg).*)'] };
