const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const {withPeriodBalances}=require('../app/lib/period-balances.ts');
const {withWalletPercentage}=require('../app/lib/wallet-percentage.ts');
const {withPlanningIndicators}=require('../app/lib/planning-indicators.ts');
const metric=value=>({value,date:'2026-10-07T09:00:00Z',source:'FinTablo',reason:'Текущий остаток'});
const base={source:'test',cash:[],orders:[],debtor:{},creditor:{},balances:{date:'2026-08-31',account:200000,wallet:100000},operational:{account:metric(250000),wallet:metric(150000),deposit:metric(0),total:metric(400000)},sections:{plan:{source:'test',cash:[],orders:[],debtor:{},creditor:{},balances:{},planReceipts:[{date:'2026-08-30',category:'Продажи',amount:50000}],planPayments:[{date:'2026-08-30',category:'Аренда',amount:20000}]}}};
const rules=[{percent:18,effectiveFrom:'2026-01-01'},{percent:20,effectiveFrom:'2026-10-07'}];
test('historical end changes raw wallet, applied rate, total and operating forecast',()=>{
 const result=withPlanningIndicators(withWalletPercentage(withPeriodBalances(base,'2026-08-31'),rules,'2026-08-31'),'2026-08-24','2026-08-31');
 assert.equal(result.operational.walletConversion.raw,100000);
 assert.equal(result.operational.walletConversion.percent,18);
 assert.equal(result.operational.wallet.value,118000);
 assert.equal(result.operational.total.value,318000);
 assert.equal(result.operational.operationalBalance.value,348000);
 assert.equal(result.operational.total.date,'2026-08-31');
 const current=withWalletPercentage(withPeriodBalances(base,'2026-10-07'),rules,'2026-10-07');
 assert.equal(current.operational.walletConversion.raw,150000);
 assert.equal(current.operational.wallet.value,180000);
 assert.equal(current.operational.total.value,430000);
 assert.equal(current.operational.walletConversion.percent,20);
 assert.equal(base.operational.wallet.value,150000);
});
test('missing historical snapshot stays unknown instead of reusing current or another period',()=>{
 const result=withWalletPercentage(withPeriodBalances(base,'2026-08-30'),rules,'2026-08-30');
 assert.equal(result.operational.wallet.value,null);
 assert.equal(result.operational.total.value,null);
 assert.equal(result.operational.walletConversion.percent,18);
 assert.match(result.operational.wallet.reason,/Текущий остаток FinTablo относится к другой дате/);
});
test('explicit cash-section historical source wins over global fallback; zero remains zero',()=>{
 const cash={source:'historical',cash:[],orders:[],debtor:{},creditor:{},balances:{date:'2026-08-31',account:0,wallet:0}};
 const result=withPeriodBalances({...base,sections:{...base.sections,cash}},'2026-08-31');
 assert.equal(result.operational.wallet.value,0);assert.equal(result.operational.total.value,0);
});
