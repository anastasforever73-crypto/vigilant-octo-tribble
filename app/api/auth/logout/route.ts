import { NextRequest } from 'next/server';
import { cookieOptions, guard, json, SESSION_COOKIE } from '@/app/lib/auth';
export async function POST(request: NextRequest) {
  const denied = guard(request); if (denied) return denied;
  const response = json({ authenticated: false });
  response.cookies.set(SESSION_COOKIE, '', { ...cookieOptions, maxAge: 0 });
  // Remove cookies from the previous source-settings implementation as well.
  for (const name of ['mart_trade_admin', 'mart_trade_fintablo']) response.cookies.set(name, '', { ...cookieOptions, maxAge: 0 });
  return response;
}
