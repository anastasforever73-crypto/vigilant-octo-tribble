const fs = require('node:fs');
const ts = require('typescript');
const assert = require('node:assert/strict');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { parseOpiu, aggregateRow, previousMonths, sourceCell } = require('../app/lib/opiu.ts');
const text = formattedValue => ({ formattedValue });
const num = numberValue => ({ effectiveValue: { numberValue }, formattedValue: String(numberValue) });
const grid = [
  { values: [text('ОПиУ 2026')] }, {},
  { values: [text(''), text('ИТОГО'), {}, {}, text('ТРАНЗИТ'), {}, {}, text('СКЛАД')] },
  { values: [text(''), ...Array.from({ length: 3 }, () => ['Июль', 'Август', 'Сентябрь'].map(text)).flat()] }, {},
  { values: [text('Выручка'), ...[100, 200, 99999, 50, 100, 99999, 50, 100, 99999].map(num)] },
  { values: [text('Деталь'), ...[100, 200, 99999, 50, 100, 99999, 50, 100, 99999].map(num)] },
];
const report = parseOpiu(grid, 123);
assert.deepEqual(report.months, ['2026-07', '2026-08', '2026-09']);
assert.equal(report.defaultMonth, '2026-09');
assert.equal(report.rows[0].cells['2026-09']['ИТОГО'].value, 99999);
assert.equal(aggregateRow(report.rows[0], ['2026-09'], 'ТРАНЗИТ').value, 99999);
assert.equal(aggregateRow(report.rows[0], ['2026-09'], 'СКЛАД').value, 99999);
assert.equal(aggregateRow(report.rows[0], report.months, 'ИТОГО').value, 100299);
assert.equal(aggregateRow(report.rows[0], ['2026-08'], 'СКЛАД').value, 100);
const row = structuredClone(report.rows[0]);
row.cells['2026-07']['ИТОГО'] = sourceCell(undefined, 'B6');
assert.equal(aggregateRow(row, report.months, 'ИТОГО').value, null);
row.cells['2026-07']['ИТОГО'] = sourceCell({ effectiveValue: { errorValue: { type: 'N_A' } }, formattedValue: '#N/A' }, 'B6');
assert.equal(aggregateRow(row, report.months, 'ИТОГО').text, '#N/A');
assert.equal(sourceCell(num(0), 'B6').value, 0);
assert.equal(aggregateRow({ ...report.rows[0], percent: true }, report.months, 'ИТОГО').value, null);
assert.deepEqual(previousMonths(['2026-08'], report.months), ['2026-07']);
assert.deepEqual(previousMonths(['2026-10'], ['2026-09', '2026-10']), ['2026-09']);
assert.deepEqual(previousMonths(report.months, report.months), []);
assert.throws(() => parseOpiu([], 123));
console.log('PASS: all source months including September, default, source totals, segments, nulls, errors, zero, percentages, comparisons, schema');

const uneven = structuredClone(grid);
uneven[3].values[3] = text('Октябрь');
const expanded = parseOpiu(uneven, 123);
assert.ok(expanded.months.includes('2026-10'));
assert.equal(aggregateRow(expanded.rows[0], ['2026-10'], 'ТРАНЗИТ').value, null);
console.log('PASS: months present only in total retain missing segment values as unknown');

const dated = parseOpiu(grid, 123, "2026-08-31T21:00:00Z");
assert.equal(dated.defaultMonth, "2026-09");
assert.equal(parseOpiu(uneven, 123, "2026-08-31T20:59:59Z").defaultMonth, "2026-08");
assert.ok(expanded.months.includes("2026-10"));
console.log("PASS: future months remain selectable without becoming the default; Moscow month boundary");
const { opiuKpis, aggregateReportRow } = require('../app/lib/opiu.ts');
const financial = ['1.Выручка', 'Маржинальная прибыль', 'Рентабельность по маржинальной прибыли', 'Прочие расходы', 'Чистая прибыль', 'Рентабельность по чистой прибыли'].map((label, i) => ({ ...structuredClone(report.rows[0]), row: i + 6, label, percent: label.startsWith('Рентабельность') }));
financial[1].cells['2026-07']['ИТОГО'] = sourceCell(num(20), 'B20');
financial[1].cells['2026-08']['ИТОГО'] = sourceCell(num(60), 'C20');
assert.equal(aggregateReportRow(financial, financial[2], ['2026-07', '2026-08'], 'ИТОГО').value, 80 / 300);
assert.deepEqual(opiuKpis(financial, ['2026-08'], 'ИТОГО').map(k => k.label), ['Выручка', 'Маржинальная прибыль', 'Рентабельность по маржинальной прибыли', 'Чистая прибыль', 'Рентабельность по чистой прибыли']);
const withTechnical = [...grid, { values: [text(''), num(456)] }, { values: [text('Справочно')] }, { values: [text('Выручка'), num(999)] }];
assert.equal(parseOpiu(withTechnical, 123).rows.length, 2);
console.log('PASS: named rows, technical section exclusion, five KPIs, weighted period margin');
