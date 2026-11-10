import { sourceInput } from './source-input-archive';
import 'server-only';
import { date, number } from './source-values';
import { parseNlpkHistory, nlpkHistoryAt, NLPK_HISTORY_SHEET, NLPK_HISTORY_VERSION } from './nlpk-payables';
import { debtSourceSheets, getSourceSettings, type SourceSettings } from './source-settings';
import { range, safeSheetsError, SheetsError, sheetsClient, spreadsheetId } from './google-sheets';
import { getConnection, listConnections } from './connections/store';
import { collectReceivables, combineDebt, debtSources, moscowToday, reportWeek, type ReceivablesReport } from './receivables';
import { parseDebtArchive } from './debt-archive';

export async function resolveDebtSettings(settings = getSourceSettings()): Promise<SourceSettings> {
  if (!settings.debtEnabled) throw new SheetsError('disabled', 'Источник дебиторки отключён (DEBT_ENABLED=false)');
  // Explicit debt ID always wins. Never fall back to the sales/cash workbook.
  if (settings.debtGoogleSheetId && settings.googleServiceAccountEmail && settings.googlePrivateKey) return settings;
  if (process.env.DATABASE_URL) {
    const debt = (await listConnections()).filter(c => c.enabled && (c.type === 'debt' || (c.type === 'googleSheets' && c.bindings.some(b => b.section === 'debt' && b.dataset === 'debt'))) && (!settings.debtGoogleSheetId || c.config.spreadsheetId === spreadsheetId(settings.debtGoogleSheetId)));
    if (debt.length > 1) throw new SheetsError('ambiguous', 'Найдено несколько подключений задолженности. Укажите DEBT_GOOGLE_SHEET_ID для однозначного выбора.');
    if (debt.length === 1) {
      const { connection, secrets } = await getConnection(debt[0].id);
      if (connection.config.spreadsheetId) return { ...settings, debtTransitSheet: connection.config.debtTransitSheet || settings.debtTransitSheet, debtStockSheet: connection.config.debtStockSheet || settings.debtStockSheet, debtGoogleSheetId: connection.config.spreadsheetId, googleServiceAccountEmail: secrets.serviceAccountEmail || settings.googleServiceAccountEmail, googlePrivateKey: secrets.privateKey || settings.googlePrivateKey };
    }
  }
  if (settings.debtGoogleSheetId) return settings;
  throw new SheetsError('missing_config', 'Укажите DEBT_GOOGLE_SHEET_ID и серверные GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY либо настройте одно подключение «Google Sheets — задолженность» в «Источниках данных».');
}
function columnName(index: number) { let name = ''; for (let n = index; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name; return name; }
/** Reads every allocated row in bounded pages; never silently truncates the sheet. */
async function readReceivablesLive(settings = getSourceSettings(), now = new Date()): Promise<ReceivablesReport> {
  const asOf = moscowToday(now);
  const report: ReceivablesReport = { asOf, week: reportWeek(asOf), current: null, sources: {}, errors: {}, archive: { status: 'missing', snapshots: [], diagnostics: [], message: 'Лист «Архив ДЗ» не найден. История отсутствует.' } };
  try {
    const resolved = await resolveDebtSettings(settings);
    if (!resolved.googleServiceAccountEmail || !resolved.googlePrivateKey) throw new SheetsError('missing_config', 'Для таблицы дебиторки укажите GOOGLE_SERVICE_ACCOUNT_EMAIL и GOOGLE_PRIVATE_KEY на сервере либо реквизиты существующего подключения задолженности.');
    const client = sheetsClient(resolved), id = spreadsheetId(resolved.debtGoogleSheetId);
    const sourceSheets = debtSourceSheets(resolved);
    report.sourceSheets = sourceSheets;
    const metadata = await client.spreadsheets.get({ spreadsheetId: id, fields: 'sheets(properties(title,gridProperties(rowCount,columnCount)))' }, { timeout: 15000, retry: false });
    const sheets = metadata.data.sheets || [];
    const readSheet = async (title: string): Promise<unknown[][]> => {
      const properties = sheets.find(s => s.properties?.title === title)?.properties;
      if (!properties) throw new SheetsError('sheet_missing', `В таблице дебиторки отсутствует лист «${title}»`);
      const rowCount = properties.gridProperties?.rowCount || 0, columnCount = properties.gridProperties?.columnCount || 0;
      if (!rowCount || !columnCount || rowCount > 200000 || columnCount > 1000) throw new SheetsError('sheet_size', `Лист «${title}» превышает поддерживаемый размер или не содержит сетки. Итог не рассчитан.`);
      const result: unknown[][] = [];
      for (let start = 1; start <= rowCount; start += 2000) {
        const end = Math.min(rowCount, start + 1999);
        const page = await client.spreadsheets.values.get({ spreadsheetId: id, range: range(title, `A${start}:${columnName(columnCount)}${end}`), majorDimension: 'ROWS', valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' }, { timeout: 15000, retry: false });
        const rows = page.data.values || [];
        for (let row = 0; row <= end - start; row++) result.push(rows[row] || []);
      }
      return result;
    };
    const seenRows = new Set<string>();
    await Promise.all(debtSources.map(async source => {
      try { report.sources[source] = collectReceivables(await readSheet(sourceSheets[source]), source, asOf, seenRows); }
      catch (error) { report.errors[source] = error instanceof SheetsError ? error.message : error instanceof Error && error.message === 'Не найдена строка со всеми обязательными заголовками' ? `Лист «${sourceSheets[source]}»: не найдены обязательные заголовки. Проверьте названия колонок.` : safeSheetsError(error).message; }
    }));
    if (sheets.some(s => s.properties?.title === resolved.factorySheet)) {
      try {
        const raw = await readSheet(resolved.factorySheet);
        if (resolved.factorySheet === NLPK_HISTORY_SHEET) report.nlpkHistory = parseNlpkHistory(raw);
        const rows = report.nlpkHistory ? nlpkHistoryAt(report.nlpkHistory.history, asOf).map(row => ({ date: row.date, factory: row.balance })) : raw.slice(3).filter(r => r[0] && r[6] != null).map(r => ({ date: date(r[0]), factory: number(r[6]) })).filter(r => r.date <= asOf).sort((a,b) => a.date.localeCompare(b.date));
        if (rows.length) report.payables = { ...rows.at(-1)!, sheet: resolved.factorySheet };
        else report.payablesError = `Лист «${resolved.factorySheet}»: нет остатка кредиторки с датой. Проверьте колонки A (дата) и G (остаток).`;
      } catch { report.payablesError = `Не удалось прочитать кредиторку из «${resolved.factorySheet}». Проверьте даты и суммы либо настройте отдельное сопоставление кредиторки.`; }
    } else report.payablesError = `Лист «${resolved.factorySheet}» отсутствует. В Google Sheets выберите лист кредиторки и сопоставьте «Поставщик / кредитор» и «Остаток долга» в наборе «Кредиторская задолженность».`;
    const updatedAt = new Date().toISOString();
    report.current = combineDebt(report.sources, updatedAt);
    if (report.current) report.updatedAt = updatedAt;
    if (sheets.some(s => s.properties?.title === 'Архив ДЗ')) {
      try { report.archive = parseDebtArchive(await readSheet('Архив ДЗ'), asOf); }
      catch (error) { report.archive = { status: 'error', snapshots: [], diagnostics: [], message: error instanceof Error && error.message === 'Не найдена строка со всеми обязательными заголовками' ? 'В «Архив ДЗ» не найдены обязательные заголовки.' : safeSheetsError(error).message }; }
    }
  } catch (error) {
    const message = error instanceof SheetsError ? error.message : 'Не удалось прочитать настройки или таблицу дебиторки. Проверьте доступ к существующему подключению.';
    report.configurationError = message; report.archive = { status: 'error', snapshots: [], diagnostics: [], message: 'Архив недоступен: источник не прочитан.' };
    for (const source of debtSources) report.errors[source] = message;
  }
  return report;
}

export async function readReceivables(settings = getSourceSettings(), now = new Date()): Promise<ReceivablesReport> {
  const resolved = await resolveDebtSettings(settings).catch(() => settings);
  return sourceInput(['receivables', ...(resolved.factorySheet === NLPK_HISTORY_SHEET ? [NLPK_HISTORY_VERSION] : []), resolved, moscowToday(now)], () => readReceivablesLive(resolved, now),
    report => Boolean(report.current && !report.current.partial && !report.configurationError && report.archive.status !== 'error' && (resolved.factorySheet !== NLPK_HISTORY_SHEET || !report.payablesError)));
}
