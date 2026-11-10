const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),Module=require('node:module');
const original=Module._load;Module._load=function(name,...rest){if(name==='server-only')return {};if(name.startsWith('@/'))name=require('node:path').join(process.cwd(),name.slice(2));return original.call(this,name,...rest);};
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const {periodAccountBalances}=require('../app/lib/fintablo-period-balances.ts');
const anchorDate=Date.parse('2026-09-01T12:00:00Z')/1000;
const account=(id,surplus=100)=>({id,name:id===1?'Кошелек':'Банк',type:'bank',currency:'RUB',balance:500,surplus,surplusTimestamp:anchorDate});
const tx=(id,date,group,value,moneybagId=1,extra={})=>({id,date,group,value,moneybagId,isPlan:0,...extra});
test('end-of-day anchor, forward/backward history, transfer sides, actual-only, duplicate and split handling',()=>{
 const accounts=[account(1),account(2,200)];
 const rows=[tx(1,'01.09.2026','income',999),tx(2,'02.09.2026','income',10),tx(3,'03.09.2026','outcome',5),tx(4,'04.09.2026','transfer',20,1,{moneybag2Id:2,value2:18}),tx(5,'05.09.2026','income',1000,1,{isPlan:1}),tx(6,'06.09.2026','income',10),tx(6,'06.09.2026','income',10),tx(7,'07.09.2026','income',30),tx(8,'07.09.2026','income',10,1,{parentId:7}),tx(9,'07.09.2026','income',20,1,{parentId:7})];
 const before=periodAccountBalances(accounts,rows,'2026-09-01','2026-10-07T12:00:00Z');assert.equal(before[0].balance,100);
 const after=periodAccountBalances(accounts,rows,'2026-09-30','2026-10-07T12:00:00Z');assert.equal(after[0].balance,125);assert.equal(after[1].balance,218);
 const pastRows=[tx(10,'31.08.2026','income',20),tx(11,'01.09.2026','outcome',5)];
 const backward=periodAccountBalances(accounts,pastRows,'2026-08-30','2026-10-07T12:00:00Z');assert.equal(backward[0].balance,85);
});
test('unfixed account reverses factual movements from observed balance; missing values remain unknown',()=>{
 const result=periodAccountBalances([{id:1,name:'Банк',type:'bank',balance:100,currency:'RUB'}],[tx(1,'02.10.2026','income',20)],'2026-09-30','2026-10-07T12:00:00Z');assert.equal(result[0].balance,80);
 assert.equal(periodAccountBalances([{id:1,name:'Банк',type:'bank'}],[],'2026-09-30','2026-10-07T12:00:00Z')[0].balanceAvailable,false);
 assert.throws(()=>periodAccountBalances([account(1),account(2)],[tx(1,'02.09.2026','transfer',10,1,{moneybag2Id:2})],'2026-09-30','2026-10-07T12:00:00Z'));
});
test('official reader queries isPlan=0 and pages the complete anchor-to-period interval',async()=>{
 const previous=global.fetch;const requests=[];
 global.fetch=async input=>{const url=new URL(input);requests.push(url);const items=url.pathname==='/v1/moneybag'?[account(1)]:[tx(1,'30.09.2026','income',25)];return new Response(JSON.stringify({status:200,items}),{status:200});};
 try{
  const {readFintabloPeriodBalances}=require('../app/lib/fintablo.ts');
  const snapshot=await readFintabloPeriodBalances('2026-09-30',{fintabloBaseUrl:'https://api.fintablo.ru',fintabloToken:'test-token'});
  assert.equal(snapshot.accounts[0].balance,125);assert.equal(snapshot.balanceDate,'2026-09-30');
  const request=requests.find(r=>r.pathname==='/v1/transaction');assert.equal(request.searchParams.get('isPlan'),'0');assert.equal(request.searchParams.get('dateFrom'),'01.09.2026');assert.equal(request.searchParams.get('dateTo'),'30.09.2026');
  const {operationalFinancial}=require('../app/lib/operational.ts');assert.equal(operationalFinancial(snapshot,'2026-09-30').total.date,'2026-09-30');
 }finally{global.fetch=previous;}
});
test('native FinTablo plans respect period, categories, account selection and factual exclusion',async()=>{
 const previous=global.fetch;
 global.fetch=async input=>{const url=new URL(input);let items=[];
 if(url.pathname==='/v1/moneybag')items=[account(1),account(2)];
 if(url.pathname==='/v1/category')items=[{id:10,name:'Продажи'},{id:20,name:'Аренда'}];
 if(url.pathname==='/v1/partner')items=[{id:30,name:'Клиент'}];
 if(url.pathname==='/v1/transaction'){assert.equal(url.searchParams.get('isPlan'),'1');items=[tx(1,'25.09.2026','income',100,1,{isPlan:1,categoryId:10,partnerId:30}),tx(2,'30.09.2026','outcome',20,1,{isPlan:1,categoryId:20}),tx(3,'01.10.2026','income',999,1,{isPlan:1}),tx(4,'28.09.2026','income',500,2,{isPlan:1}),tx(5,'26.09.2026','income',1000,1,{isPlan:0})];}
 return new Response(JSON.stringify({status:200,items}));};
 try{const {readFintabloPlans}=require('../app/lib/fintablo.ts');const data=await readFintabloPlans('2026-09-24','2026-09-30',{fintabloBaseUrl:'https://api.fintablo.ru',fintabloToken:'test'},[1]);assert.equal(data.planReceipts.length,1);assert.equal(data.planPayments.length,1);assert.equal(data.planReceipts[0].category,'Продажи');assert.equal(data.planReceipts[0].counterparty,'Клиент');assert.equal(data.planPayments[0].amount,20);}finally{global.fetch=previous;}
});
test('native plans fill unassigned section and never override explicitly assigned planning sources',async()=>{
 const store=require('../app/lib/connections/store.ts'),fintablo=require('../app/lib/fintablo.ts');
 const oldList=store.listConnections,oldGet=store.getConnection,oldRead=fintablo.readFintabloPlans,oldDatabase=process.env.DATABASE_URL;
 const binding={section:'cash',dataset:'cash',sheet:'/v1/transaction',headerRow:1,columns:{},confirmed:true,mode:'primary',priority:50};
 store.listConnections=async()=>[{id:'test',type:'fintablo',enabled:true,config:{},bindings:[binding],name:'FinTablo'}];store.getConnection=async()=>({secrets:{token:'test'}});
 fintablo.readFintabloPlans=async()=>({planReceipts:[],planPayments:[]});process.env.DATABASE_URL='configured';
 try{const {withNativeFintabloPlans}=require('../app/lib/read-fintablo-plans.ts');const base={source:'test',cash:[],orders:[],debtor:{},creditor:{},balances:{}};
 const result=await withNativeFintabloPlans(base,'2026-09-24','2026-09-30');assert.deepEqual(result.planReceipts,[]);assert.match(result.planningSource,/FinTablo/);
 const assigned={...base,sections:{plan:{...base}}};assert.equal(await withNativeFintabloPlans(assigned,'2026-09-24','2026-09-30'),assigned);
 }finally{store.listConnections=oldList;store.getConnection=oldGet;fintablo.readFintabloPlans=oldRead;if(oldDatabase===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=oldDatabase;}
});
