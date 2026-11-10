import { addCents, blankCategories, calendarDate, cents, debtCategories, debtSources, diagnose, findHeaders, normalizeHeader, type DebtArchive, type DebtCategory, type DebtSnapshot, type DebtSource, type DebtSummary } from './receivables';
const required = ['Дата отчёта', 'Неделя с', 'Неделя по', 'Источник', 'Показатель', 'Категория', 'Сумма', 'Способ', 'Обновлено'];
function updated(value: unknown): string {
  if (typeof value === 'number') return new Date(Date.UTC(1899, 11, 30) + value * 86400000 - 3 * 3600000).toISOString();
  const raw = String(value ?? '').trim();
  const ru = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ ,]+(\d{2}:\d{2}(?::\d{2})?))?$/);
  const normalized = ru ? `${ru[3]}-${ru[2].padStart(2,'0')}-${ru[1].padStart(2,'0')}T${ru[4] || '00:00:00'}+03:00` : /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00+03:00` : /(?:Z|[+-]\d{2}:\d{2})$/.test(raw) ? raw : raw.replace(' ', 'T') + '+03:00';
  const date = new Date(normalized); if (!Number.isFinite(date.getTime())) throw new Error('Некорректное время обновления');
  return date.toISOString();
}
/** Only complete, non-conflicting archived snapshots are eligible for history. Never fill gaps with zero. */
export function parseDebtArchive(rows: unknown[][], today: string): DebtArchive {
  const result: DebtArchive = { status: 'available', snapshots: [], diagnostics: [] };
  const { rowIndex, columns } = findHeaders(rows, required);
  type Version = { date: string; time: string; method: string; values: Map<string, number>; invalid: boolean };
  const versions = new Map<string, Version>();
  const invalidDates = new Set<string>();
  for (let i = rowIndex + 1; i < rows.length; i++) {
    const row = rows[i]; if (!row.some(cell => String(cell ?? '').trim())) continue;
    const cell = (name: string) => row[columns[name]];
    let reportDate = '';
    try {
      const date = calendarDate(cell('Дата отчёта'));
      reportDate = date;
      if (date > today) { diagnose(result.diagnostics, 'Архив ДЗ', 'Исключена будущая дата отчёта', i + 1); continue; }
      const source = debtSources.find(s => normalizeHeader(s) === normalizeHeader(cell('Источник')));
      if (!source) { diagnose(result.diagnostics, 'Архив ДЗ', 'Неизвестный источник; итоговые строки не суммируются повторно', i + 1); continue; }
      const indicator = normalizeHeader(cell('Показатель'));
      if (indicator.includes('отгрузк')) continue;
      const category = debtCategories.find(c => normalizeHeader(c) === normalizeHeader(cell('Категория')));
      const advance = /^(авансы и переплаты|аванс|авансы|переплаты)$/.test(indicator) || normalizeHeader(cell('Категория')) === 'авансы и переплаты';
      const debt = /^(дз|дебиторская задолженность|задолженность|дебиторка)$/.test(indicator);
      const total = debt && /^(итого|общая дз|всего)$/.test(normalizeHeader(cell('Категория')));
      if (!advance && !(debt && (category || total))) { diagnose(result.diagnostics, 'Архив ДЗ', 'Неизвестные показатель или категория архива', i + 1); continue; }
      const start = calendarDate(cell('Неделя с')), end = calendarDate(cell('Неделя по'));
      if (start > end) throw new Error();
      const time = updated(cell('Обновлено')), method = String(cell('Способ') ?? '').trim();
      const versionKey = JSON.stringify([date, start, end, time, method]);
      const version = versions.get(versionKey) || { date, time, method, values: new Map(), invalid: false };
      versions.set(versionKey, version);
      const slot = `${source}:${advance ? 'advances' : total ? 'total' : category}`;
      const amount = cents(cell('Сумма'));
      if ((advance && amount > 0) || (!advance && amount < 0) || version.values.has(slot)) version.invalid = true;
      version.values.set(slot, amount);
    } catch { if (reportDate) invalidDates.add(reportDate); diagnose(result.diagnostics, 'Архив ДЗ', 'Некорректная строка архива; снимок не подтверждён', i + 1); }
  }
  const candidates: DebtSnapshot[] = [];
  for (const version of versions.values()) {
    const bySource = {} as Record<DebtSource, DebtSummary>;
    for (const source of debtSources) {
      const categories = blankCategories(); let totalCents = 0;
      for (const category of debtCategories) {
        const value = version.values.get(`${source}:${category}`);
        if (value == null) version.invalid = true;
        else { categories[category] = value; totalCents = addCents(totalCents, value); }
      }
      const declared = version.values.get(`${source}:total`);
      if (declared != null && declared !== totalCents) version.invalid = true;
      bySource[source] = { totalCents, categories, advancesCents: version.values.get(`${source}:advances`) ?? null };
    }
    if (version.invalid || invalidDates.has(version.date)) { diagnose(result.diagnostics, 'Архив ДЗ', 'Неполный, повторяющийся или несогласованный снимок', 0); continue; }
    candidates.push({ asOf: version.date, updatedAt: version.time, method: version.method, historical: true, details: null, bySource, totalCents: addCents(bySource.Транзит.totalCents, bySource.Склад.totalCents), advancesCents: bySource.Транзит.advancesCents === null || bySource.Склад.advancesCents === null ? null : addCents(bySource.Транзит.advancesCents, bySource.Склад.advancesCents), categories: Object.fromEntries(debtCategories.map(c => [c, addCents(bySource.Транзит.categories[c], bySource.Склад.categories[c])])) as Record<DebtCategory, number> });
  }
  for (const date of [...new Set(candidates.map(s => s.asOf))]) {
    const snapshots = candidates.filter(s => s.asOf === date).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
    if (new Set(snapshots.map(s => s.method)).size > 1) { diagnose(result.diagnostics, 'Архив ДЗ', 'Несколько способов расчёта на одну дату — снимок неоднозначен', 0); continue; }
    result.snapshots.push(snapshots[0]);
  }
  result.snapshots.sort((a,b) => a.asOf.localeCompare(b.asOf));
  return result;
}
