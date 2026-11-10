const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const originalLoad = Module._load;
Module._load = function(name, parent, main) { if (name === 'server-only') return {}; return originalLoad.call(this, name, parent, main); };
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const r = require('../app/lib/receivables.ts');
const { parseDebtArchive } = require('../app/lib/debt-archive.ts');
const today = '2026-09-18';
const ago = days => new Date(Date.parse(today) - days * 86400000).toISOString().slice(0,10);
const sourceDate = value => new Date(value + 'T00:00:00+03:00');
const headers = source => Object.values(r.sourceColumns[source]);
const collect = (rows, source = 'Транзит') => r.collectReceivables([headers(source), ...rows], source, today);
const row = (age, balance, key = 'Test key', shipped = 500) => [sourceDate(ago(age)), shipped, balance, key];
test('calendar ages: 0/14/15/30/31/180/181 and money are exact integer cents', () => {
  const result = collect([0,14,15,30,31,180,181].map(age=>row(age,'100,01')));
  assert.deepEqual(result.categories, {Текущая:20002,Просроченная:20002,Сомнительная:20002,Безнадежная:10001});
  assert.equal(result.totalCents,70007);
  for (const value of ['1 234,56','1\u00a0234,56','1\u202f234.56',1234.56]) assert.equal(r.cents(value),123456);
  assert.equal(r.cents(1.005),101); assert.equal(r.cents('-1,005'),-101);
  for (const value of ['',null,undefined,'#DIV/0!',NaN,Infinity,'1.2.3','abc',true]) assert.throws(()=>r.cents(value));
});
test('FIFO: partial/full settlement and excess credits retain negative advances outside total', () => {
  const partial = collect([row(10,100),row(40,100),row(0,-150)]);
  assert.equal(partial.totalCents,5000); assert.equal(partial.details.length,1); assert.equal(partial.details[0].age,10); assert.equal(partial.advancesCents,0);
  const full = collect([row(40,100),row(0,-100)]); assert.equal(full.totalCents,0); assert.equal(full.details.length,0);
  const excess = collect([row(40,100),row(0,-170)]); assert.equal(excess.totalCents,0); assert.equal(excess.advancesCents,-7000);
  assert.equal(collect([row(40,100,'A'),row(0,-170,'B')]).totalCents,10000);
});
test('same key across sources never offsets; TOP and categories reconcile to one shared total', () => {
  const sources = {Транзит:collect([row(40,100)]),Склад:collect([row(0,-170)],'Склад')};
  const snapshot = r.combineDebt(sources,'2026-09-18T12:00:00Z');
  assert.equal(snapshot.totalCents,10000); assert.equal(snapshot.advancesCents,-17000);
  assert.equal(r.topDebtors(snapshot).reduce((sum,x)=>sum+x.balanceCents,0),snapshot.totalCents);
  assert.equal(Object.values(snapshot.categories).reduce((a,b)=>a+b,0),snapshot.totalCents);
});
test('script rules: missing/future dates excluded; text debt becomes zero without blocking totals', () => {
  const result = collect([['',0,100,'A'],row(-1,200),row(-1,-50),row(20,0),row(20,'#N/A'),row(20,10)]);
  assert.equal(result.totalCents,1000); assert.equal(result.complete,true);
  assert.equal(result.diagnostics.find(x=>x.reason.includes('Нет даты')).amountCents,10000);
  const future = result.diagnostics.find(x=>x.reason.includes('Будущая')); assert.equal(future.count,2); assert.equal(future.amountCents,15000);
  assert.equal(result.diagnostics.find(x=>x.reason.includes('Текстовый остаток')).amountCents,0);
  assert.equal(result.excludedRows.length,4);
  assert.equal(result.excludedRows.find(x=>x.balanceValue==='#N/A').row,6);
});
test('blank grouping follows Apps Script fallback before trimming, with a nonblocking warning', () => {
  const result = collect([row(20,100,''),row(0,-40,null),row(0,-100,'   ')]);
  assert.equal(result.complete,true); assert.equal(result.diagnostics[0].count,3);
  assert.equal(result.totalCents,6000); assert.equal(result.advancesCents,-10000);
  assert.equal(result.details[0].key,'(без контрагента)');
});
test('headers may move beyond hint rows; normalize spaces/case; duplicates use first occurrence', () => {
  const data = [...Array.from({length:35},()=>['Report title']), [' ДАТА\u00a0УПД ','СТ-ТЬ ЗАКАЗА','остаток  долга','Конечный получатель','Остаток долга'], [sourceDate(today),1,5,'A',999999]];
  const result = r.collectReceivables(data,'Транзит',today);
  assert.equal(result.headerRow,36); assert.equal(result.totalCents,500);
  assert.throws(()=>r.collectReceivables([['wrong']], 'Транзит',today));
});
test('Moscow calendar dates, Google serials, leap dates and previous completed Monday–Sunday', () => {
  assert.equal(r.moscowToday(new Date('2026-09-17T21:01:00Z')),today);
  assert.equal(r.calendarDate('2026-09-17T22:00:00Z'),today);
  assert.equal(r.calendarDate(25569.9),'1970-01-01'); assert.equal(r.calendarDate('18.09.2026'),today);
  assert.throws(()=>r.calendarDate('31.02.2026')); assert.throws(()=>r.calendarDate('#VALUE!'));
  assert.deepEqual(r.previousWeek(today),{start:'2026-09-07',end:'2026-09-13'});
  assert.deepEqual(r.previousWeek('2026-09-14'),{start:'2026-09-07',end:'2026-09-13'});
});
test('shipment uses reportDate minus 7 through minus 1, including settled rows, as buildForDate', () => {
  const source=collect([row(200,100,'A',500),['11.09.2026',1000,0,'B'],['17.09.2026',2000,20,'B'],['18.09.2026',9000,0,'C']]);
  assert.equal(source.totalCents,12000); assert.equal(source.weeklyShipmentCents,300000);
  assert.equal(collect([['11.09.2026','#REF!',0,'B']]).weeklyShipmentCents,0);
  assert.deepEqual(r.reportWeek(today),{start:'2026-09-11',end:'2026-09-17'});
  const current=r.combineDebt({Транзит:source,Склад:collect([row(0,0)],'Склад')},'time');
  const report={asOf:today,current,archive:{snapshots:[]}};
  assert.equal(r.debtAt(report,today).totalCents,12000); assert.equal(r.debtAt(report,ago(7)),null);
});
const archiveHeaders=['Дата отчёта','Неделя с','Неделя по','Источник','Показатель','Категория','Сумма','Способ','Обновлено'];
const archiveRows = (date='2026-09-11') => r.debtSources.flatMap(source=>r.debtCategories.map(category=>[date,'2026-09-07','2026-09-13',source,'ДЗ',category,10,'FIFO','2026-09-11T18:00:00+03:00']));
test('archive: complete snapshots only; missing dates/advances are unknown, no reconstructed historical TOP', () => {
  const archive=parseDebtArchive([archiveHeaders,...archiveRows()],today);
  assert.equal(archive.snapshots.length,1); assert.equal(archive.snapshots[0].totalCents,8000);
  assert.equal(archive.snapshots[0].advancesCents,null); assert.equal(r.topDebtors(archive.snapshots[0]),null);
  assert.equal(r.debtAt({asOf:today,current:null,archive},'2026-09-10'),null);
  assert.equal(parseDebtArchive([archiveHeaders,...archiveRows().slice(1)],today).snapshots.length,0);
  assert.equal(parseDebtArchive([archiveHeaders,...archiveRows(),archiveRows()[0]],today).snapshots.length,0);
  assert.equal(parseDebtArchive([archiveHeaders,...archiveRows('2027-01-01')],today).snapshots.length,0);
});
test('source reader: exact debt ID, read-only fresh requests, partial failures never become a full total', async () => {
  const sheets = require('../app/lib/google-sheets.ts');
  const original = sheets.sheetsClient;
  const settings={debtEnabled:true,debtGoogleSheetId:'debt-id-test',googleSheetId:'never-use-sales-id',googleServiceAccountEmail:'test',googlePrivateKey:'test'};
  const calls=[]; let failStock=false, version=1;
  sheets.sheetsClient=()=>({spreadsheets:{get:async params=>{calls.push(params);return {data:{sheets:r.debtSources.map(title=>({properties:{title,gridProperties:{rowCount:10,columnCount:4}}}))}};},values:{get:async params=>{calls.push(params);const source=params.range.includes('Транзит')?'Транзит':'Склад';if(failStock&&source==='Склад') throw new Error('SECRET-should-not-leak');return {data:{values:[headers(source),row(200,version)]}};}}}});
  try {
    const {readReceivables}=require('../app/lib/read-receivables.ts');
    const first=await readReceivables(settings,new Date(today)); version=2;
    const next=await readReceivables(settings,new Date(today));
    assert.equal(first.current.totalCents,200); assert.equal(next.current.totalCents,400);
    assert.equal(first.archive.status,'missing'); assert.ok(calls.every(p=>p.spreadsheetId==='debt-id-test'));
    failStock=true;
    const partial=await readReceivables(settings,new Date(today)); assert.equal(partial.current.partial,true); assert.equal(partial.current.totalCents,200); assert.equal(partial.current.bySource.Склад,undefined); assert.ok(partial.sources.Транзит); assert.ok(partial.errors.Склад); assert.ok(!JSON.stringify(partial).includes('SECRET'));
  } finally { sheets.sheetsClient=original; }
});

test('archive chart gaps stay null and are never joined or replaced with current balances', () => {
  const report={archive:{snapshots:[{asOf:'2026-09-11',totalCents:100},{asOf:'2026-09-13',totalCents:200}]}};
  assert.deepEqual(r.archiveSeries(report,'2026-09-11','2026-09-13'),[{date:'2026-09-11',debt:1},{date:'2026-09-12',debt:null},{date:'2026-09-13',debt:2}]);
});

test('header-only source returns zero as original script; missing sheet still fails', () => {
  const empty=collect([]);assert.equal(empty.complete,true);assert.equal(empty.weeklyShipmentCents,0);
  const settled=collect([row(0,0)]);assert.equal(settled.complete,true);assert.equal(settled.totalCents,0);
});
test('configured debt ID never falls back to unrelated stored sources; ambiguous connections fail safely', async () => {
  const store=require('../app/lib/connections/store.ts');
  const {resolveDebtSettings}=require('../app/lib/read-receivables.ts');
  const list=store.listConnections, get=store.getConnection, database=process.env.DATABASE_URL;
  const settings={debtEnabled:true,debtGoogleSheetId:'',googleServiceAccountEmail:'',googlePrivateKey:''};
  process.env.DATABASE_URL='test-only';
  const connection={id:'debt',type:'googleSheets',enabled:true,config:{spreadsheetId:'target-debt'},bindings:[{section:'debt',dataset:'debt'}]};
  store.listConnections=async()=>[connection];store.getConnection=async()=>({connection,secrets:{serviceAccountEmail:'test-email',privateKey:'test-key'}});
  try {
    assert.equal((await resolveDebtSettings(settings)).debtGoogleSheetId,'target-debt');
    assert.equal((await resolveDebtSettings({...settings,debtGoogleSheetId:'explicit-other'})).debtGoogleSheetId,'explicit-other');
    assert.equal((await resolveDebtSettings({...settings,debtGoogleSheetId:'explicit-other'})).googlePrivateKey,'');
    store.listConnections=async()=>[connection,{...connection,id:'second'}];
    await assert.rejects(resolveDebtSettings(settings),e=>e.code==='ambiguous');
    await assert.rejects(resolveDebtSettings({...settings,debtEnabled:false}),e=>e.code==='disabled');
  } finally {store.listConnections=list;store.getConnection=get;if(database===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=database;}
});

test('stock: ignore adjacent inventory-only rows, report mapped text converted to zero', () => {
  const mapped = headers('Склад');
  const rows = [mapped, [sourceDate(today), 100, 0, 'Settled direction'], [null, null, null, null, 'Separate inventory table', 12345]];
  const result = r.collectReceivables(rows, 'Склад', today);
  assert.equal(result.complete, true);
  assert.equal(result.totalCents, 0);
  assert.deepEqual(result.diagnostics, []);
  const invalid = r.collectReceivables([...rows, [sourceDate(today), 100, '#REF!', 'Direction']], 'Склад', today);
  assert.equal(invalid.complete, true);
  assert.equal(invalid.diagnostics[0].count, 1);
  assert.equal(invalid.excludedRows[0].row,4);
});

test('explicit physical sheet names map to stable debt sources without guessing alternatives', async () => {
  const sheets = require('../app/lib/google-sheets.ts');
  const original = sheets.sheetsClient;
  const settings = {debtEnabled:true,debtGoogleSheetId:'debt-id-test',googleServiceAccountEmail:'test',googlePrivateKey:'test',debtTransitSheet:'Заказы',debtStockSheet:'Склад'};
  const calls=[];
  sheets.sheetsClient=()=>({spreadsheets:{get:async()=>({data:{sheets:['Заказы','Склад'].map(title=>({properties:{title,gridProperties:{rowCount:2,columnCount:4}}}))}}),values:{get:async p=>{calls.push(p.range);const source=p.range.includes('Заказы')?'Транзит':'Склад';return {data:{values:[headers(source),row(20,source==='Транзит'?10:20)]}};}}}});
  try {
    const {readReceivables}=require('../app/lib/read-receivables.ts');
    const result=await readReceivables(settings,new Date(today));
    assert.equal(result.current.totalCents,3000);
    assert.equal(result.sources.Транзит.totalCents,1000);
    assert.ok(calls.some(range=>range.startsWith("'Заказы'!")));
    assert.ok(!calls.some(range=>range.includes('Транзит')));
    const missing=await readReceivables({...settings,debtTransitSheet:'Заказ'},new Date(today));
    assert.equal(missing.current.partial,true);
    assert.equal(missing.current.totalCents,2000);
    assert.match(missing.errors.Транзит,/Заказ/);
    const {debtSourceSheets}=require('../app/lib/source-settings.ts');
    assert.deepEqual(debtSourceSheets(settings),{Транзит:'Заказы',Склад:'Склад'});
    assert.deepEqual(debtSourceSheets({}),{Транзит:'Транзит',Склад:'Склад'});
  } finally {sheets.sheetsClient=original;}
});

test('repeated financial rows counted once; currency and negative amounts supported',()=>{
  const duplicate=row(10,'1 234,56 ₽','Client');
  const result=collect([duplicate,duplicate]);
  assert.equal(result.totalCents,123456);
  assert.ok(result.diagnostics.some(d=>/Повторная/.test(d.reason)));
  assert.equal(r.cents(' -1\u00a0234,56 ₽ '),-123456);
});
