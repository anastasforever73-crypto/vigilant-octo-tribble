import { NextRequest } from 'next/server';
import { guard, json } from '@/app/lib/auth';
import { FintabloError, readFintablo } from '@/app/lib/fintablo';
import { getSourceSettings } from '@/app/lib/source-settings';
import { period } from '@/app/lib/source-values';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  const denied = await guard(request, 'admin'); if (denied) return denied;
  if (!getSourceSettings().fintabloEnabled) return json({ error: 'Источник отключён' }, 503);
  try { const p = period(request.nextUrl.searchParams); return json(await readFintablo(p.start, p.end)); }
  catch (error) { return json({ error: error instanceof FintabloError ? error.message : 'Ошибка чтения Финтабло или некорректный период' }, 422); }
}
