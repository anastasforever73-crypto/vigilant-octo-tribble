import 'server-only';
import { createPrivateKey } from 'node:crypto';
import { google } from 'googleapis';
import { debtSourceSheets, getSourceSettings, type SourceSettings } from './source-settings';
export class SheetsError extends Error { constructor(public code: string, message: string) { super(message); } }
export function spreadsheetId(value: string) {
  let id = value.trim();
  if (id.startsWith('https://')) { const url = new URL(id); if (url.hostname !== 'docs.google.com') throw new SheetsError('invalid_id', 'Укажите ссылку Google Sheets или ID таблицы'); id = url.pathname.match(/^\/spreadsheets\/d\/([^/]+)/)?.[1] || ''; }
  if (!/^[\w-]+$/.test(id)) throw new SheetsError('invalid_id', 'Укажите корректный ID таблицы');
  return id;
}
export function sheetsClient(settings = getSourceSettings()) {
  if (!settings.googleServiceAccountEmail || !settings.googlePrivateKey) throw new SheetsError('not_configured', 'Источник не подключён: нужны серверные реквизиты Google');
  const key = settings.googlePrivateKey.replace(/\\n/g, '\n').trim();
  try { createPrivateKey(key); } catch { throw new SheetsError('invalid_key', 'Приватный ключ Google имеет неверный формат'); }
  return google.sheets({ version: 'v4', auth: new google.auth.JWT({ email: settings.googleServiceAccountEmail, key, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] }) });
}
export function safeSheetsError(error: unknown): SheetsError {
  if (error instanceof SheetsError) return error;
  const status = error && typeof error === 'object' && 'response' in error && error.response && typeof error.response === 'object' && 'status' in error.response ? error.response.status : undefined;
  if (status === 403) return new SheetsError('access_denied', 'Нет доступа к таблице или Google Sheets API. Предоставьте сервисному аккаунту доступ «Читатель» и включите API.');
  if (status === 404) return new SheetsError('not_found', 'Таблица не найдена или недоступна сервисному аккаунту');
  if (status === 401) return new SheetsError('auth', 'Google отклонил авторизацию сервисного аккаунта');
  if (status === 400) return new SheetsError('invalid_range', 'Проверьте ключ Google, выбранные листы и диапазоны');
  return new SheetsError('unavailable', 'Google Sheets недоступен или содержит некорректные данные');
}
export const range = (sheet: string, cells: string) => `'${sheet.replace(/'/g, "''")}'!${cells}`;
export const bindings = [
  { key: 'cashSheet', label: 'ДДС', cells: 'A2:N', width: 12 },
  { key: 'ordersSheet', label: 'Продажи', cells: 'A2:X', width: 23 },
  { key: 'debtorSheet', label: 'Дебиторская задолженность', cells: 'A1:C30', width: 3 },
  { key: 'factorySheet', label: 'Кредиторская задолженность', cells: 'A4:O', width: 7 },
  { key: 'walletSheet', label: 'Остаток кошелька', cells: 'A2:J', width: 10 },
  { key: 'accountSheet', label: 'Остаток счёта', cells: 'A2:B', width: 2 },
] as const;
export async function inspectSheets(settings: SourceSettings, debt = false) {
  const client = sheetsClient(settings);
  const id = spreadsheetId(debt ? settings.debtGoogleSheetId : settings.googleSheetId);
  const result = await client.spreadsheets.get({ spreadsheetId: id, fields: 'sheets(properties(sheetId,title,gridProperties(columnCount)))' }, { timeout: 15000, retry: false });
  const sheets = (result.data.sheets || []).flatMap(s => s.properties?.title ? [{ title: s.properties.title, columns: s.properties.gridProperties?.columnCount || 0 }] : []);
  if (!sheets.length) throw new SheetsError('empty', 'В таблице нет доступных листов');
  const mapping = debt ? Object.entries(debtSourceSheets(settings)).map(([key, title]) => ({ key, label: key, sheet: title, valid: sheets.some(s => s.title === title) })) : bindings.map(b => {
    const found = sheets.find(s => s.title === settings[b.key]);
    return { key: b.key, label: b.label, sheet: settings[b.key], valid: Boolean(found && found.columns >= b.width) };
  });
  return { sheets: sheets.map(s => s.title), mapping };
}

// Discover the actual workbook before an administrator assigns any columns.
export async function discoverSheets(settings: SourceSettings, sheet?: string, headerRow = 1) {
  const client = sheetsClient(settings), id = spreadsheetId(settings.googleSheetId);
  const result = await client.spreadsheets.get({ spreadsheetId: id, fields: 'sheets(properties(title,gridProperties(columnCount)))' }, { timeout: 15000, retry: false });
  const sheets = (result.data.sheets || []).flatMap(item => item.properties?.title ? [{ title: item.properties.title, columns: item.properties.gridProperties?.columnCount || 0 }] : []);
  if (!sheets.length) throw new SheetsError('empty', 'В таблице нет доступных листов');
  if (!sheet) return { sheets };
  if (!sheets.some(item => item.title === sheet) || !Number.isInteger(headerRow) || headerRow < 1 || headerRow > 100) throw new SheetsError('mapping', 'Выберите существующий лист и строку заголовков от 1 до 100');
  const values = await client.spreadsheets.values.get({ spreadsheetId: id, range: range(sheet, `A${headerRow}:ZZZ${headerRow}`), valueRenderOption: 'FORMATTED_VALUE' }, { timeout: 15000, retry: false });
  const row = values.data.values?.[0] || [];
  if (!row.some(value => String(value ?? '').trim())) throw new SheetsError('headers', 'В выбранной строке нет заголовков. Укажите номер строки с заголовками.');
  const headers = Array.from({ length: sheets.find(item => item.title === sheet)!.columns }, (_, index) => ({ index, label: String(row[index] ?? '').trim() ? String(row[index]).slice(0, 200) : `Без заголовка (колонка ${index + 1})` }));
  return { sheets, headers };
}
