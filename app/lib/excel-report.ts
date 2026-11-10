import { applyExcelFormulas, type ExportTable } from './excel-formulas';
import { summarizePlan } from './planning';
import { nlpkTotal } from './nlpk-payables';
import type { DashboardData } from './dashboard-data';
import { sectionData } from './connections/compose';
import { buildLive } from './live-data';
import { debtAt, debtCategories, debtSources, topDebtors } from './receivables';
import { compareReceivables } from './receivables-comparison';
import { aggregateRow, previousMonths, type OpiuReport, type Segment } from './opiu';

export const reportTitles = { plan: 'Планирование', overview: 'Оперативный дашборд', cash: 'ДДС', opiu: 'ОПиУ', balance: 'Баланс', debt: 'Дебиторская задолженность', sales: 'Продажи по менеджерам' } as const;
export type ReportSection = keyof typeof reportTitles;
export type ExportOptions = { section: ReportSection; start: string; end: string; compare: boolean; asOf?: string; segment?: Segment; mode?: string };
type Value = string | number | Date | null | undefined;
type Table = { title: string; headers: string[]; rows: Value[][]; formats?: Record<number, string>; rowFormats?: Record<number, string> };
export type ExcelReport = { title: string; start: string; end: string; notes: string[]; tables: Table[]; details: Table[] };
export const RUB = '#,##0.00 "₽";[Red]-#,##0.00 "₽"';
const missing = 'Нет данных';
export const ruDate = (value: string) => value.slice(0, 10).split('-').reverse().join('.');
const day = (value?: string) => value ? new Date(value.slice(0, 10) + 'T00:00:00Z') : null;
const rubles = (cents: number | null | undefined) => cents == null ? null : cents / 100;
function base(o: ExportOptions): ExcelReport {
  return { title: reportTitles[o.section], start: o.start, end: o.end, notes: [`Сравнение с предыдущим периодом: ${o.compare ? 'включено' : 'выключено'}`], tables: [], details: [] };
}
function metrics(rows: Value[][], compare = false): Table { return { title: 'Ключевые показатели', headers: ['Показатель', 'Значение', ...(compare ? ['Предыдущий период', 'Изменение'] : [])], rows, formats: compare ? { 2: RUB, 3: RUB, 4: RUB } : { 2: RUB } }; }

/** Explicit business-field allowlists. Never serialize source/configuration objects into a workbook. */
export function dashboardReport(data: DashboardData, o: ExportOptions): ExcelReport {
  const report = base(o), source = sectionData(data, o.section), live = buildLive(source, o.start, o.end, o.compare);
  const previousEnd = new Date(Date.parse(o.start) - 86400000).toISOString().slice(0, 10);
  const previousStart = new Date(Date.parse(o.start) - (Date.parse(o.end) - Date.parse(o.start) + 86400000)).toISOString().slice(0, 10);
  if (o.compare) report.notes.push(`Предыдущий период: ${ruDate(previousStart)}–${ruDate(previousEnd)}`);
  if (data.updatedAt) report.notes.push(`Данные по состоянию на ${new Date(data.archive?.observedAt || data.updatedAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} МСК`);
  if (o.section === 'overview') {
    const op = data.operational;
    report.notes.push('Фактические остатки и операции за прошлый день отражены по правилам оперативного дашборда. Фактическая дата указана у каждого показателя.');
    if (o.compare) report.notes.push('Сравнение оперативных остатков отсутствует в текущем отчёте.');
    const labels = { account: 'Расчётный счёт', wallet: 'Кошелёк', deposit: 'Депозит', total: 'Остатки ДС — всего', debt: 'Общая ДЗ', payables: 'КЗ НЛПК', shipments: 'Отгрузки за прошлый день', receipts: 'Поступления выручки за прошлый день' };
    report.tables.push({ title: 'Ключевые показатели', headers: ['Показатель', 'Сумма', 'Дата'], formats: { 2: RUB }, rows: Object.entries(labels).map(([key, label]) => { const m = op?.[key as keyof typeof labels]; return [label, m?.value, day(m?.date)]; }) });

    if (op?.account?.breakdown?.length) report.details.push({ title: 'Расчётные счета', headers: ['Счёт', 'Остаток'], formats: { 2: RUB }, rows: op.account.breakdown.map(row => [row.name, row.value]) });
    if (op?.walletConversion?.raw != null) report.details.push({ title: 'Расчёт кошелька', headers: ['Показатель', 'Значение'], formats: { 2: RUB }, rowFormats: { 1: '0.00%' }, rows: [['Исходный остаток', op.walletConversion.raw], ['Надбавка', (op.walletConversion.percent ?? 0) / 100]] });
  } else if (o.section === 'plan') {
    const summaries = ['planReceipts', 'planPayments'].map(key => {
      const rows = source[key as 'planReceipts' | 'planPayments'];
      return { key, rows, current: rows === undefined ? null : summarizePlan(rows, o.start, o.end), prior: rows === undefined ? null : summarizePlan(rows, previousStart, previousEnd) };
    });
    const [receipts, payments] = summaries;
    const net = (a: number | null | undefined, b: number | null | undefined) => a == null || b == null ? null : (Math.round(a * 100) - Math.round(b * 100)) / 100;
    const values = [receipts.current?.total, payments.current?.total, net(receipts.current?.total, payments.current?.total)];
    const priors = [receipts.prior?.total, payments.prior?.total, net(receipts.prior?.total, payments.prior?.total)];
    report.tables.push(metrics(['План поступлений', 'План списаний', 'Плановый денежный поток'].map((label, i) => [label, values[i], ...(o.compare ? [priors[i], net(values[i], priors[i])] : [])]), o.compare));
    report.tables.push({ title: 'Плановый остаток денежных средств', headers: ['Показатель', 'Сумма'], formats: { 2: RUB }, rows: [['Плановый остаток денежных средств', source.plannedBalance?.value ?? data.plannedBalance?.value]] });
    report.notes.push('Планы относятся к дате ожидаемой операции. Суммы поступлений и списаний положительные; поток — их разность.');
    for (const summary of summaries) {
      const label = summary.key === 'planReceipts' ? 'План поступлений' : 'План списаний';
      if (!summary.current) report.notes.push(`${label}: источник недоступен или не подключён.`);
      const categories = [...new Set([...(summary.current?.categories || []).map(r => r.category), ...(o.compare ? (summary.prior?.categories || []).map(r => r.category) : [])])];
      const amounts = new Map(summary.current?.categories.map(r => [r.category, r.amount]) || []);
      const old = new Map(summary.prior?.categories.map(r => [r.category, r.amount]) || []);
      report.tables.push({ title: `${label} по категориям`, headers: ['Категория', 'План', 'Доля', ...(o.compare ? ['Предыдущий период', 'Изменение'] : [])], formats: { 2: RUB, 3: '0.0%', 4: RUB, 5: RUB }, rows: categories.map(category => { const amount = amounts.get(category) || 0, previous = old.get(category) || 0; return [category, amount, summary.current?.total ? amount / summary.current.total : null, ...(o.compare ? [previous, net(amount, previous)] : [])]; }) });
      report.details.push({ title: label, headers: ['Период', 'Дата', 'Категория', 'Сумма', 'Контрагент', 'Комментарий'], formats: { 4: RUB }, rows: [...(summary.current?.rows || []).map(r => ({ r, period: 'Выбранный' })), ...(o.compare ? (summary.prior?.rows || []).map(r => ({ r, period: 'Предыдущий' })) : [])].map(({ r, period }) => [period, day(r.date), r.category, r.amount, r.counterparty, r.note]) });
    }
  } else if (o.section === 'cash') {
    const planning = source.planningSummary || data.planningSummary;
    if (planning) report.details.push({ title: 'Выполнение плана', headers: ['Показатель', 'План', 'Факт', 'Выполнение'], formats: { 2: RUB, 3: RUB, 4: '0.0%' }, rows: [['Поступления', planning.receipts, live.incoming, planning.receipts != null && planning.receipts > 0 && live.incoming != null ? live.incoming / planning.receipts : null], ['Списания', planning.payments, live.outgoing, planning.payments != null && planning.payments > 0 && live.outgoing != null ? live.outgoing / planning.payments : null], ['Денежный поток', planning.net, live.net, planning.net != null && planning.net > 0 && live.net != null ? live.net / planning.net : null]] });
    const old = buildLive(source, previousStart, previousEnd, false);
    const comparison = (value: number | undefined, prior: number | undefined) => o.compare ? [live.transactions.length ? value : null, old.transactions.length ? prior : null, live.transactions.length && old.transactions.length && value != null && prior != null ? value - prior : null] : [live.transactions.length ? value : null];
    report.tables.push(metrics([['Поступления', ...comparison(live.incoming, old.incoming)], ['Выплаты', ...comparison(live.outgoing, old.outgoing)], ['Чистый денежный поток', ...comparison(live.net, old.net)]], o.compare));
    const articles = new Map<string, number>();
    live.transactions.forEach(r => articles.set(r.article, (articles.get(r.article) || 0) + r.amount));
    report.tables.push({ title: 'Статьи ДДС', headers: ['Статья', 'Сумма'], rows: [...articles], formats: { 2: RUB } });
    report.details.push({ title: 'Операции ДДС', headers: ['Период', 'Дата', 'Сумма', 'Контрагент', 'Статья', 'Поток'], rows: [...live.transactions.map(r => ['Выбранный', day(r.date), r.amount, r.counterparty, r.article, r.flow]), ...(o.compare ? old.transactions.map(r => ['Предыдущий', day(r.date), r.amount, r.counterparty, r.article, r.flow]) : [])], formats: { 3: RUB } });
  } else if (o.section === 'sales') {
    const current = source.orders.filter(r => r.date >= o.start && r.date <= o.end);
    const old = source.orders.filter(r => r.date >= previousStart && r.date <= previousEnd);
    const sum = (rows: typeof current) => rows.length ? rows.reduce((s, r) => s + r.revenue, 0) : null;
    const total = sum(current), prior = sum(old);
    report.tables.push(metrics([['Выручка', total, ...(o.compare ? [prior, total != null && prior != null ? total - prior : null] : [])]], o.compare));
    const names = [...new Set([...current, ...(o.compare ? old : [])].map(r => r.manager).filter(Boolean))];
    report.tables.push({ ...metrics(names.map(name => { const a = sum(current.filter(r => r.manager === name)), b = sum(old.filter(r => r.manager === name)); return [name, a, ...(o.compare ? [b, a != null && b != null ? a - b : null] : [])]; }), o.compare), title: 'Выручка по менеджерам', headers: ['Менеджер', 'Выручка', ...(o.compare ? ['Предыдущий период', 'Изменение'] : [])] });
    report.details.push({ title: 'Продажи', headers: ['Период', 'Дата', 'Заказ', 'Плательщик', 'Клиент', 'Регион', 'Товар', 'Количество', 'Выручка', 'Менеджер', 'Подразделение', 'Оплачено', 'Долг'], formats: { 9: RUB, 12: RUB, 13: RUB }, rows: [...current.map(r => ({ r, p: 'Выбранный' })), ...(o.compare ? old.map(r => ({ r, p: 'Предыдущий' })) : [])].map(({ r, p }) => [p, day(r.date), r.order, r.payer, r.client, r.region, r.product, r.qty, r.revenue, r.manager, r.department, r.paid, r.debt]) });
  } else if (o.section === 'balance') {
    const rows = data.sections?.balance?.balanceSheet || [];
    report.tables.push({ title: 'Показатели баланса', headers: ['Дата', 'Раздел', 'Статья', 'Сумма'], rows: rows.map(r => [day(r.date), r.category, r.article, r.amount]), formats: { 4: RUB } });
    report.details.push({ ...report.tables[0], title: 'Доступные статьи баланса' });
    if (o.compare) report.notes.push('Сравнение баланса отсутствует в текущем отчёте; исторические остатки не восстанавливаются.');
  } else if (o.section === 'debt') {
    const debt = data.receivables, asOf = o.asOf || debt?.asOf || o.end, snapshot = debt ? debtAt(debt, asOf) : null;
    report.notes.push(`Дата расчёта ДЗ: ${ruDate(asOf)}. ДЗ — остаток на дату, включая старые непогашенные долги.`);
    if (snapshot?.partial) report.notes.push('Частичный результат: только доступные листы. Общая ДЗ не подтверждена.');
    report.tables.push(metrics([[snapshot?.partial ? 'ДЗ по доступным листам (частично)' : 'Общая ДЗ', rubles(snapshot?.totalCents)], ['Авансы и переплаты', rubles(snapshot?.advancesCents)], ...debtSources.map(s => [`ДЗ «${s}»`, rubles(snapshot?.bySource[s]?.totalCents)]), ['Кредиторская задолженность', source.creditor.total ?? live.factoryDebt], ['Оплаты поставщикам', data.debtPayments ?? live.factoryPayments]]));
    const nlpk = source.nlpkPayables ?? data.nlpkPayables;
    if (nlpk !== undefined || source.nlpkConfigured) {
      report.tables.push(metrics([['Кредиторская задолженность НЛПК', nlpk ? nlpkTotal(nlpk) : null]]));
      report.details.push({ title: 'Кредиторская задолженность НЛПК', headers: ['Дата остатка', 'Документ', 'Срок оплаты', 'Остаток долга', 'Комментарий'], formats: { 4: RUB }, rows: (nlpk || []).map(r => [day(r.date), r.document, day(r.dueDate), r.balance, r.note]) });
      report.notes.push('НЛПК: последний снимок не позже конца выбранного периода; снимки разных дат не суммируются.');
    }
    const top = snapshot ? topDebtors(snapshot) : null;
    report.tables.push({ title: 'ТОП дебиторов', headers: ['Источник', 'Ключ группировки', 'Остаток'], rows: top?.map(r => [r.source, r.key, r.balanceCents / 100]) || [], formats: { 3: RUB } });
    report.tables.push({ title: 'Возрастная разбивка', headers: ['Категория', 'Сумма'], rows: debtCategories.map(c => [c, rubles(snapshot?.categories[c])]), formats: { 2: RUB } });
    if (o.compare) { const c = compareReceivables(debt, o.start, o.end); report.tables.push({ ...metrics([['ДЗ на конец выбранного периода', rubles(c.current)], ['ДЗ на конец предыдущего периода', rubles(c.previous)], ['Изменение', rubles(c.change)], ['Изменение, %', c.percent == null ? null : c.percent / 100]]), title: 'Сравнение ДЗ', rowFormats: { 3: '0.00%' } }); }
    report.details.push({ title: 'Детализация ДЗ', headers: ['Источник', 'Ключ группировки', 'Дата отгрузки', 'Возраст, дней', 'Категория', 'Остаток после зачёта', 'Строка источника'], rows: snapshot?.details?.map(r => [r.source, r.key, day(r.date), r.age, r.category, r.balanceCents / 100, r.row]) || [], formats: { 6: RUB } });
    if (!snapshot?.details) report.notes.push('Детализация ДЗ недоступна; агрегированный архив не содержит исходных строк.');
  }
  return report;
}
export function opiuReport(data: OpiuReport, o: ExportOptions): ExcelReport {
  const report = base(o), segment = o.segment || 'ИТОГО';
  const months = data.months.filter(m => m >= o.start.slice(0, 7) && m <= o.end.slice(0, 7)), previous = previousMonths(months, data.months);
  report.notes.push(`Блок: ${segment}`);
  if (o.compare) report.notes.push(previous.length ? `Предыдущий период: ${previous.map(m => ruDate(m + '-01')).join(', ')}` : 'Нет полного предыдущего периода для сравнения');
  const rows = data.rows.map(row => { const a = aggregateRow(row, months, segment), b = aggregateRow(row, previous, segment); return [row.label || `Строка ${row.row}`, a.value ?? a.text, ...(o.compare ? [b.value ?? b.text, !row.percent && a.value != null && b.value != null ? a.value - b.value : null] : [])]; });
  const table = { ...metrics(rows, o.compare), title: 'Показатели ОПиУ', rowFormats: Object.fromEntries(data.rows.flatMap((r, i) => r.percent ? [[i, '0.00%']] : [])) };
  report.tables.push(table);
  const detailRows: Value[][] = [], rowFormats: Record<number, string> = {};
  for (const row of data.rows) for (const m of [...months, ...(o.compare ? previous : [])]) {
    const cell = aggregateRow(row, [m], segment);
    if (row.percent) rowFormats[detailRows.length] = '0.00%';
    detailRows.push([months.includes(m) ? 'Выбранный' : 'Предыдущий', day(m + '-01'), row.label || `Строка ${row.row}`, segment, cell.value ?? cell.text]);
  }
  report.details.push({ title: 'Статьи по месяцам', headers: ['Период', 'Месяц', 'Статья', 'Блок', 'Значение'], rows: detailRows, formats: { 5: RUB }, rowFormats });
  return report;
}

export async function writeExcel(report: ExcelReport) {
  // Loaded only by the export endpoint, never by initial page rendering or the client bundle.
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const exportedTables: ExportTable[] = [];
  workbook.creator = 'Март-Трейд'; workbook.created = new Date();
  for (const [name, tables] of [['Отчёт', report.tables], ['Детализация', report.details]] as const) {
    const sheet = workbook.addWorksheet(name);
    sheet.addRow([report.title]); sheet.getRow(1).font = { bold: true, size: 16 };
    sheet.addRow(['Период', `${ruDate(report.start)}–${ruDate(report.end)}`]);
    sheet.addRow(['Сформирован', new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) + ' МСК']);
    report.notes.forEach(note => sheet.addRow([note]));
    if (!tables.some(t => t.rows.some(row => row.some(v => typeof v === 'number')))) sheet.addRow(['Нет данных за выбранный период']);
    for (const [index, table] of tables.entries()) {
      sheet.addRow([]); sheet.addRow([table.title]);
      const header = sheet.rowCount + 1;
      if (!table.rows.length) { sheet.addRow(['Нет данных за выбранный период']); continue; }
      sheet.addTable({ name: `${name === 'Отчёт' ? 'Report' : 'Detail'}${index}`, ref: `A${header}`, headerRow: true, totalsRow: false, style: { theme: 'TableStyleMedium2', showRowStripes: true }, columns: table.headers.map(name => ({ name, filterButton: true })), rows: table.rows.map(row => row.map(value => value == null || typeof value === 'number' && !Number.isFinite(value) ? missing : typeof value === 'string' ? value.slice(0, 32767) : value)) });
      exportedTables.push({ table, sheet, first: header + 1, last: header + table.rows.length });
      table.rows.forEach((_, i) => sheet.getRow(header + 1 + i).eachCell((cell, col) => {
        if (cell.value instanceof Date) cell.numFmt = 'dd.mm.yyyy';
        else if (typeof cell.value === 'number') cell.numFmt = table.rowFormats?.[i] || table.formats?.[col] || '0.00';
      }));
    }
    sheet.columns.forEach((column, index) => { column.width = index === 0 ? 48 : 26; });
    sheet.views = [{ state: 'frozen', ySplit: 3 }];
  }
  applyExcelFormulas(workbook, report, exportedTables);
  return workbook.xlsx.writeBuffer();
}
