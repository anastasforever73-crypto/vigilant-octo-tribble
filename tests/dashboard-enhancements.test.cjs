const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, f);
const { compareReceivables } = require('../app/lib/receivables-comparison.ts');
const { yesterdayMoscow, operationalFinancial, operationalDebt } = require('../app/lib/operational.ts');
const r = require('../app/lib/receivables.ts');
const report = { asOf: '2026-09-22', current: {totalCents: 15000}, archive: {snapshots: [{asOf:'2026-09-15',totalCents:10000}]}, sources:{} };
test('equal periods compare endpoint snapshots, not a sum of daily balances', () => {
 const result = compareReceivables(report,'2026-09-16','2026-09-22');
 assert.deepEqual(result,{comparisonStart:'2026-09-09',previousEnd:'2026-09-15',current:15000,previous:10000,change:5000,percent:50});
 const day = compareReceivables(report,'2026-09-22','2026-09-22');
 assert.equal(day.previousEnd,'2026-09-21'); assert.equal(day.previous,null); assert.equal(day.change,null);
});
test('missing, partial, zero and negative comparison are distinct', () => {
 const zero={...report,archive:{snapshots:[{asOf:'2026-09-15',totalCents:0}]}};
 assert.equal(compareReceivables(zero,'2026-09-16','2026-09-22').percent,null);
 assert.equal(compareReceivables(zero,'2026-09-16','2026-09-22').change,15000);
 assert.equal(compareReceivables({...report,current:{totalCents:15000,partial:true}},'2026-09-16','2026-09-22').current,null);
 assert.equal(compareReceivables({...report,current:{totalCents:5000}},'2026-09-16','2026-09-22').percent,-50);
});
test('previous calendar day uses Moscow midnight across months and years', () => {
 assert.equal(yesterdayMoscow(new Date('2026-09-21T20:59:59Z')),'2026-09-20');
 assert.equal(yesterdayMoscow(new Date('2026-09-21T21:00:00Z')),'2026-09-21');
 assert.equal(yesterdayMoscow(new Date('2026-01-01T01:00:00Z')),'2025-12-31');
});
const account=(name,balance,id=1)=>({id,name,type:'',balance,currency:'RUB',archived:false,hideInTotal:false});
const transaction=(category,amount=50,date='2026-09-21',group='income')=>({accountId:1,category,amount,date,group});
const snapshot=(accounts,transactions=[])=>({accounts,transactions,updatedAt:'2026-09-22T08:00:00Z'});
test('account buckets are disjoint, missing deposits are not zero, totals include accounts once', () => {
 const result=operationalFinancial(snapshot([account('Расчётный счёт',100),account('Кошелёк',20,2),account('Депозитный счёт',30,3)]),'2026-09-21');
 assert.equal(result.account.value,100);assert.equal(result.wallet.value,20);assert.equal(result.deposit.value,30);assert.equal(result.total.value,150);
 assert.equal(operationalFinancial(snapshot([account('Расчётный счёт',0)]),'2026-09-21').deposit.value,null);
 assert.equal(operationalFinancial(snapshot([account('Расчётный счёт',0)]),'2026-09-21').account.value,0);
 assert.equal(operationalFinancial(snapshot([{...account('Расчётный счёт',0),balanceAvailable:false}]),'2026-09-21').account.value,null);
 assert.equal(operationalFinancial(snapshot([{...account('Расчётный счёт',100),currency:'USD'}]),'2026-09-21').total.value,null);
});
test('receipts include only revenue on the exact day, excluding transfers and loans', () => {
 const result=operationalFinancial(snapshot([account('Расчётный счёт',100)],[transaction('Выручка'),transaction('Оплата от покупателей',25),transaction('Займ',300),transaction('Выручка',500,'2026-09-20'),transaction('Продажи',500,'2026-09-21','transfer')]),'2026-09-21');
 assert.equal(result.receipts.value,75);
 assert.equal(operationalFinancial(snapshot([account('Счёт',0)]),'2026-09-21').receipts.value,null);
});
test('daily shipments include paid rows, deduplicate and never affect debt or weekly formula', () => {
 const rows=[Object.values(r.sourceColumns.Транзит),['21.09.2026',500,0,'A'],['21.09.2026',500,0,'A'],['20.09.2026',300,200,'B']];
 const source=r.collectReceivables(rows,'Транзит','2026-09-22');
 assert.equal(source.dailyShipment.amountCents,50000); assert.equal(source.totalCents,20000);assert.equal(source.weeklyShipmentCents,80000);
 const empty=r.collectReceivables([rows[0],['21.09.2026','',0,'A']],'Транзит','2026-09-22');
 assert.equal(empty.dailyShipment.amountCents,null);
 const partial=operationalDebt({...report,sources:{Транзит:source}},'2026-09-21');assert.equal(partial.shipments.value,null);
});

test('account detail matches the exact total and excludes wallet, deposit, hidden and archived accounts', () => {
 const rows=[{...account('Банк А',120.25,1),number:'407028100001'},account('Банк Б',-20.25,2),account('Банк В',0,3),account('Кошелёк',50,4),account('Депозит',70,5),{...account('Банк скрытый',900,6),hideInTotal:true},{...account('Банк архивный',800,7),archived:true}];
 const result=operationalFinancial({...snapshot(rows),balanceDate:'2026-09-20'},'2026-09-21').account;
 assert.equal(result.value,100);
 assert.deepEqual(result.breakdown.map(row=>row.id),[1,2,3]);
 assert.equal(result.breakdown[0].number,'407028100001');
 assert.equal(result.breakdown.reduce((sum,row)=>sum+Math.round(row.value*100),0),Math.round(result.value*100));
 assert.equal(result.date,'2026-09-20');
 for(const invalid of [{...rows[0],balanceAvailable:false},{...rows[0],currency:'USD'}]){
  const metric=operationalFinancial(snapshot([invalid]),'2026-09-21').account;
  assert.equal(metric.value,null);assert.equal(metric.breakdown,undefined);
 }
});
