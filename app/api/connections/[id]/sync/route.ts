import { loadDashboard } from '@/app/lib/load-dashboard';
import { after, NextRequest } from 'next/server';
import { guard, json } from '@/app/lib/auth';
import { input, failure } from '@/app/lib/connections/http';
import { period } from '@/app/lib/source-values';
import { syncConnection } from '@/app/lib/connections/sync';
export const runtime = 'nodejs';
export const maxDuration = 240;
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const denied = await guard(request, 'admin'); if (denied) return denied;
  try {
    const body = await input(request);
    const p = period(new URLSearchParams({ start: String(body.start || ''), end: String(body.end || '') }));
    const result = await syncConnection((await context.params).id, p.comparisonStart, p.end);
    after(async () => { try { await loadDashboard(new URLSearchParams({ start: p.start, end: p.end }), false, true); } catch { /* Archive error is recorded independently. */ } });
    return json(result);
  } catch (error) { return failure(error); }
}
