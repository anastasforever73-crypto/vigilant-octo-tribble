import type { Workbook, Worksheet } from 'exceljs';
import type { ExcelReport } from './excel-report';

type Table = ExcelReport['tables'][number];
export type ExportTable = { table: Table; sheet: Worksheet; first: number; last: number };
const column = (index: number) => String.fromCharCode(64 + index);
const ref = (t: ExportTable, col: number, row: number) => `'${t.sheet.name}'!${column(col)}${t.first + row}`;
const range = (t: ExportTable, col: number) => `'${t.sheet.name}'!$${column(col)}$${t.first}:$${column(col)}$${t.last}`;
const literal = (value: string) => `"=${value.replaceAll('"', '""').replaceAll('~', '~~').replaceAll('*', '~*').replaceAll('?', '~?')}"`;

/** Formula inputs are only the business rows already allowed into this export. */
export function applyExcelFormulas(workbook: Workbook, report: ExcelReport, tables: ExportTable[]) {
  workbook.calcProperties.fullCalcOnLoad = true;
  const find = (title: string, detail = false) => tables.find(t => t.table.title === title && t.sheet.name === (detail ? 'Детализация' : 'Отчёт'));
  const set = (t: ExportTable | undefined, row: number, col: number, formula: string) => {
    const result = t?.table.rows[row]?.[col - 1];
    // Preserve missing data and text; never turn an unavailable input into zero.
    if (t && typeof result === 'number' && Number.isFinite(result)) t.sheet.getCell(t.first + row, col).value = { formula, result };
  };
  const sum = (t: ExportTable, amount: number, criteria: [number, string][] = []) => criteria.length
    ? `SUMIFS(${range(t, amount)},${criteria.map(([col, value]) => `${range(t, col)},${literal(value)}`).join(',')})`
    : `SUM(${range(t, amount)})`;
  for (const t of tables.filter(t => t.sheet.name === 'Отчёт')) {
    const delta = t.table.headers.indexOf('Изменение') + 1;
    if (delta) t.table.rows.forEach((_, i) => set(t, i, delta, `${ref(t, 2, i)}-${ref(t, delta - 1, i)}`));
  }
  const metrics = find('Ключевые показатели');
  if (report.title === 'Оперативный дашборд' && metrics) {
    const wallet = find('Расчёт кошелька', true), accounts = find('Расчётные счета', true);
    if (wallet) set(metrics, 1, 2, `ROUND(${ref(wallet, 2, 0)}*(1+${ref(wallet, 2, 1)}),2)`);
    if (accounts) set(metrics, 0, 2, sum(accounts, 2));
    const parts = metrics.table.rows.slice(0, 3).map(row => row[1]);
    const total = metrics.table.rows[3]?.[1];
    if (parts.every(v => typeof v === 'number') && typeof total === 'number' && Math.abs((parts as number[]).reduce((a, b) => a + b, 0) - total) < 0.005) {
      set(metrics, 3, 2, `${ref(metrics, 2, 0)}+${ref(metrics, 2, 1)}+${ref(metrics, 2, 2)}`);
    }
  }
  if (report.title === 'ДДС') {
    const detail = find('Операции ДДС', true);
    if (detail && metrics) {
      for (const col of [2, 3]) {
        if (col > metrics.table.headers.length || metrics.table.headers[col - 1] === 'Изменение') continue;
        const period = col === 2 ? 'Выбранный' : 'Предыдущий';
        set(metrics, 0, col, `SUMIFS(${range(detail, 3)},${range(detail, 1)},"${period}",${range(detail, 3)},">0")`);
        set(metrics, 1, col, `-SUMIFS(${range(detail, 3)},${range(detail, 1)},"${period}",${range(detail, 3)},"<0")`);
        set(metrics, 2, col, `${ref(metrics, col, 0)}-${ref(metrics, col, 1)}`);
      }
      const articles = find('Статьи ДДС');
      articles?.table.rows.forEach((row, i) => set(articles, i, 2, sum(detail, 3, [[1, 'Выбранный'], [5, String(row[0])]])));
    }
    const plan = find('Выполнение плана', true);
    if (plan && metrics) plan.table.rows.forEach((_, i) => {
      set(plan, i, 3, ref(metrics, 2, i));
      set(plan, i, 4, `IF(${ref(plan, 2, i)}>0,${ref(plan, 3, i)}/${ref(plan, 2, i)},"Нет данных")`);
    });
  }
  if (report.title === 'Планирование' && metrics) {
    ['План поступлений', 'План списаний'].forEach((title, index) => {
      const detail = find(title, true), categories = find(`${title} по категориям`);
      if (!detail) return;
      set(metrics, index, 2, sum(detail, 4, [[1, 'Выбранный']]));
      set(metrics, index, 3, sum(detail, 4, [[1, 'Предыдущий']]));
      categories?.table.rows.forEach((row, i) => {
        set(categories, i, 2, sum(detail, 4, [[1, 'Выбранный'], [3, String(row[0])]]));
        set(categories, i, 4, sum(detail, 4, [[1, 'Предыдущий'], [3, String(row[0])]]));
        set(categories, i, 3, `IF(${ref(metrics, 2, index)}<>0,${ref(categories, 2, i)}/${ref(metrics, 2, index)},"Нет данных")`);
      });
    });
    for (const col of [2, 3]) if (metrics.table.headers[col - 1] !== 'Изменение') set(metrics, 2, col, `${ref(metrics, col, 0)}-${ref(metrics, col, 1)}`);
  }
  if (report.title === 'Продажи по менеджерам') {
    const detail = find('Продажи', true), managers = find('Выручка по менеджерам');
    if (detail && metrics) for (const col of [2, 3]) {
      if (metrics.table.headers[col - 1] === 'Изменение') continue;
      const period = col === 2 ? 'Выбранный' : 'Предыдущий';
      set(metrics, 0, col, sum(detail, 9, [[1, period]]));
      managers?.table.rows.forEach((row, i) => set(managers, i, col, sum(detail, 9, [[1, period], [10, String(row[0])]])));
    }
  }
  if (report.title === 'ОПиУ') {
    const main = find('Показатели ОПиУ'), detail = find('Статьи по месяцам', true);
    if (main && detail) {
      const count = detail.table.rows.length / main.table.rows.length;
      main.table.rows.forEach((_, i) => {
        const block = { ...detail, first: detail.first + i * count, last: detail.first + (i + 1) * count - 1 };
        for (const col of [2, 3]) {
          if (main.table.headers[col - 1] === 'Изменение') continue;
          set(main, i, col, sum(block, 5, [[1, col === 2 ? 'Выбранный' : 'Предыдущий']]));
        }
      });
    }
  }
  if (report.title === 'Дебиторская задолженность') {
    const detail = find('Детализация ДЗ', true), ages = find('Возрастная разбивка'), top = find('ТОП дебиторов');
    if (detail) {
      set(metrics, 0, 2, sum(detail, 6));
      metrics?.table.rows.forEach((row, i) => {
        const source = String(row[0]).match(/^ДЗ «(.+)»$/)?.[1];
        if (source) set(metrics, i, 2, sum(detail, 6, [[1, source]]));
      });
      ages?.table.rows.forEach((row, i) => set(ages, i, 2, sum(detail, 6, [[5, String(row[0])]])));
      top?.table.rows.forEach((row, i) => set(top, i, 3, sum(detail, 6, [[1, String(row[0])], [2, String(row[1])]])));
    }
    const compare = find('Сравнение ДЗ');
    if (compare) {
      set(compare, 2, 2, `${ref(compare, 2, 0)}-${ref(compare, 2, 1)}`);
      set(compare, 3, 2, `IF(${ref(compare, 2, 1)}<>0,${ref(compare, 2, 2)}/${ref(compare, 2, 1)},"Нет данных")`);
    }
    const nlpk = find('Кредиторская задолженность НЛПК', true);
    const total = tables.find(t => t.sheet.name === 'Отчёт' && t.table.rows[0]?.[0] === 'Кредиторская задолженность НЛПК');
    if (nlpk) set(total, 0, 2, sum(nlpk, 4));
  }
}
