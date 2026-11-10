import { probeArchiveSources } from './archive-source-probe';
import { archivedLoad } from './period-archive';
import 'server-only';
import { getSourceSettings } from './source-settings';
import { resolveDebtSettings } from './read-receivables';
import { sheetsClient, range, SheetsError } from './google-sheets';
import { columnName, OPIU_SHEET, OPIU_WORKBOOK, parseOpiu } from './opiu';

async function readOpiuSources() {
  const settings = getSourceSettings();
  const client = sheetsClient(settings.googleServiceAccountEmail && settings.googlePrivateKey ? settings : await resolveDebtSettings(settings));
  const metadata = await client.spreadsheets.get({ spreadsheetId: OPIU_WORKBOOK, fields: 'sheets(properties(sheetId,title,gridProperties))' }, { timeout: 15000, retry: false });
  const sheet = metadata.data.sheets?.find(s => s.properties?.title === OPIU_SHEET)?.properties;
  if (!sheet || sheet.sheetId == null) throw new SheetsError('not_found', 'Вкладка «Анализ ОПИУ » не найдена');
  const allocatedRows = sheet.gridProperties?.rowCount || 0, allocatedColumns = sheet.gridProperties?.columnCount || 0;
  if (!allocatedRows || !allocatedColumns || allocatedRows > 200000 || allocatedColumns > 1000) throw new SheetsError('mapping', 'Изменился размер вкладки ОПиУ: требуется проверка диапазона');
  // Grid allocation includes formatted empty cells; measure values before loading formats.
  const used = await client.spreadsheets.values.get({ spreadsheetId: OPIU_WORKBOOK, range: range(OPIU_SHEET, `A1:${columnName(allocatedColumns - 1)}${allocatedRows}`) }, { timeout: 15000, retry: false });
  const values = used.data.values || [];
  const rows = values.length, columns = Math.max(0, ...values.map(row => row.length));
  if (!rows || !columns || rows * columns > 50000) throw new SheetsError('mapping', 'Используемый диапазон ОПиУ пуст или превышает 50 000 ячеек');
  const response = await client.spreadsheets.get({ spreadsheetId: OPIU_WORKBOOK, ranges: [range(OPIU_SHEET, `A1:${columnName(columns - 1)}${rows}`)], fields: 'sheets/data/rowData/values(effectiveValue,formattedValue,effectiveFormat)' }, { timeout: 30000, retry: false });
  return parseOpiu(response.data.sheets?.[0]?.data?.[0]?.rowData || [], sheet.sheetId);
}

export function opiuArchiveSpec() {
  return { kind: 'opiu', start: 'all', end: 'all', retention: 'historical' as const, probe: () => probeArchiveSources('opiu'), load: readOpiuSources, observedAt: (data: import('./opiu').OpiuReport) => data.updatedAt,
    complete: (data: import('./opiu').OpiuReport) => Boolean(data.months?.length && data.rows?.length) };
}
export async function readOpiu(force = false) { return archivedLoad(opiuArchiveSpec(), force); }
