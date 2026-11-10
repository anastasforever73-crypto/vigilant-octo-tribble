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
assert.deepEqual(report.months, ['2026-07', '2026-08']);
assert.equal(report.defaultMonth, '2026-08');
assert.ok(!JSON.stringify(report).includes('99999'));
assert.equal(aggregateRow(report.rows[0], report.months, 'ИТОГО').value, 300);
assert.equal(aggregateRow(report.rows[0], ['2026-08'], 'СКЛАД').value, 100);
const row = structuredClone(report.rows[0]);
row.cells['2026-07']['ИТОГО'] = sourceCell(undefined, 'B6');
assert.equal(aggregateRow(row, report.months, 'ИТОГО').value, null);
row.cells['2026-07']['ИТОГО'] = sourceCell({ effectiveValue: { errorValue: { type: 'N_A' } }, formattedValue: '#N/A' }, 'B6');
assert.equal(aggregateRow(row, report.months, 'ИТОГО').text, '#N/A');
assert.equal(sourceCell(num(0), 'B6').value, 0);
assert.equal(aggregateRow({ ...report.rows[0], percent: true }, report.months, 'ИТОГО').value, null);
assert.deepEqual(previousMonths(['2026-08'], report.months), ['2026-07']);
assert.deepEqual(previousMonths(['2026-10'], ['2026-09', '2026-10']), []);
assert.deepEqual(previousMonths(report.months, report.months), []);
assert.throws(() => parseOpiu([], 123));
console.log('PASS: month exclusion, default, source totals, segments, nulls, errors, zero, percentages, comparisons, schema');

const uneven = structuredClone(grid);
uneven[3].values[3] = text('Октябрь');
const expanded = parseOpiu(uneven, 123);
assert.ok(expanded.months.includes('2026-10'));
assert.equal(aggregateRow(expanded.rows[0], ['2026-10'], 'ТРАНЗИТ').value, null);
console.log('PASS: months present only in total retain missing segment values as unknown');
