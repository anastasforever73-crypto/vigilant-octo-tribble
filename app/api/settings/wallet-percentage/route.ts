import { NextRequest } from 'next/server';
import { guard, json } from '@/app/lib/auth';
import { parseWalletPercentage } from '@/app/lib/wallet-percentage';
import { readWalletPercentage, saveWalletPercentage } from '@/app/lib/wallet-percentage-store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  const denied = await guard(request, undefined, 'overview'); if (denied) return denied;
  try { return json({ rules: await readWalletPercentage() }); }
  catch { return json({ error: 'Настройки процента временно недоступны.' }, 503); }
}
export async function POST(request: NextRequest) {
  const denied = await guard(request, undefined, 'overview'); if (denied) return denied;
  let rule;
  try { rule = parseWalletPercentage(await request.json()); }
  catch (error) { return json({ error: error instanceof Error ? error.message : 'Некорректные настройки.' }, 422); }
  try { await saveWalletPercentage(rule); return json({ saved: true, rules: await readWalletPercentage() }); }
  catch (error) { return json({ saved: false, error: error instanceof Error ? error.message : 'Сохранение не выполнено.' }, 503); }
}
