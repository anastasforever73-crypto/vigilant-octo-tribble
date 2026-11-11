const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript'), Module = require('node:module');
const original = Module._load;
Module._load = function(name, ...rest) { if(name==='server-only') return {}; if(name.startsWith('@/')) name=require('node:path').join(process.cwd(), name.slice(2)); return original.call(this,name,...rest); };
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const {parseWalletPercentage,adjustedWallet,withWalletPercentage}=require('../app/lib/wallet-percentage.ts');
const {withPlanningIndicators}=require('../app/lib/planning-indicators.ts');
const metric=value=>({value,date:'2026-10-07',reason:'Источник',source:'Тест'});
const base={source:'test',cash:[],orders:[],debtor:{},creditor:{},balances:{date:'2026-10-07',account:200000,wallet:100000},operational:{wallet:metric(100000),total:metric(300000),account:metric(200000)},sections:{plan:{source:'test',cash:[],orders:[],debtor:{},creditor:{},balances:{},planReceipts:[{date:'2026-10-07',category:'Продажи',amount:50000}],planPayments:[{date:'2026-10-07',category:'Аренда',amount:20000}]}}};
test('validates percentage and calendar date, including fractional percent',()=>{
 assert.equal(parseWalletPercentage({percent:8.29,effectiveFrom:'2026-10-07'}).percent,8.29);
 for(const value of [-1,101,NaN,1.001,'10',null]) assert.throws(()=>parseWalletPercentage({percent:value,effectiveFrom:'2026-10-07'}));
 assert.throws(()=>parseWalletPercentage({percent:10,effectiveFrom:'2026-02-30'}));
});
test('effective dates are inclusive; older periods, future rules, zero and cents are preserved',()=>{
 const rules=[{percent:10,effectiveFrom:'2026-10-07'},{percent:20,effectiveFrom:'2026-11-01'},{percent:0,effectiveFrom:'2026-12-01'}];
 assert.equal(adjustedWallet(100000,rules,'2026-10-06').value,100000);
 assert.equal(adjustedWallet(100000,rules,'2026-10-07').value,110000);
 assert.equal(adjustedWallet(100000,rules,'2026-11-01').value,120000);
 assert.equal(adjustedWallet(100000,rules,'2026-12-01').value,100000);
 assert.equal(adjustedWallet(0.15,[{percent:10,effectiveFrom:'2026-10-07'}],'2026-10-07').value,0.17);
});
test('wallet, total and operational forecast change together without mutating archived facts',()=>{
 const rules=[{percent:10,effectiveFrom:'2026-10-07'}];
 const adjusted=withPlanningIndicators(withWalletPercentage(base,rules,'2026-10-07'),'2026-10-01','2026-10-31');
 assert.equal(adjusted.balances.wallet,110000);
 assert.equal(adjusted.operational.wallet.value,110000);
 assert.equal(adjusted.operational.total.value,310000);
 assert.equal(adjusted.operational.operationalBalance.value,340000);
 assert.equal(adjusted.sections.plan.plannedBalance.value,340000);
 assert.equal(base.operational.wallet.value,100000);
 assert.equal(base.balances.wallet,100000);
 assert.equal(withWalletPercentage({...base,balances:{date:'2026-10-06',wallet:100000}},rules,'2026-10-31').balances.wallet,100000);
 const missing=withWalletPercentage({...base,operational:{...base.operational,wallet:metric(null)}},rules,'2026-10-07');
 assert.equal(missing.operational.total.value,null);
});
test('API save/read recalculates all dependent amounts and enforces authorization',async()=>{
 let saved=[];
 const store=require('../app/lib/wallet-percentage-store.ts');
 const auth=require('../app/lib/auth.ts');
 const savedGuard=auth.guard,savedRead=store.readWalletPercentage,savedWrite=store.saveWalletPercentage;
 let role='admin', hasOverview=true;
 auth.guard=async(request,requiredRole,section)=>{
  assert.equal(requiredRole,undefined);assert.equal(section,'overview');
  return !role?new Response(null,{status:401}):hasOverview?null:new Response(null,{status:403});
 };
 store.readWalletPercentage=async()=>saved;
 store.saveWalletPercentage=async value=>{const rule=parseWalletPercentage(value);saved=[rule];return rule;};
 try {
  const route=require('../app/api/settings/wallet-percentage/route.ts');
  const request=value=>new Request('http://localhost/api/settings/wallet-percentage',{method:'POST',body:JSON.stringify(value)});
  const before=withPlanningIndicators(withWalletPercentage(base,saved,'2026-10-07'),'2026-10-01','2026-10-31');
  assert.equal(before.operational.operationalBalance.value,330000);
  const response=await route.POST(request({percent:10,effectiveFrom:'2026-10-07'}));assert.equal(response.status,200);
  const result=await response.json();assert.equal(result.saved,true);
  const read=await route.GET(new Request('http://localhost'));const rules=(await read.json()).rules;
  const after=withPlanningIndicators(withWalletPercentage(base,rules,'2026-10-07'),'2026-10-01','2026-10-31');
  assert.equal(after.operational.wallet.value,110000);assert.equal(after.operational.total.value,310000);assert.equal(after.operational.operationalBalance.value,340000);
  assert.equal((await route.POST(request({percent:101,effectiveFrom:'2026-10-07'}))).status,422);
  role='user';
  assert.equal((await route.GET(new Request('http://localhost'))).status,200);
  assert.equal((await route.POST(request({percent:12,effectiveFrom:'2026-10-07'}))).status,200);
  assert.equal(saved[0].percent,12);
  hasOverview=false;
  assert.equal((await route.GET(new Request('http://localhost'))).status,403);
  assert.equal((await route.POST(request({percent:10,effectiveFrom:'2026-10-07'}))).status,403);
  role=null;
  assert.equal((await route.POST(request({percent:10,effectiveFrom:'2026-10-07'}))).status,401);
 }finally{auth.guard=savedGuard;store.readWalletPercentage=savedRead;store.saveWalletPercentage=savedWrite;}
});
test('dashboard read recalculates archived facts with latest saved rule and changes client cache version',async()=>{
 const archive=require('../app/lib/period-archive.ts');
 const store=require('../app/lib/wallet-percentage-store.ts');
 const savedLoad=archive.archivedLoad,savedRead=store.readWalletPercentage;
 let rules=[];
 archive.archivedLoad=async()=>({...base,archive:{mode:'archive',cacheVersion:'raw-version'}});
 store.readWalletPercentage=async()=>rules;
 try {
  const {loadDashboard}=require('../app/lib/load-dashboard.ts');
  const params=new URLSearchParams({start:'2026-10-01',end:'2026-10-07'});
  const before=await loadDashboard(params);
  rules=[{percent:10,effectiveFrom:'2026-10-07'}];
  const after=await loadDashboard(params);
  assert.equal(after.operational.wallet.value,110000);
  assert.equal(after.operational.total.value,310000);
  assert.equal(after.plannedBalance.value,340000);
  assert.notEqual(after.archive.cacheVersion,before.archive.cacheVersion);
  assert.equal((await loadDashboard(params)).operational.wallet.value,110000);
  assert.equal(base.operational.wallet.value,100000);
 }finally{archive.archivedLoad=savedLoad;store.readWalletPercentage=savedRead;}
});
test('operational dashboard exposes raw wallet, cashless value, applied rate and operational balance',()=>{
 require.extensions['.tsx']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,file);
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
 const Panel=require('../app/operational-panel.tsx').default;
 const Settings=require('../app/wallet-percentage-settings.tsx').default;
 const adjusted=withPlanningIndicators(withWalletPercentage(base,[{percent:10,effectiveFrom:'2026-10-07'}],'2026-10-07'),'2026-10-01','2026-10-31');
 const markup=renderToStaticMarkup(React.createElement(Panel,{data:adjusted.operational,walletSettings:React.createElement(Settings,{financial:adjusted.operational,refresh:async()=>{}})}));
 for(const label of ['Исходный остаток кошелька','Кошелёк в безналичном эквиваленте','Применена ставка +10%','Операционный остаток','Ставка надбавки, %','Действует с','Сохранить процент','110 000,00','340 000,00']) assert.ok(markup.replace(/[\u00a0\u202f]/g,' ').includes(label),label);
 assert.equal(adjusted.operational.walletConversion.raw,100000);
 assert.equal(adjusted.operational.walletConversion.converted,110000);
 const missing=withWalletPercentage(base,[],'2026-10-07');
 assert.equal(missing.operational.walletConversion.percent,null);
 assert.match(renderToStaticMarkup(React.createElement(Panel,{data:missing.operational})),/Ставка приведения к безналу на дату остатка не задана/);
});
