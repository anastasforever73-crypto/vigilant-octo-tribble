import { sourceInput } from './source-input-archive';
import 'server-only';
import type { DashboardData } from './dashboard-data';
import { getSourceSettings } from './source-settings';
import { date, number, text } from './source-values';
import { inspectSheets, range, sheetsClient, spreadsheetId, SheetsError } from './google-sheets';
type Row = unknown[];
function latestBalance(rows: Row[], end: string, balanceColumn: number) {
  return rows
    .map((row) => ({ date: date(row[0]), value: number(row[balanceColumn]) }))
    .filter((row) => row.date && row.date <= end)
    .sort((a, b) => b.date.localeCompare(a.date))[0]?.value ;
}

export async function readGoogleSheets(end: string, settings = getSourceSettings()): Promise<DashboardData> {
  if (!settings.googleEnabled) throw new SheetsError('disabled', 'Источник отключён');
  const input = await sourceInput(['google-dashboard', settings], async () => {
  const inspection = await inspectSheets(settings);
  if (inspection.mapping.some(m => !m.valid)) throw new SheetsError('mapping', 'Не найдены листы или необходимые колонки. Проверьте сопоставление.');
  const SHEETS = {
    cash: range(settings.cashSheet, 'A2:N'), orders: range(settings.ordersSheet, 'A2:X'),
    debtor: range(settings.debtorSheet, 'A1:C30'), factory: range(settings.factorySheet, 'A4:O'),
    wallet: range(settings.walletSheet, 'A2:J'), account: range(settings.accountSheet, 'A2:B'),
  };
  const response = await sheetsClient(settings).spreadsheets.values.batchGet({
    spreadsheetId: spreadsheetId(settings.googleSheetId), ranges: Object.values(SHEETS),
    valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER',
  }, { timeout: 15000, retry: false });
  const values = response.data.valueRanges ?? [];
  const byRange = Object.fromEntries(
    Object.keys(SHEETS).map((key, index) => [key, values[index]?.values ?? []]),
  ) as Record<keyof typeof SHEETS, Row[]>;
  return { byRange, updatedAt: new Date().toISOString() };
  });
  const { byRange } = input;
  const cash = byRange.cash
    .map((row) => ({ date: date(row[4]), amount: number(row[5]), source: text(row[6]), counterparty: text(row[8]), article: text(row[10]), flow: text(row[11]) }))
    .filter((row) => row.date && row.amount && !/внутрен|перевод между|резерв/i.test(`${row.article} ${row.counterparty}`));
  const orders = byRange.orders
    .map((row) => ({ date: date(row[0]), order: text(row[1]), payer: text(row[2]), client: text(row[3]), region: text(row[4]), product: text(row[6]), qty: number(row[7]), paymentType: text(row[9]), revenue: number(row[11]), manager: text(row[17]), department: text(row[18]), volume: number(row[20]), paid: number(row[21]), debt: number(row[22]), delivery: date(row[14]) }))
    .filter((row) => row.date && (row.revenue || row.debt));
  const factoryRows = byRange.factory
    .map((row) => ({ date: date(row[0]), balance: number(row[6]) }))
    .filter((row) => row.date && row.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date));
  const debtorValue = byRange.debtor.find((row) => /текущая/i.test(text(row[0])))?.[2];
  const debtorTotal = debtorValue == null || text(debtorValue) === '' ? undefined : number(debtorValue);
  return {
    source: "google-sheets",
    updatedAt: input.updatedAt,
    cash,
    orders,
    debtor: { date: date(byRange.debtor[0]?.[1]), total: debtorTotal },
    creditor: { date: factoryRows.at(-1)?.date, factory: factoryRows.at(-1)?.balance },
    balances: { date: end, account: latestBalance(byRange.account, end, 1), wallet: latestBalance(byRange.wallet, end, 9) },
  };
}

