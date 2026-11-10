import { NextRequest } from 'next/server';
import { guard, json } from '@/app/lib/auth';
import { inspectSheets, safeSheetsError } from '@/app/lib/google-sheets';
import { resolveDebtSettings } from '@/app/lib/read-receivables';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) {
  const denied = await guard(request, 'admin'); if (denied) return denied;
  try { return json(await inspectSheets(await resolveDebtSettings(), true)); }
  catch (error) { const e = safeSheetsError(error); return json({ error: e.message, status: e.code }, 422); }
}
