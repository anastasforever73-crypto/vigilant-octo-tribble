const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), Module = require('node:module'), ts = require('typescript');
const original = Module._load;
Module._load = function(n,p,m) { if(n==='server-only') return {}; if(n.startsWith('@/')) n=process.cwd()+'/'+n.slice(2); return original.call(this,n,p,m); };
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const ExcelJS = require('exceljs');
const {dashboardReport,opiuReport,writeExcel,RUB} = require('../app/lib/excel-report.ts');
const {visibleDashboard} = require('../app/lib/dashboard-access.ts');
const opts = {section:'cash',start:'2026-09-01',end:'2026-09-30',compare:true};
const cash = (date, amount, article='Продажи')=>({date,amount,article,counterparty:'=HYPERLINK("bad")',source:'SECRET_SOURCE',flow:'ДДС'});
const data = {source:'SECRET_SOURCE',cash:[cash('2026-09-01',1000.25),cash('2026-09-30',-200.10),cash('2026-08-31',400),cash('2026-10-01',999999)],orders:[],debtor:{},creditor:{},balances:{},fields:{cash:true,orders:false,balances:false},sources:{private:{token:'SECRET_TOKEN'}},period:{start:opts.start,end:opts.end,comparisonStart:'2026-08-02'}};
async function workbook(report){const w=new ExcelJS.Workbook();await w.xlsx.load(await writeExcel(report));return w;}
function values(w){return w.worksheets.flatMap(s=>s.getSheetValues().flat(2)).map(v=>v && typeof v==='object' && 'formula' in v ? v.result : v);}
test('XLSX roundtrip: period boundaries, exact sums, comparison, styles and safe text',async()=>{
 const r=dashboardReport(data,opts), w=await workbook(r), all=values(w);
 assert.deepEqual(w.worksheets.map(s=>s.name),['Отчёт','Детализация']);
 assert.equal(r.tables[0].rows[0][1],1000.25); assert.equal(r.tables[0].rows[1][1],200.10); assert.equal(r.tables[0].rows[2][1],800.15);
 assert.equal(r.tables[0].rows[0][2],400); assert.equal(r.details[0].rows.length,3);
 assert.ok(all.includes('01.09.2026–30.09.2026'));assert.ok(!all.includes(999999));
 assert.ok(!JSON.stringify(all).includes('SECRET_'));
 const s=w.getWorksheet('Детализация'); assert.ok(s.getTables().length);assert.equal(s.getColumn(1).width,48);
 let dates=0, amounts=0, safe=0; s.eachRow(row=>row.eachCell(c=>{if(c.value instanceof Date){dates++;assert.equal(c.numFmt,'dd.mm.yyyy');}if(c.value===1000.25){amounts++;assert.equal(c.numFmt,RUB);}if(c.value==='=HYPERLINK("bad")'){safe++;assert.equal(c.type,ExcelJS.ValueType.String);}}));assert.ok(dates&&amounts&&safe);
 const off=dashboardReport(data,{...opts,compare:false});assert.equal(off.details[0].rows.length,2);assert.equal(off.tables[0].headers.length,2);
});
test('empty period exports valid workbook with explicit no-data message',async()=>{
 const w=await workbook(dashboardReport({...data,cash:[]},opts));assert.ok(values(w).includes('Нет данных за выбранный период'));assert.ok(!values(w).includes(0));
});
test('debt as-of, cents, historical comparison and details',async()=>{
 const categories={Текущая:100025,Просроченная:0,Сомнительная:0,Безнадежная:0};
 const snapshot=(asOf,totalCents,details=null)=>({asOf,totalCents,advancesCents:0,categories,bySource:{},updatedAt:'2026-09-30',historical:asOf!=='2026-09-30',details});
 const details=[{source:'Транзит',key:'Клиент',date:'2026-09-20',age:10,category:'Текущая',balanceCents:100025,row:7}];
 const debt={...data,receivables:{asOf:'2026-09-30',current:snapshot('2026-09-30',100025,details),sources:{},errors:{},week:{start:'2026-09-23',end:'2026-09-29'},archive:{status:'available',snapshots:[snapshot('2026-08-31',80000)],diagnostics:[]}}};
 const r=dashboardReport(debt,{...opts,section:'debt',asOf:'2026-09-30'});
 assert.equal(r.tables[0].rows[0][1],1000.25);assert.equal(r.details[0].rows[0][5],1000.25);assert.equal(r.tables.at(-1).rows[2][1],200.25);
 const historical=dashboardReport(debt,{...opts,section:'debt',asOf:'2026-08-31'});assert.equal(historical.tables[0].rows[0][1],800);assert.equal(historical.details[0].rows.length,0);
 await workbook(r);
});
test('Opiu uses selected segment/month and preserves percentages',async()=>{
 const cell=value=>({value,text:String(value),state:'number',address:'B6'});
 const r=opiuReport({months:['2026-07','2026-08'],rows:[{row:6,label:'Выручка',percent:false,cells:{'2026-07':{СКЛАД:cell(500)},'2026-08':{СКЛАД:cell(900),ИТОГО:cell(9999)}}},{row:7,label:'Маржа',percent:true,cells:{'2026-08':{СКЛАД:cell(.25)}}}]},{section:'opiu',start:'2026-08-01',end:'2026-08-31',compare:true,segment:'СКЛАД'});
 assert.deepEqual(r.tables[0].rows[0],['Выручка',900,500,400]);assert.ok(!JSON.stringify(r).includes('9999'));
 const w=await workbook(r);let found=false;w.getWorksheet('Отчёт').eachRow(row=>row.eachCell(c=>{if(c.value===.25 || c.value?.result===.25){found=true;assert.equal(c.numFmt,'0.00%');}}));assert.ok(found);
});
test('API: real signed administrator/user sessions, section denial, invalid dates, source errors',async()=>{
 process.env.AUTH_SECRET='x'.repeat(40);process.env.ADMIN_LOGIN='test-admin';process.env.ADMIN_PASSWORD_HASH='scrypt$32768$8$3$'+'a'.repeat(32)+'$'+'b'.repeat(128);
 const viewer={login:'restricted',passwordHash:process.env.ADMIN_PASSWORD_HASH,enabled:true,sections:['cash']};
 require('../app/lib/user-registry.ts').readRegistry=async()=>({users:[viewer]});
 const auth=require('../app/lib/auth.ts');const {NextRequest}=require('next/server');
 const admin=auth.createSession('admin',undefined,[viewer]),user=auth.createSession('user','restricted',[viewer]);
 let loads=0,fail=false;require('../app/lib/load-dashboard.ts').loadDashboard=async()=>{loads++;if(fail)throw Error('SECRET_TOKEN');return data;};
 const {GET}=require('../app/api/export/route.ts'); const {proxy}=require('../proxy.ts');
 const req=(cookie,section='cash',extra='')=>new NextRequest('http://localhost/api/export?section='+section+'&start=2026-09-01&end=2026-09-30&compare=1'+extra,{headers:cookie?{cookie:`${auth.SESSION_COOKIE}=${cookie}`}:{}});
 assert.equal((await GET(req())).status,401);
 assert.equal((await GET(req(user,'sales'))).status,403);assert.equal(loads,0);
 assert.equal((await GET(req(admin,'settings'))).status,400);
 assert.equal((await GET(new NextRequest('http://localhost/api/export?section=cash&start=bad&end=bad&compare=1',{headers:{cookie:`${auth.SESSION_COOKIE}=${admin}`}}))).status,400);
 for(const cookie of [admin,user]){assert.equal((await proxy(req(cookie))).status,200);const response=await GET(req(cookie));assert.equal(response.status,200);assert.match(decodeURIComponent(response.headers.get('content-disposition')),/ДДС_01.09.2026-30.09.2026.xlsx/);const w=new ExcelJS.Workbook();await w.xlsx.load(Buffer.from(await response.arrayBuffer()));assert.ok(values(w).includes(1000.25));assert.ok(!JSON.stringify(values(w)).includes('SECRET_'));}
 fail=true;const response=await GET(req(admin));assert.equal(response.status,502);assert.ok(!JSON.stringify(await response.json()).includes('SECRET_'));
});
test('sales manager exact values and balance fields follow visible payload',async()=>{
 const row={date:'2026-09-15',order:'1',manager:'Менеджер',revenue:100.55};
 const r=dashboardReport({...data,orders:[row],fields:{orders:true}}, {...opts,section:'sales'});assert.equal(r.tables[1].rows[0][1],100.55);
 const restricted=visibleDashboard({...data,sections:{balance:{...data,balanceSheet:[{date:'2026-09-30',category:'Активы',article:'ДС',amount:500}]}}},{role:'user',sections:['balance']});
 const balance=dashboardReport(restricted,{...opts,section:'balance'});assert.deepEqual(balance.tables[0].rows[0].slice(1),['Активы','ДС',500]);await workbook(balance);
});
test('plan XLSX API enforces independent access and preserves selected values', async () => {
 const auth=require('../app/lib/auth.ts'),{NextRequest}=require('next/server');
 const plans={...data,sections:{plan:{...data,planReceipts:[{date:'2026-09-15',category:'Выручка',amount:500.15,counterparty:'Покупатель',note:'План'}],planPayments:[{date:'2026-09-20',category:'Аренда',amount:200.10,counterparty:'Арендодатель',note:'План'}]}}};
 require('../app/lib/load-dashboard.ts').loadDashboard=async()=>plans;
 const viewer={login:'planner',passwordHash:process.env.ADMIN_PASSWORD_HASH,enabled:true,sections:['plan']};
 require('../app/lib/user-registry.ts').readRegistry=async()=>({users:[viewer]});
 const cookie=auth.createSession('user','planner',[viewer]);
 const req=section=>new NextRequest(`http://localhost/api/export?section=${section}&start=2026-09-01&end=2026-09-30&compare=1`,{headers:{cookie:`${auth.SESSION_COOKIE}=${cookie}`}});
 const {GET}=require('../app/api/export/route.ts');
 assert.equal((await GET(req('overview'))).status,403);
 const response=await GET(req('plan'));assert.equal(response.status,200);
 const w=new ExcelJS.Workbook();await w.xlsx.load(Buffer.from(await response.arrayBuffer()));
 assert.ok(values(w).includes(500.15));assert.ok(values(w).includes(300.05));
 assert.ok(!JSON.stringify(values(w)).includes('SECRET_'));
});

test('calculated XLSX cells contain editable references, cached results and recalc flag', async()=>{
 const w=await workbook(dashboardReport(data,opts));
 const main=w.getWorksheet('Отчёт'), detail=w.getWorksheet('Детализация');
 const metric=label=>{let found;main.eachRow(row=>{if(row.getCell(1).value===label)found=row;});return found;};
 const incoming=metric('Поступления').getCell(2), outgoing=metric('Выплаты').getCell(2);
 assert.match(incoming.formula,/SUMIFS\('Детализация'!/);assert.match(incoming.formula,/">0"/);
 assert.match(outgoing.formula,/^-SUMIFS/);assert.equal(incoming.result,1000.25);
 const net=metric('Чистый денежный поток');assert.match(net.getCell(2).formula,/^'Отчёт'!B\d+-'Отчёт'!B\d+$/);
 assert.equal(net.getCell(2).result,800.15);assert.match(net.getCell(4).formula,/-'Отчёт'!C/);
 assert.equal(incoming.numFmt,RUB);
 let amount;detail.eachRow(row=>{if(row.getCell(3).value===1000.25)amount=row.getCell(3);});
 const match=incoming.formula.match(/!\$C\$(\d+):\$C\$(\d+)/);assert.ok(amount.row>=+match[1]&&amount.row<=+match[2]);
 amount.value=1500.25;assert.equal(incoming.type,ExcelJS.ValueType.Formula);
});
test('plan totals and shares reference details and Opiu duplicate labels use separate row blocks',async()=>{
 const plans={...data,planReceipts:[{date:'2026-09-15',category:'A*?',amount:500}],planPayments:[{date:'2026-09-16',category:'Rent',amount:200}]};
 const w=await workbook(dashboardReport(plans,{...opts,section:'plan'}));
 const formulas=[];w.getWorksheet('Отчёт').eachRow(row=>row.eachCell(c=>{if(c.formula)formulas.push(c.formula);}));
 assert.ok(formulas.some(f=>f.includes('A~*~?')));assert.ok(formulas.some(f=>f.startsWith('IF(')));
 const cell=value=>({value,text:String(value),state:'number',address:'B6'});
 const r=opiuReport({months:['2026-08'],rows:[1,2].map((n)=>({row:n,label:'Same',percent:false,cells:{'2026-08':{ИТОГО:cell(n*10)}}}))},{...opts,start:'2026-08-01',end:'2026-08-31',section:'opiu',compare:false});
 const ow=await workbook(r), refs=[];ow.getWorksheet('Отчёт').eachRow(row=>{if(row.getCell(1).value==='Same')refs.push(row.getCell(2).formula);});
 assert.equal(refs.length,2);assert.ok(refs.every(Boolean));assert.notEqual(refs[0],refs[1]);
});
test('operational export calculates wallet markup, account sum and total from exported inputs',async()=>{
 const metric=value=>({value,date:'2026-09-30'});
 const op={account:{...metric(100),breakdown:[{name:'Банк',value:100}]},wallet:metric(110),deposit:metric(50),total:metric(260),walletConversion:{raw:100,percent:10}};
 const w=await workbook(dashboardReport({...data,operational:op},{...opts,section:'overview'}));
 const rows=new Map();w.getWorksheet('Отчёт').eachRow(row=>rows.set(row.getCell(1).value,row));
 assert.match(rows.get('Кошелёк').getCell(2).formula,/^ROUND\(/);
 assert.equal(rows.get('Кошелёк').getCell(2).result,110);
 assert.match(rows.get('Расчётный счёт').getCell(2).formula,/^SUM\('Детализация'!/);
 assert.match(rows.get('Остатки ДС — всего').getCell(2).formula,/\+/);
 const partial=await workbook(dashboardReport({...data,operational:{...op,total:metric(300)}},{...opts,section:'overview'}));
 partial.getWorksheet('Отчёт').eachRow(row=>{if(row.getCell(1).value==='Остатки ДС — всего')assert.equal(row.getCell(2).value,300);});
});
