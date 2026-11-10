import { ConnectionError, type Binding } from './model';
/** Identical normalized rows count once; object snapshots are never summed. */
export function mergeRows(values: unknown[]): unknown {
  if (!values.every(Array.isArray)) throw new ConnectionError('merge', 'Объединение доступно только для строк. Для остатков выберите основной и резервный источник.');
  const seen = new Set<string>();
  return values.flat().filter(row => {
    const key = JSON.stringify(row, Object.keys(row as object).sort());
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
export function resolveValues(entries: { binding: Binding; value: unknown; name: string }[]): unknown {
  const available = entries.filter(e => e.value !== undefined);
  if (!available.length) return undefined;
  const ordered = available.sort((a, b) => (a.binding.mode === 'fallback' ? 1 : 0) - (b.binding.mode === 'fallback' ? 1 : 0) || (a.binding.priority ?? 50) - (b.binding.priority ?? 50) || a.name.localeCompare(b.name));
  if (ordered[0].binding.mode === 'merge') {
    const merged = entries.filter(e => e.binding.mode === 'merge');
    if (merged.some(e => e.value === undefined)) return ordered.find(e => e.binding.mode === 'fallback')?.value;
    return mergeRows(merged.map(e => e.value));
  }
  return ordered[0].value;
}
export const bindingKey = (b: Binding) => JSON.stringify([b.section, b.dataset, b.sheet, b.headerRow, Object.entries(b.columns).sort()]);
