const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
process.env.TZ = 'Europe/Moscow';
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const r = require('../app/lib/receivables.ts');
const { parseDebtArchive } = require('../app/lib/debt-archive.ts');
// Execute only pure calculation functions from the actual saved source, without Google services.
const script = vm.createContext({ Date });
vm.runInContext(fs.readFileSync('scripts/Otchet_DZ.gs', 'utf8'), script, { timeout: 1000 });
const today = '2026-09-18';
const date = iso => new Date(iso + 'T00:00:00+03:00');
const ago = days => new Date(Date.parse(today) - days * 86400000).toISOString().slice(0, 10);
const row = (days, debt, key = 'A', shipment = 0) => [date(ago(days)), shipment, debt, key];
const week = r.reportWeek(today);
function compare(body, source = 'Транзит', prefix = []) {
  const config = script.CONFIG.SOURCES.find(x => x.key === source);
  const rows = [...prefix, Object.values(r.sourceColumns[source]), ...body];
  const expected = script.collectSource(rows, config, date(today), date(week.start), date(week.end));
  const actual = r.collectReceivables(rows, source, today);
  assert.equal(actual.complete, true);
  assert.equal(actual.totalCents, r.cents(expected.total));
  assert.equal(actual.advancesCents, r.cents(expected.advance));
  assert.equal(actual.weeklyShipmentCents, r.cents(expected.shipment));
  for (const category of r.debtCategories) assert.equal(actual.categories[category], r.cents(expected.buckets[category]));
  return { actual, expected };
}
test('original collectSource: category boundaries, FIFO, source layouts, future/undated and weekly shipment', () => {
  for (const source of r.debtSources) {
    compare([...[0,14,15,30,31,180,181].map(age => row(age,100.01,String(age))), row(5,0,'Paid',1500), row(-1,300), ['',0,500,'Undated']], source);
    compare([row(10,100),row(40,100),row(0,-150)],source);
    compare([row(40,100),row(0,-170)],source);
    compare([row(40,100),row(0,-100)],source);
  }
});
test('original collectSource: empty cells, whitespace and literal fallback preserve distinct grouping', () => {
  const { actual } = compare([row(40,100,''),row(10,-30,null),row(0,-20,undefined),row(20,90,'   '),row(0,-40,'\t'),row(0,10,'(без контрагента)')]);
  // Explicitly test undefined too (the row helper has an A default).
  compare([[date(today),0,10,undefined],[date(today),0,-5,'']]);
  assert.ok(actual.details.some(x => x.key === ''));
  assert.ok(actual.details.some(x => x.key === '(без контрагента)'));
  assert.ok(actual.diagnostics.some(x => x.reason.includes('Пустой ключ')));
});
test('original collectSource: configured header hint takes priority and duplicate columns use first', () => {
  for (const source of r.debtSources) {
    const hint = source === 'Транзит' ? 19 : 9;
    const prefix = [Object.values(r.sourceColumns[source]),row(1,999999),...Array.from({length:hint-3},()=>[])];
    assert.equal(compare([row(1,10)],source,prefix).actual.headerRow,hint);
    const config=script.CONFIG.SOURCES.find(x=>x.key===source);
    const rows=[[...Object.values(r.sourceColumns[source]),r.sourceColumns[source].balance],[...row(1,10),999999]];
    assert.equal(r.collectReceivables(rows,source,today).totalCents,r.cents(script.collectSource(rows,config,date(today),date(week.start),date(week.end)).total));
  }
});
test('original collectSource: 200 deterministic mixed fixtures reconcile to the kopeck', () => {
  let seed=913;
  const next=max=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%max;};
  for(let run=0;run<200;run++) {
    const rows=Array.from({length:40},()=>row(next(400)-3,(next(200001)-80000)/100,['A','B','C','', '   '][next(5)],next(100000)/100));
    compare(rows,r.debtSources[run%2]);
  }
});
test('original writeArchive: real output with zero buckets and singular Аванс is readable', () => {
  const results=r.debtSources.map(source=>compare([row(3,100),row(0,-150,'B')],source).expected);
  let captured;
  script.getOrCreate=()=>({});
  script.appendArchiveRows=(_sheet,rows)=>{captured=rows;};
  script.writeArchive({},date(today),date(week.start),date(week.end),results,'авто');
  // Sheets API SERIAL_NUMBER representation in the workbook Moscow timezone.
  const serial=value=>value instanceof Date ? (value.getTime()+3*3600000-Date.UTC(1899,11,30))/86400000 : value;
  const archive=parseDebtArchive([Array.from(script.ARCHIVE_HEADER),...captured.map(line=>Array.from(line,serial))],today);
  assert.equal(archive.snapshots.length,1);
  assert.equal(archive.snapshots[0].totalCents,20000);
  assert.equal(archive.snapshots[0].advancesCents,-30000);
  assert.equal(archive.snapshots[0].method,'авто');
  assert.equal(archive.diagnostics.length,0);
});
test('original coercion applies to source cells; historical archive stays strict', () => {
  assert.equal(script.toNumber('100 рублей'),100);
  assert.throws(()=>r.cents('100 рублей'));
  assert.ok(script.toDate('31.02.2026'));
  assert.throws(()=>r.calendarDate('31.02.2026'));
  compare([['31.02.2026',0,'100 рублей','A'],['19.09-20.09',0,558000,'B'],['23.09-24.-09',0,558000,'C']]);
  compare([row(1,''),row(1,null),row(1,undefined),row(1,'#REF!'),row(1,'не число'),row(1,'1 234,56 руб.'),row(1,'1.2.3'),row(1,0.004)]);
  const archive=parseDebtArchive([Array.from(script.ARCHIVE_HEADER),[today,week.start,week.end,'Транзит','ДЗ','Текущая',100,'история',today]],today);
  assert.equal(archive.snapshots.length,0);
  assert.ok(archive.diagnostics.length);
  const rows=[Object.values(r.sourceColumns.Транзит),row(1,10,'__proto__')];
  assert.throws(()=>script.collectSource(rows,script.CONFIG.SOURCES[0],date(today),date(week.start),date(week.end)));
  assert.equal(r.collectReceivables(rows,'Транзит',today).totalCents,1000);
});
test('row boundaries, zeroes, text, dates and exclusions match original without source edits', () => {
  for (const source of r.debtSources) {
    const {actual}=compare([[],[null,null,null,null,'Adjacent inventory',1000000],[null,0,0,'Итого'],row(1,''),row(1,'—'),['не отгружен',0,100,'A'],row(-1,200,'B'),row(2,'10 рублей','C')],source);
    assert.equal(actual.totalCents,1000);
    assert.equal(actual.excludedRows.length,4);
    assert.deepEqual(actual.excludedRows.map(x=>x.row),[5,6,7,8]);
  }
});
test('original date parsing and numbers agree across supported messy source values', () => {
  for(const value of [null,'',0,1001,25569,45000.99,'18.9.26','31.02.2026','19.09-20.09','23.09-24.-09','не отгружен','2026-09-18']) {
    const expected=script.toDate(value);
    assert.equal(r.sourceDate(value),expected?r.moscowToday(expected):undefined);
  }
  for(const value of ['',null,undefined,'—','100 рублей','1.2.3','1 234,56',NaN,Infinity,0,-12.5]) assert.equal(r.sourceNumber(value),script.toNumber(value));
});
