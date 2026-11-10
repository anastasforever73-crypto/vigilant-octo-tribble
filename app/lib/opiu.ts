export const OPIU_SHEET = 'Анализ ОПИУ ';
export const OPIU_WORKBOOK = '1vwjHUAcbOZAtYuptKp8PU0Y93a3wnl2LNfzBIrhCMaM';
export const EXCLUDED_MONTH = '2026-09';
export const segments = ['ИТОГО', 'ТРАНЗИТ', 'СКЛАД'] as const;
export type Segment = typeof segments[number];
export type OpiuCell = { value: number | null; text: string; state: 'number' | 'blank' | 'error' | 'text'; address: string };
export type OpiuRow = { row: number; label: string; percent: boolean; bold: boolean; cells: Record<string, Partial<Record<Segment, OpiuCell>>> };
export type OpiuReport = { archive?: import('./period-archive').ArchiveInfo; sheet: string; url: string; updatedAt: string; months: string[]; defaultMonth: string; rows: OpiuRow[] };
export type GridCell = { effectiveValue?: { numberValue?: number | null; stringValue?: string | null; errorValue?: { type?: string | null; message?: string | null } | null } | null; formattedValue?: string | null; effectiveFormat?: { numberFormat?: { type?: string | null } | null; textFormat?: { bold?: boolean | null } | null } | null };
export function columnName(index: number): string {
  let result = '';
  for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result;
  return result;
}
export function sourceCell(cell: GridCell | undefined, address: string): OpiuCell {
  const v = cell?.effectiveValue;
  if (v?.errorValue) return { value: null, text: cell?.formattedValue || v.errorValue.type || 'Ошибка', state: 'error', address };
  if (typeof v?.numberValue === 'number' && Number.isFinite(v.numberValue)) return { value: v.numberValue, text: cell?.formattedValue ?? String(v.numberValue), state: 'number', address };
  const text = cell?.formattedValue ?? v?.stringValue ?? '';
  return { value: null, text, state: text ? 'text' : 'blank', address };
}
const monthNames = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
export function parseOpiu(grid: { values?: GridCell[] }[], sheetId: number, updatedAt = new Date().toISOString()): OpiuReport {
  const year = grid[0]?.values?.[0]?.formattedValue?.match(/\b(20\d{2})\b/)?.[1];
  if (!year) throw new Error('Не найден год отчёта ОПиУ');
  let segment: Segment | undefined;
  const columns: { index: number; month: string; segment: Segment }[] = [];
  (grid[3]?.values || []).forEach((cell, index) => {
    const group = grid[2]?.values?.[index]?.formattedValue?.trim().toUpperCase();
    if (group) segment = segments.find(s => s === group);
    const m = monthNames.indexOf((cell.formattedValue || '').trim().toLowerCase());
    const month = `${year}-${String(m + 1).padStart(2, '0')}`;
    if (segment && m >= 0 && month !== EXCLUDED_MONTH) columns.push({ index, month, segment });
  });
  const months = [...new Set(columns.filter(c => c.segment === 'ИТОГО').map(c => c.month))].sort();
  if (!months.length || !segments.every(segment => columns.some(c => c.segment === segment)) || new Set(columns.map(c => `${c.month}:${c.segment}`)).size !== columns.length) throw new Error('Изменилась структура месяцев ОПиУ');
  const rows = grid.slice(5).map((line, i): OpiuRow => {
    const label = line.values?.[0]?.formattedValue || '';
    const cells: OpiuRow['cells'] = {};
    for (const c of columns) {
      cells[c.month] ||= {};
      cells[c.month][c.segment] = sourceCell(line.values?.[c.index], `${columnName(c.index)}${i + 6}`);
    }
    return { row: i + 6, label, percent: columns.some(c => line.values?.[c.index]?.effectiveFormat?.numberFormat?.type === 'PERCENT'), bold: Boolean(line.values?.[0]?.effectiveFormat?.textFormat?.bold), cells };
  });
  while (rows.length && !rows.at(-1)!.label && Object.values(rows.at(-1)!.cells).every(c => Object.values(c).every(v => v.state === 'blank'))) rows.pop();
  return { sheet: OPIU_SHEET, url: `https://docs.google.com/spreadsheets/d/${OPIU_WORKBOOK}/edit#gid=${sheetId}`, updatedAt, months, defaultMonth: months.filter(m => m < EXCLUDED_MONTH).at(-1) || months[0], rows };
}
export function aggregateRow(row: OpiuRow, months: string[], segment: Segment): OpiuCell {
  const cells = months.filter(m => m !== EXCLUDED_MONTH).map(m => row.cells[m]?.[segment]);
  if (!cells.length) return { value: null, text: 'Нет данных', state: 'blank', address: '' };
  if (cells.length === 1 && cells[0]) return cells[0];
  const address = cells.map(c => c?.address).filter(Boolean).join(', ');
  const error = cells.find(c => c?.state === 'error');
  if (error) return { ...error, address };
  if (row.percent) return { value: null, text: 'Не суммируется', state: 'text', address };
  if (cells.some(c => !c || c.state !== 'number')) return { value: null, text: 'Нет полного итога', state: 'blank', address };
  const value = cells.reduce((sum, c) => sum + c!.value!, 0);
  return { value, text: value.toLocaleString('ru-RU', { maximumFractionDigits: 0 }), state: 'number', address };
}
export function previousMonths(months: string[], available: string[]): string[] {
  if (!months.length) return [];
  const first = new Date(`${months[0]}-01T00:00:00Z`);
  const previous = months.map((_, i) => new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() - months.length + i, 1)).toISOString().slice(0, 7));
  return previous.every(m => m !== EXCLUDED_MONTH && available.includes(m)) ? previous : [];
}
export const monthLabel = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' });
