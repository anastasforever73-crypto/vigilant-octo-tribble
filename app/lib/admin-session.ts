// Compatibility helper: all administrative routes use the common role-based session.
import 'server-only';
import { NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from './auth';
export function isAdminSession(request: NextRequest) { return verifySession(request.cookies.get(SESSION_COOKIE)?.value)?.role === 'admin'; }
