import { ArchiveMiss } from '@/app/lib/period-archive';
import { verifyArchiveInBackground } from '@/app/lib/verify-archive-background';
import { NextRequest } from 'next/server';
import { guard, json, requestSession } from '@/app/lib/auth';
import { loadDashboard, dashboardArchiveSpec } from '@/app/lib/load-dashboard';
import { visibleDashboard } from '@/app/lib/dashboard-access';
export const runtime = 'nodejs';
export const maxDuration = 240;
export const dynamic = 'force-dynamic';
async function read(request: NextRequest) {
  const session = await requestSession(request);
  if (!session) return json({ error: 'Требуется вход' }, 401);
  try {
    const started = performance.now();
    const data = await loadDashboard(request.nextUrl.searchParams, request.method === 'POST', session.role !== 'admin');
    if (request.nextUrl.searchParams.get('maintenance') === '1') await verifyArchiveInBackground(dashboardArchiveSpec(request.nextUrl.searchParams, true), data.archive);
    const loaded = performance.now();
    const visible = visibleDashboard(data, session);
    const calculated = performance.now();
    const response = json(visible);
    response.headers.set('Server-Timing', `archive;dur=${(loaded-started).toFixed(1)},calculate;dur=${(calculated-loaded).toFixed(1)},serialize;dur=${(performance.now()-calculated).toFixed(1)}`);
    return response;
  }
  catch (error) { if (error instanceof ArchiveMiss) return new Response(null, { status: 204, headers: { 'Cache-Control': 'private, no-store' } }); return json({ error: 'Некорректный период или ошибка чтения данных' }, 400); }
}
export async function GET(request: NextRequest) { const denied = await guard(request); return denied || read(request); }
export async function POST(request: NextRequest) { const denied = await guard(request, 'admin'); return denied || read(request); }
