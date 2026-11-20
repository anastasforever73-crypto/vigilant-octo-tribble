const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { parseReceivablesSummary } = require('../app/lib/receivables-summary.ts');
const headers = ['Менеджер','Вид оплаты','Долг','Просрочка задолженности'];
const parse = rows => parseReceivablesSummary(rows, '2026-11-20', '2026-11-20T09:00:00Z');
test('reads the primary report, ignores duplicate side summaries and preserves source categories', () => {
 const result = parse([['ЗАДОЛЖЕННОСТЬ'], headers, ['Алексей','б/н',6683627,'Текущая (от 0 до 14 дн.)',null,null,'Сомнительная', 'Алексей',6235450],['Алексей','б/н',6235450,'Сомнительная (от 31 до 180 дн.)'],['Б','нал','100,01','Безнадёжная (от 181 дн.)'], [null,null,null,null,null,null,'side only', 'Б',999999]]);
 assert.equal(result.totalCents,1291917701);
 assert.equal(result.categories.Текущая,668362700);
 assert.equal(result.categories.Безнадежная,10001);
 assert.equal(Object.values(result.categories).reduce((a,b)=>a+b,0),result.totalCents);
 assert.equal(result.summaryRows.length,3);
 assert.equal(result.details,null); assert.equal(result.advancesCents,null); assert.deepEqual(result.bySource,{});
});
test('rejects empty reports, broken formulas, negative balances and unknown categories', () => {
 for(const rows of [[headers], [headers,['A','нал','#REF!','Текущая']], [headers,['A','нал',-100,'Текущая']], [headers,['A','нал',100,'Ошибка']], [headers,['','нал',100,'Текущая']]]) assert.throws(()=>parse(rows));
});
