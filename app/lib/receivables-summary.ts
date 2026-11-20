import { addCents, blankCategories, calendarDate, cents, debtCategories, findHeaders, normalizeHeader, type DebtSnapshot } from './receivables';

/** Read the primary A:D report only. Side tables are alternative views of the same debt. */
export function parseReceivablesSummary(rows: unknown[][], asOf: string, updatedAt: string): DebtSnapshot {
  calendarDate(asOf);
  const names = ['Менеджер', 'Вид оплаты', 'Долг', 'Просрочка задолженности'];
  const { rowIndex, columns } = findHeaders(rows.slice(0, 45).map(row => row.slice(0, 4)), names);
  const categories = blankCategories();
  const summaryRows: NonNullable<DebtSnapshot['summaryRows']> = [];
  let totalCents = 0;
  for (let i = rowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    const values = names.map(name => row[columns[name]]);
    if (values.every(value => !String(value ?? '').trim())) continue;
    const [manager, paymentType, balance, rawCategory] = values;
    const label = normalizeHeader(rawCategory).replace(/ё/g, 'е');
    const category = debtCategories.find(value => {
      const name = normalizeHeader(value).replace(/ё/g, 'е');
      return label === name || label.startsWith(name + ' (');
    });
    if (!category || !String(manager ?? '').trim() || !String(paymentType ?? '').trim()) throw new Error(`Лист отчёта ДЗ: некорректные поля в строке ${i + 1}`);
    const balanceCents = cents(balance);
    if (balanceCents < 0) throw new Error(`Лист отчёта ДЗ: отрицательный долг в строке ${i + 1}`);
    totalCents = addCents(totalCents, balanceCents);
    categories[category] = addCents(categories[category], balanceCents);
    summaryRows.push({ manager: String(manager).trim(), paymentType: String(paymentType).trim(), category, balanceCents, row: i + 1 });
  }
  if (!summaryRows.length) throw new Error('Лист отчёта ДЗ не содержит подтверждённых строк');
  return { asOf, updatedAt, historical: false, totalCents, categories, advancesCents: null, bySource: {}, details: null, summaryRows, method: 'Готовый отчёт Google Sheets: менеджер / вид оплаты / категория' };
}
