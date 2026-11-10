import { parseNlpkPayables, NlpkValidationError, parseNlpkHistory, NLPK_HISTORY_SHEET, NLPK_HISTORY_VERSION } from '../nlpk-payables';
import { parsePlanRows, PlanValidationError } from '../planning';
import { sourceInput } from '../source-input-archive';
import 'server-only';
import { bindingKey, resolveValues } from './merge';
import { getSourceSettings } from '../source-settings';
import { discoverSheets, safeSheetsError, sheetsClient, spreadsheetId, range } from '../google-sheets';
import { readFintablo, readFintabloPeriodBalances, inspectFintablo, FintabloError } from '../fintablo';
import { fintabloToDashboardData } from '../fintablo-adapter';
import { date, number, text } from '../source-values';
import type { CashRow, OrderRow } from '../dashboard-data';
import { ConnectionError, type ConnectionInput, type Secrets, type Inspection, type Binding, type StoredData, type SourceType } from './model';
export const methods = { cash: '/v1/transaction', balances: '/v1/moneybag', pnl: '/v1/pnl-item' } as const;
function googleSettings(connection: ConnectionInput, secrets: Secrets) {
  return { ...getSourceSettings(), googleSheetId: connection.config.spreadsheetId || '', googleServiceAccountEmail: secrets.serviceAccountEmail || '', googlePrivateKey: secrets.privateKey || '' };
}
function fintabloSettings(connection: ConnectionInput, secrets: Secrets) { return { fintabloBaseUrl: connection.config.baseUrl || 'https://api.fintablo.ru', fintabloToken: secrets.token || '' }; }
export function safeConnectionError(error: unknown): ConnectionError {
  if (error instanceof NlpkValidationError) return new ConnectionError('nlpk_fields', error.message);
  if (error instanceof PlanValidationError) return new ConnectionError('plan_fields', error.message);
  if (error instanceof ConnectionError) return error;
  if (error instanceof FintabloError) return new ConnectionError(error.code, error.message);
  const safe = safeSheetsError(error);
  return new ConnectionError(safe.code, safe.message);
}
export interface SourceAdapter {
  inspect(connection: ConnectionInput, secrets: Secrets, sheet?: string, headerRow?: number): Promise<Inspection>;
  read(connection: ConnectionInput, secrets: Secrets, start: string, end: string): Promise<StoredData>;
}
function columnName(index: number) { let name = ''; for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name; return name || 'A'; }
async function readHistory(c: ConnectionInput, secrets: Secrets, b: Binding) {
  return sourceInput([NLPK_HISTORY_VERSION, c.type, c.config, secrets, b], async () => {
    const settings = googleSettings(c, secrets), client = sheetsClient(settings);
    const id = spreadsheetId(settings.googleSheetId);
    const metadata = await client.spreadsheets.get({ spreadsheetId: id, fields: 'sheets(properties(title,gridProperties(rowCount)))' }, { timeout: 15000, retry: false });
    const sheet = metadata.data.sheets?.find(s => s.properties?.title === NLPK_HISTORY_SHEET);
    const count = sheet?.properties?.gridProperties?.rowCount;
    if (!count || count > 200000) throw new ConnectionError('sheet_size', 'Лист истории НЛПК отсутствует или превышает поддерживаемый размер.');
    const rows: unknown[][] = [];
    for (let start = 6; start <= count; start += 2000) {
      const last = Math.min(count, start + 1999);
      const page = await client.spreadsheets.values.get({ spreadsheetId: id, range: range(NLPK_HISTORY_SHEET, `A${start}:G${last}`), valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' }, { timeout: 15000, retry: false });
      // Keep physical row order, including trailing gaps between pages.
      for (let i = 0; i <= last - start; i++) rows.push(page.data.values?.[i] || []);
    }
    return parseNlpkHistory(rows, 6);
  });
}
async function readRowsLive(c: ConnectionInput, secrets: Secrets, b: Binding) {
  const settings = googleSettings(c, secrets);
  const inspection = await discoverSheets(settings, b.sheet, b.headerRow);
  if (Object.entries(b.columns).some(([field, index]) => !inspection.headers?.some(h => h.index === index && h.label === b.headers?.[field]))) throw new ConnectionError('schema_changed', 'Заголовки источника изменились. Проверьте сопоставление колонок.');
  const result = await sheetsClient(settings).spreadsheets.values.get({ spreadsheetId: spreadsheetId(settings.googleSheetId), range: range(b.sheet, `A${b.headerRow + 1}:${columnName(Math.max(...Object.values(b.columns)))}${b.headerRow + 10001}`), valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' }, { timeout: 15000, retry: false });
  const rows = result.data.values || [];
  if (rows.length > 10000) throw new ConnectionError('limit', 'Больше 10000 строк. Для этого источника требуется постраничный адаптер.');
  return rows.filter(row => row.some(value => value !== '' && value != null)).map(row => Object.fromEntries(Object.entries(b.columns).map(([field, index]) => [field, row[index]])));
}
function readRows(c: ConnectionInput, secrets: Secrets, b: Binding) {
  return sourceInput(['mapped-rows', c.type, c.config, secrets, b], () => readRowsLive(c, secrets, b));
}
function mappedData(rows: Record<string, unknown>[], dataset: Binding['dataset'], start: string, end: string): unknown {
  const inPeriod = (d: string) => d >= start && d <= end;
  if (dataset === 'nlpkPayables') return parseNlpkPayables(rows, end);
  if (dataset === 'planReceipts' || dataset === 'planPayments') return parsePlanRows(rows).filter(r => inPeriod(r.date));
  if (dataset === 'balanceSheet') {
    const entries = rows.map(r => ({ date: date(r.date), category: text(r.category), article: text(r.article), amount: number(r.amount) }));
    if (entries.some(r => !r.date || !r.category || !r.article) || rows.some(r => r.amount == null || String(r.amount).trim() === '')) throw new ConnectionError('balance_fields', 'Заполните дату, раздел, статью и сумму каждой строки баланса');
    const latest = entries.filter(r => r.date <= end).map(r => r.date).sort().at(-1);
    return entries.filter(r => r.date === latest);
  }
  if (dataset === 'cash') return rows.map(r => ({ date: date(r.date), amount: number(r.amount), source: text(r.source), counterparty: text(r.counterparty), article: text(r.article), flow: text(r.flow) } satisfies CashRow)).filter(r => inPeriod(r.date) && !/внутрен|перевод между|резерв/i.test(`${r.article} ${r.counterparty}`));
  if (dataset === 'orders') return rows.map(r => ({ date: date(r.date), order: text(r.order), payer: text(r.payer), client: text(r.client), region: text(r.region), product: text(r.product), qty: number(r.qty), paymentType: text(r.paymentType), revenue: number(r.revenue), manager: text(r.manager), department: text(r.department), volume: number(r.volume), paid: number(r.paid), debt: number(r.debt), delivery: date(r.delivery), stage: text(r.stage), status: text(r.status) } satisfies OrderRow)).filter(r => inPeriod(r.date));
  if (dataset === 'balances') return rows.map(r => ({ date: date(r.date), account: number(r.account), wallet: number(r.wallet) })).filter(r => r.date && r.date <= end).sort((a, b) => b.date.localeCompare(a.date))[0] || {};
  if (dataset === 'payables') return rows.filter(r => text(r.counterparty) && text(r.balance)).map(r => ({ counterparty: text(r.counterparty), balance: number(r.balance), document: text(r.document), date: date(r.date), dueDate: date(r.dueDate) }));
  if (dataset === 'debt') return rows.map(r => ({ category: text(r.category), paymentMethod: text(r.paymentMethod), recipient: text(r.recipient), direction: text(r.direction), marker: text(r.marker), balance: number(r.balance) }));
  if (dataset === 'pnl') return rows.map(r => ({ date: date(r.date), value: number(r.value), category: text(r.category), type: text(r.type) })).filter(r => inPeriod(r.date));
  throw new ConnectionError('schema_required', 'Для этого набора данных нужна подтверждённая схема источника');
}
const googleAdapter: SourceAdapter = {
  async inspect(c, secrets, sheet, headerRow) {
    const result = await discoverSheets(googleSettings(c, secrets), sheet, headerRow);
    return { ...result, checkedAt: new Date().toISOString(), message: 'Доступ подтверждён. Выберите лист, строку заголовков и явно сопоставьте поля.' };
  },
  async read(c, secrets, start, end) {
    const result: StoredData = { byBinding: {} };
    const failures = new Map<string, unknown>();
    for (const b of c.bindings) {
      const key = bindingKey(b);
      if (!(key in result.byBinding!)) {
        try { result.byBinding![key] = b.sheet === NLPK_HISTORY_SHEET && (b.dataset === 'nlpkPayables' || b.dataset === 'payables') ? await readHistory(c, secrets, b) : mappedData(await readRows(c, secrets, b), b.dataset, start, end); }
        catch (error) { if (b.mode === 'merge') throw error; failures.set(key, error); }
      }
    }
    for (const dataset of new Set(c.bindings.map(b => b.dataset))) {
      if (c.bindings.filter(b => b.dataset === dataset).every(b => failures.has(bindingKey(b)))) throw failures.get(bindingKey(c.bindings.find(b => b.dataset === dataset)!));
      result[dataset] = resolveValues(c.bindings.filter(b => b.dataset === dataset).map(b => ({ binding: b, value: result.byBinding![bindingKey(b)], name: b.sheet })));
    }
    return result;
  },
};
const fintabloAdapter: SourceAdapter = {
  async inspect(c, secrets) {
    return { accounts: await inspectFintablo(fintabloSettings(c, secrets)), checkedAt: new Date().toISOString(), message: 'Получены реальные счета Финтабло. Выбор организаций отдельно не реализован: нужен подтверждённый метод API.' };
  },
  async read(c, secrets, start, end) {
    const snapshot = await readFintablo(start, end, fintabloSettings(c, secrets));
    const ids = c.config.accountIds || [];
    if (ids.some(id => !snapshot.accounts.some(a => a.id === id))) throw new ConnectionError('accounts', 'Выбранный счёт больше не доступен. Проверьте подключение.');
    if (ids.length) {
      snapshot.accounts = snapshot.accounts.filter(a => ids.includes(a.id));
      snapshot.transactions = snapshot.transactions.filter(t => ids.includes(t.accountId));
      if (c.bindings.some(b => b.dataset === 'pnl')) throw new ConnectionError('pnl_scope', 'ОПиУ не фильтруется по счетам: API не подтверждает такую связь. Используйте отдельное подключение без фильтра счетов.');
    }
    const normalized = fintabloToDashboardData(snapshot), result: StoredData = {};
    for (const b of c.bindings) {
      if (b.dataset === 'cash') result.cash = normalized.cash;
      if (b.dataset === 'balances') result.balances = fintabloToDashboardData(await readFintabloPeriodBalances(end, fintabloSettings(c, secrets), ids)).balances;
      if (b.dataset === 'pnl') result.pnl = snapshot.pnl.map(r => ({ date: date(r.date), value: number(r.value), category: text(r.category), type: text(r.type) })).filter(r => r.date >= start && r.date <= end);
    }
    return result;
  },
};
const crmAdapter: SourceAdapter = {
  async inspect() { throw new ConnectionError('adapter_required', 'Для CRM нужны название системы, документация API, базовый URL и способ авторизации. Получение воронок и менеджеров появится после реализации подтверждённого адаптера.'); },
  async read() { throw new ConnectionError('adapter_required', 'CRM-адаптер ещё не подключён. Синхронизация не выполнялась.'); },
};
// Add a documented adapter here; credentials and HTTP calls always stay on the server.
export const adapters: Record<SourceType, SourceAdapter> = { googleSheets: googleAdapter, debt: googleAdapter, fintablo: fintabloAdapter, crm: crmAdapter };
export async function validateMappings(c: ConnectionInput, secrets: Secrets) {
  if (c.type === 'crm') return;
  for (const b of c.bindings) {
    if (c.type === 'fintablo') {
      if (!(b.dataset in methods) || b.sheet !== methods[b.dataset as keyof typeof methods]) throw new ConnectionError('mapping', 'Выберите реализованный набор данных Финтабло');
    } else {
      const result = await adapters[c.type].inspect(c, secrets, b.sheet, b.headerRow);
      if (Object.entries(b.columns).some(([field, index]) => !result.headers?.some(h => h.index === index && h.label === b.headers?.[field]))) throw new ConnectionError('mapping', 'Выбранные колонки отсутствуют в строке заголовков');
    }
  }
}
