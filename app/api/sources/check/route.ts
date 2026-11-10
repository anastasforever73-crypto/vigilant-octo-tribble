import { NextRequest } from 'next/server';
import { guard, json } from '@/app/lib/auth';
import { getSourceSettings, type SourceSettings } from '@/app/lib/source-settings';
import { inspectSheets, safeSheetsError } from '@/app/lib/google-sheets';
import { readGoogleSheets } from '@/app/lib/google-dashboard';
import { readReceivables, resolveDebtSettings } from '@/app/lib/read-receivables';
import { FintabloError, readFintablo } from '@/app/lib/fintablo';
export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  const denied = await guard(request, 'admin'); if (denied) return denied;
  if (Number(request.headers.get('content-length') || 0) > 32768) return json({ error: 'Слишком большой запрос' }, 413);
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Некорректные параметры' }, 400);
  const input = body as Record<string, unknown>;
  const settings = getSourceSettings();
  const allowed = ['googleSheetId', 'googleServiceAccountEmail', 'googlePrivateKey', 'debtGoogleSheetId', 'fintabloBaseUrl', 'fintabloToken', 'cashSheet', 'ordersSheet', 'debtorSheet', 'factorySheet', 'walletSheet', 'accountSheet', 'debtSheet'] as const;
  for (const key of allowed) if (typeof input[key] === 'string' && input[key].trim()) settings[key] = input[key].trim();
  try {
    if (input.source === 'fintablo') {
      const today = new Date().toISOString().slice(0, 10);
      await readFintablo(today, today, settings);
      return json({ status: 'connected', checkedAt: new Date().toISOString(), message: 'Финтабло доступно. Проверка не сохраняет подключение.' });
    }
    if (input.source !== 'googleSheets' && input.source !== 'debt') return json({ error: 'Неизвестный источник' }, 400);
    const debt = input.source === 'debt';
    const metadata = await inspectSheets(debt ? await resolveDebtSettings(settings) : settings as SourceSettings, debt);
    let validation = 'Выберите существующие листы и подтвердите сопоставление. Формат неизвестных листов автоматически не назначается.';
    if (input.validate === true) {
      if (debt) { const report = await readReceivables(settings); if (!report.current) return json({ status: 'incomplete', error: report.configurationError || 'ДЗ не подтверждена. Проверьте листы и диагностику строк.' }, 422); } else await readGoogleSheets(new Date().toISOString().slice(0, 10), settings);
      validation = 'Диапазоны прочитаны по существующему сопоставлению. Назначение колонок должен подтвердить владелец таблицы.';
    }
    return json({ ...metadata, status: 'connected', checkedAt: new Date().toISOString(), message: validation });
  } catch (error) {
    const e = error instanceof FintabloError ? error : safeSheetsError(error);
    return json({ status: e.code, error: e.message }, 422);
  }
}
