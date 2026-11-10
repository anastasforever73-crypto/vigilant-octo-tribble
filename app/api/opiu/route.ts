import { verifyArchiveInBackground } from '@/app/lib/verify-archive-background';
import { NextRequest } from 'next/server';
import { guard, json } from '@/app/lib/auth';
import { readOpiu, opiuArchiveSpec } from '@/app/lib/read-opiu';
import { safeSheetsError } from '@/app/lib/google-sheets';
export const runtime = 'nodejs';
export const maxDuration = 240;
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  const denied = await guard(request, undefined, 'opiu');
  if (denied) return denied;
  try { const data = await readOpiu(); await verifyArchiveInBackground(opiuArchiveSpec(), data.archive); return json(data); }
  catch (error) { return json({ error: safeSheetsError(error).message }, 502); }
}

export async function POST(request: NextRequest) {
  const denied = await guard(request, 'admin');
  if (denied) return denied;
  try { return json(await readOpiu(true)); }
  catch (error) { return json({ error: safeSheetsError(error).message }, 502); }
}
