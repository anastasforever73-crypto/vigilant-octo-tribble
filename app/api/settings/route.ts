import { NextRequest } from 'next/server';
import { guard, json } from '@/app/lib/auth';
import { getSourceSettings, storageMessage } from '@/app/lib/source-settings';
import { bindings } from '@/app/lib/google-sheets';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  const denied = await guard(request, 'admin'); if (denied) return denied;
  const s = getSourceSettings();
  // Only non-secret sheet bindings are returned. Never echo account email, keys or tokens.
  return json({ storage: { available: false, message: storageMessage }, mapping: bindings.map(b => ({ ...b, sheet: s[b.key] })), debtSheet: s.debtSheet });
}
export async function POST(request: NextRequest) {
  const denied = await guard(request, 'admin'); if (denied) return denied;
  return json({ error: storageMessage, status: 'storage_required', saved: false }, 503);
}
