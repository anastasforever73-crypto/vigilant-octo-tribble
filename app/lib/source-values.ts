export function text(value: unknown) { return value == null ? '' : String(value).trim(); }
export function number(value: unknown): number {
  if (value == null || text(value) === '') return 0;
  const raw = typeof value === 'number' ? value : Number(text(value).replace(/[\s\u00a0\u202f]/g, '').replace(/₽/g, '').replace(',', '.'));
  if (!Number.isFinite(raw)) throw new Error('Некорректное число в источнике');
  return raw;
}
export function date(value: unknown): string {
  if (value == null || text(value) === '') return '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Некорректная дата');
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000).toISOString().slice(0, 10);
  }
  const raw = text(value);
  const ru = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s.*)?$/);
  const normalized = ru ? `${ru[3]}-${ru[2].padStart(2, '0')}-${ru[1].padStart(2, '0')}` : raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new Error('Некорректная дата');
  const d = new Date(`${normalized}T00:00:00Z`);
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== normalized) throw new Error('Некорректная дата');
  return normalized;
}
export function period(params: URLSearchParams) {
  const end = date(params.get('end') || new Date().toISOString().slice(0, 10));
  const start = date(params.get('start') || `${end.slice(0, 4)}-01-01`);
  const days = (Date.parse(end) - Date.parse(start)) / 86400000 + 1;
  if (days < 1 || days > 366) throw new Error('Выберите период от 1 до 366 дней');
  return { start, end, comparisonStart: new Date(Date.parse(start) - days * 86400000).toISOString().slice(0, 10) };
}
