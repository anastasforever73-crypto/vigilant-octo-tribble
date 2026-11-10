/** Original source rules and FIFO; public monetary values are integer kopecks. */
export const debtCategories = ['Текущая', 'Просроченная', 'Сомнительная', 'Безнадежная'] as const;
export type DebtCategory = typeof debtCategories[number];
export const debtSources = ['Транзит', 'Склад'] as const;
export type DebtSource = typeof debtSources[number];
export const sourceColumns = {
  Транзит: { date: 'Дата УПД', shipped: 'Ст-ть заказа', balance: 'Остаток долга', key: 'Конечный получатель' },
  Склад: { date: 'Дата отгрузки', shipped: 'сумма', balance: 'Долг', key: 'Направление' },
} as const;
export type Diagnostic = { source: string; reason: string; count: number; amountCents: number; unknownAmounts: number; rows: number[] };
export type DebtDetail = { source: DebtSource; key: string; date: string; age: number; category: DebtCategory; balanceCents: number; row: number };
export type ExcludedDebtRow = { source: DebtSource; row: number; reason: string; dateValue: string; balanceValue: string; key: string; amountCents: number };
export type DebtSummary = { totalCents: number; advancesCents: number | null; categories: Record<DebtCategory, number> };
export type SourceDebt = DebtSummary & { source: DebtSource; asOf: string; advancesCents: number; details: DebtDetail[]; excludedRows: ExcludedDebtRow[]; weeklyShipmentCents: number | null; dailyShipment?: { date: string; amountCents: number | null }; diagnostics: Diagnostic[]; complete: boolean; headerRow: number };
export type DebtSnapshot = DebtSummary & { asOf: string; bySource: Partial<Record<DebtSource, DebtSummary>>; updatedAt: string; historical: boolean; details: DebtDetail[] | null; partial?: boolean; method?: string };
export type DebtArchive = { status: 'available' | 'missing' | 'error'; message?: string; snapshots: DebtSnapshot[]; diagnostics: Diagnostic[] };
export type ReceivablesReport = { nlpkHistory?: import('./nlpk-payables').NlpkHistory; payables?: { factory: number; date: string; sheet: string }; payablesError?: string; asOf: string; updatedAt?: string; week: { start: string; end: string }; current: DebtSnapshot | null; sources: Partial<Record<DebtSource, SourceDebt>>; sourceSheets?: Record<DebtSource, string>; errors: Partial<Record<DebtSource, string>>; archive: DebtArchive; configurationError?: string };
export const normalizeHeader = (value: unknown) => String(value ?? '').replace(/[\s\u00a0\u202f]+/g, ' ').trim().toLocaleLowerCase('ru-RU');
const dayMs = 86400000;
export function moscowToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return ['year', 'month', 'day'].map(name => parts.find(p => p.type === name)!.value).join('-');
}
export function calendarDate(value: unknown): string {
  if (value instanceof Date) return moscowToday(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 1 || value > 2958465) throw new Error('Некорректная дата');
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * dayMs).toISOString().slice(0, 10);
  }
  const raw = String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:\d{2})$/.test(raw)) {
    calendarDate(raw.slice(0, 10));
    const date = new Date(raw); if (!Number.isFinite(date.getTime())) throw new Error('Некорректная дата');
    return moscowToday(date);
  }
  const ru = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/);
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/);
  const date = ru ? `${ru[3]}-${ru[2].padStart(2, '0')}-${ru[1].padStart(2, '0')}` : iso?.[1];
  if (!date || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('Некорректная дата');
  return date;
}
export function cents(value: unknown): number {
  if (typeof value !== 'number' && typeof value !== 'string') throw new Error('Некорректная сумма');
  const raw = (typeof value === 'number' ? value.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 }) : value).replace(/[\s\u00a0\u202f]/g, '').replace(/₽/g, '').replace(',', '.');
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(raw)) throw new Error('Некорректная сумма');
  const [whole, fraction = ''] = raw.replace(/^[+-]/, '').split('.');
  const amount = BigInt(whole) * BigInt(100) + BigInt((fraction + '00').slice(0, 2)) + BigInt(Number(fraction[2] || 0) >= 5 ? 1 : 0);
  const result = Number(amount) * (raw.startsWith('-') ? -1 : 1);
  if (!Number.isSafeInteger(result)) throw new Error('Сумма выходит за допустимый диапазон');
  return result;
}
export function addCents(a: number, b: number): number {
  const sum = a + b; if (!Number.isSafeInteger(sum)) throw new Error('Сумма выходит за допустимый диапазон'); return sum;
}
export const blankCategories = (): Record<DebtCategory, number> => ({ Текущая: 0, Просроченная: 0, Сомнительная: 0, Безнадежная: 0 });
export function previousWeek(asOf: string) {
  const day = new Date(calendarDate(asOf)).getUTCDay() || 7;
  const monday = Date.parse(asOf) - (day - 1) * dayMs;
  return { start: new Date(monday - 7 * dayMs).toISOString().slice(0, 10), end: new Date(monday - dayMs).toISOString().slice(0, 10) };
}
export function reportWeek(asOf: string) {
  const reportDate = Date.parse(calendarDate(asOf));
  return { start: new Date(reportDate - 7 * dayMs).toISOString().slice(0, 10), end: new Date(reportDate - dayMs).toISOString().slice(0, 10) };
}
export function findHeaders(rows: unknown[][], required: readonly string[], hintRow?: number) {
  const matches = (row: unknown[] | undefined) => !!row && required.every(name => row.some(cell => normalizeHeader(cell) === normalizeHeader(name)));
  const hinted = hintRow === undefined ? -1 : hintRow - 1;
  const rowIndex = matches(rows[hinted]) ? hinted : rows.findIndex(matches);
  if (rowIndex < 0) throw new Error('Не найдена строка со всеми обязательными заголовками');
  // Deliberately first occurrence, matching the source script's stated rule.
  const columns = Object.fromEntries(required.map(name => [name, rows[rowIndex].findIndex(cell => normalizeHeader(cell) === normalizeHeader(name))]));
  return { rowIndex, columns };
}
export function diagnose(list: Diagnostic[], source: string, reason: string, row: number, amount?: number) {
  let item = list.find(x => x.source === source && x.reason === reason);
  if (!item) { item = { source, reason, count: 0, amountCents: 0, unknownAmounts: 0, rows: [] }; list.push(item); }
  item.count++;
  if (amount == null) item.unknownAmounts++; else item.amountCents = addCents(item.amountCents, amount);
  if (item.rows.length < 20) item.rows.push(row);
}
export function categoryForAge(age: number): DebtCategory { return age <= 14 ? 'Текущая' : age <= 30 ? 'Просроченная' : age <= 180 ? 'Сомнительная' : 'Безнадежная'; }
/** Match Otchet_DZ.gs toNumber, including numeric prefixes and empty/text zeroes. */
export function sourceNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value == null || value === '') return 0;
  const parsed = parseFloat(String(value).replace(/\u00a0/g, '').replace(/\s/g, '').replace(/₽/g, '').replace(',', '.'));
  return Number.isNaN(parsed) ? 0 : parsed;
}
/** Source dates follow the original script; filters and archive retain strict calendarDate. */
export function sourceDate(value: unknown): string | undefined {
  if (value instanceof Date && Number.isFinite(value.getTime())) return moscowToday(value);
  if (typeof value === 'number' && value > 1000 && value < 100000) return moscowToday(new Date(Date.UTC(1899, 11, 30) + value * dayMs));
  if (typeof value !== 'string') return;
  const match = value.match(/(\d{1,2})[.\-\/\s](\d{1,2})[.\-\/\s](\d{2,4})/);
  if (!match) return;
  let year = Number(match[3]);
  if (year < 100) year += 2000;
  return new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[1]))).toISOString().slice(0, 10);
}
/** No historical balances are reconstructed here: the caller supplies today's Moscow date only. */
export function collectReceivables(rows: unknown[][], source: DebtSource, asOf: string, seenRows = new Set<string>()): SourceDebt {
  calendarDate(asOf);
  const hint = source === 'Транзит' ? 19 : 9;
  const names = sourceColumns[source], { rowIndex, columns } = findHeaders(rows.slice(0, Math.max(hint + 15, 45)), Object.values(names), hint);
  const result: SourceDebt = { source, asOf, totalCents: 0, advancesCents: 0, categories: blankCategories(), details: [], excludedRows: [], weeklyShipmentCents: 0, diagnostics: [], complete: true, headerRow: rowIndex + 1 };
  const week = reportWeek(asOf);
  let dailyShipmentCents = 0, dailyRows = 0, dailyInvalid = false;
  const groups = new Map<string, { debts: (Omit<DebtDetail, 'balanceCents'> & { amount: number })[]; credit: number }>();
  let shipment = 0, total = 0, advances = 0;
  const categories = blankCategories();
  rows.slice(rowIndex + 1).forEach((row, index) => {
    const rowNumber = rowIndex + index + 2;
    const value = (field: keyof typeof names) => row[columns[names[field]]];
    // The real sheet has a separate inventory table to the right. Only mapped
    // receivables columns define a source row; unrelated cells must not enter DZ.
    if (!Object.values(names).some(name => String(row[columns[name]] ?? '').trim())) return;
    const shipmentDate = sourceDate(value('date')), balance = sourceNumber(value('balance'));
    // Compare the entire source record up to the last financial column, so equal
    // amounts on different orders/items are not mistaken for duplicate debts.
    const fingerprint = JSON.stringify([rows[rowIndex].slice(0, Math.max(...Object.values(columns)) + 1).map(normalizeHeader), row.slice(0, Math.max(...Object.values(columns)) + 1).map(v => String(v ?? '').replace(/[\s\u00a0\u202f]+/g, ' ').trim())]);
    if (seenRows.has(fingerprint)) { diagnose(result.diagnostics, source, 'Повторная строка: учтена один раз', rowNumber, cents(balance)); return; }
    seenRows.add(fingerprint);

    const exclude = (reason: string) => {
      const amountCents = cents(balance);
      diagnose(result.diagnostics, source, reason, rowNumber, amountCents);
      result.excludedRows.push({ source, row: rowNumber, reason, dateValue: String(value('date') ?? ''), balanceValue: String(value('balance') ?? ''), key: String(value('key') ?? ''), amountCents });
    };
    if (shipmentDate === week.end) {
      dailyRows++;
      try { dailyShipmentCents = addCents(dailyShipmentCents, cents(value('shipped'))); }
      catch { dailyInvalid = true; }
    }
    // Shipment is an independent gross amount, including settled rows, never the balance.
    if (shipmentDate && shipmentDate >= week.start && shipmentDate <= week.end) {
      shipment += sourceNumber(value('shipped'));
    }
    if (balance === 0) {
      if (!String(value('balance') ?? '').trim()) exclude('Пустой остаток: принят за 0 по правилу скрипта');
      else if (Number.isNaN(parseFloat(String(value('balance')).replace(/\s/g, '').replace(/₽/g, '').replace(',', '.')))) exclude('Текстовый остаток: принят за 0 по правилу скрипта');
      return;
    }
    if (!shipmentDate) { exclude(source === 'Транзит' ? 'Нет даты УПД: неотгруженная заявка, исключена из ДЗ' : 'Нет даты отгрузки: исключено из ДЗ'); return; }
    if (shipmentDate > asOf) { exclude('Будущая дата отгрузки: исключено из ДЗ'); return; }
    if (typeof value('date') === 'string') {
      try { if (calendarDate(value('date')) !== shipmentDate) throw new Error(); }
      catch { diagnose(result.diagnostics, source, 'Нестандартная дата распознана по правилу скрипта; строка включена в ДЗ', rowNumber, cents(balance)); }
    }
    // Preserve the original script's fallback BEFORE trim: whitespace-only
    // keys form a separate empty-string group, unlike genuinely empty cells.
    const rawKey = value('key');
    const key = String(rawKey || '(без контрагента)').trim();
    if (!String(rawKey ?? '').trim()) {
      diagnose(result.diagnostics, source, 'Пустой ключ: строка включена в общую группу по правилу Apps Script', rowNumber, cents(balance));
    }
    let group = groups.get(key);
    if (!group) { group = { debts: [], credit: 0 }; groups.set(key, group); }
    if (balance < 0) group.credit += -balance;
    else {
      const age = Math.round((Date.parse(asOf) - Date.parse(shipmentDate)) / dayMs);
      group.debts.push({ source, key, date: shipmentDate, age, category: categoryForAge(age), amount: balance, row: rowNumber });
    }
  });
  for (const group of groups.values()) {
    group.debts.sort((a, b) => a.date.localeCompare(b.date) || a.row - b.row);
    for (const debt of group.debts) {
      const paid = Math.min(debt.amount, group.credit);
      debt.amount -= paid; group.credit -= paid;
      if (debt.amount > 0.005) {
        const { amount, ...detail } = debt;
        result.details.push({ ...detail, balanceCents: cents(amount) }); total += amount;
        categories[debt.category] += amount;
      }
    }
    if (group.credit > 0.005) advances -= group.credit;
  }
  result.totalCents = cents(total); result.advancesCents = cents(advances); result.weeklyShipmentCents = cents(shipment);
  result.dailyShipment = { date: week.end, amountCents: dailyRows && !dailyInvalid ? dailyShipmentCents : null };
  for (const category of debtCategories) result.categories[category] = cents(categories[category]);
  return result;
}
export function combineDebt(sources: Partial<Record<DebtSource, SourceDebt>>, updatedAt: string): DebtSnapshot | null {
  const available = debtSources.flatMap(source => sources[source]?.complete ? [sources[source]!] : []);
  if (!available.length || available.some(s => s.asOf !== available[0].asOf)) return null;
  return { asOf: available[0].asOf, updatedAt, historical: false, partial: available.length !== debtSources.length, totalCents: available.reduce((sum, s) => addCents(sum, s.totalCents), 0), advancesCents: available.reduce((sum, s) => addCents(sum, s.advancesCents), 0), categories: Object.fromEntries(debtCategories.map(c => [c, available.reduce((sum, s) => addCents(sum, s.categories[c]), 0)])) as Record<DebtCategory, number>, bySource: Object.fromEntries(available.map(s => [s.source, s])), details: available.flatMap(s => s.details) };
}
export function topDebtors(snapshot: DebtSnapshot) {
  if (!snapshot.details) return null;
  const groups = new Map<string, { source: DebtSource; key: string; balanceCents: number }>();
  for (const row of snapshot.details) {
    const id = JSON.stringify([row.source, row.key]);
    const group = groups.get(id) || { source: row.source, key: row.key, balanceCents: 0 };
    group.balanceCents = addCents(group.balanceCents, row.balanceCents); groups.set(id, group);
  }
  return [...groups.values()].sort((a, b) => b.balanceCents - a.balanceCents).slice(0, 10);
}
export function debtAt(report: ReceivablesReport, date: string) { return date === report.asOf ? report.current : report.archive.snapshots.find(s => s.asOf === date) || null; }

export function archiveSeries(report: ReceivablesReport, start: string, end: string) {
  const points = new Map(report.archive.snapshots.map(snapshot => [snapshot.asOf, snapshot.totalCents / 100]));
  const result: { date: string; debt: number | null }[] = [];
  const first = Date.parse(calendarDate(start)), last = Date.parse(calendarDate(end));
  if (last < first || last - first > 366 * dayMs) return result;
  for (let day = first; day <= last; day += dayMs) {
    const date = new Date(day).toISOString().slice(0, 10);
    result.push({ date, debt: points.get(date) ?? null });
  }
  return result;
}
