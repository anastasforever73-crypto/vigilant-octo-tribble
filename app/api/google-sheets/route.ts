import { NextRequest } from 'next/server';
import { guard, json } from '@/app/lib/auth';
import { sheetsClient, spreadsheetId, safeSheetsError, range, bindings } from '@/app/lib/google-sheets';
import { getSourceSettings } from '@/app/lib/source-settings';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  const denied = await guard(request, 'admin'); if (denied) return denied;
  const s = getSourceSettings();
  if (!s.googleEnabled) return json({ error: 'Источник отключён' }, 503);
  try {
    const configured: unknown = process.env.GOOGLE_SHEET_RANGES ? JSON.parse(process.env.GOOGLE_SHEET_RANGES) : bindings.map(b => range(s[b.key], b.cells));
    if (!Array.isArray(configured) || !configured.every(x => typeof x === 'string')) return json({ error: 'Некорректная настройка диапазонов' }, 422);
    const response = await sheetsClient(s).spreadsheets.values.batchGet({ spreadsheetId: spreadsheetId(s.googleSheetId), ranges: configured, valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'FORMATTED_STRING' }, { timeout: 15000, retry: false });
    return json({ source: 'google-sheets', updatedAt: new Date().toISOString(), ranges: response.data.valueRanges || [] });
  } catch (error) { const e = safeSheetsError(error); return json({ error: e.message, status: e.code }, 422); }
}
