const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript'), Module = require('node:module');
const originalLoad = Module._load;
Module._load = function(n,p,m) { if(n==='server-only') return {}; if(n.startsWith('@/')) n=process.cwd()+'/'+n.slice(2); return originalLoad.call(this,n,p,m); };
require.extensions['.ts'] = (m,f) => m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'), { compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true} }).outputText,f);
require.extensions['.tsx'] = (m,f) => m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'), { compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true} }).outputText,f);
const {parseNlpkHistory,nlpkHistoryAt,nlpkTotal,NLPK_HISTORY_SHEET,NLPK_HISTORY_VERSION} = require('../app/lib/nlpk-payables.ts');
const {withPlanningIndicators} = require('../app/lib/planning-indicators.ts');
const {composeConnections} = require('../app/lib/connections/compose.ts');
const {bindingKey} = require('../app/lib/connections/merge.ts');
const row=(date,balance,opening=999999999)=>[date,'',opening,'','','',balance,'В период'];
const fixture=[[],['Счет'],['Контрагенты','','Кредит','','','','Кредит'],['Период'],row('НОВОТОРЖСКИЙ ЛПК АО',149534676),row(46294,280156293.98),row('30.09.2026',286311553.98),row('2026-10-01',278064249.98),row('02.10.2026',269458249.98),row(46298,'271 345 289,98')];
const base={source:'test',cash:[],orders:[],debtor:{},creditor:{},balances:{},period:{start:'2026-09-30',end:'2026-10-06',comparisonStart:'2026-09-23'},operational:{total:{value:1},payables:{value:null}}};
test('A/G from row 6: skip creditor row, headers, invalid dates/amounts and empty values; retain zero',()=>{
 const history=parseNlpkHistory([...fixture,row('Итого',999),row('31.02.2026',999),row('2026-10-04',''),row('2026-10-04','Ошибка'),[],row('2026-10-05',0)]);
 assert.equal(history.creditor,'НЛПК'); assert.equal(history.history.length,6);
 assert.equal(nlpkTotal(nlpkHistoryAt(history.history,'2026-10-06')),0);
 assert.equal(nlpkTotal(nlpkHistoryAt(history.history,'2026-09-29')),280156293.98);
 assert.equal(nlpkTotal(nlpkHistoryAt(history.history,'2026-09-28')),null);
});
test('latest chronological record before end, independent of start; same date uses last physical record, never a sum',()=>{
 const history=parseNlpkHistory([row('2026-10-03',10),row('2026-10-02',900),row('2026-10-03',11),row('2026-10-07',999)],6);
 assert.equal(nlpkTotal(nlpkHistoryAt(history.history,'2026-10-06')),11);
 assert.equal(nlpkTotal(nlpkHistoryAt(history.history,'2026-10-02')),900);
});
test('provided amounts reach operational/debt cards and comparison; both snapshots change with selected period',()=>{
 const history=parseNlpkHistory(fixture);
 const source={...base,receivables:{nlpkHistory:history}};
 const data=withPlanningIndicators(source,'2026-09-30','2026-10-06');
 assert.equal(data.operational.payables.value,271345289.98); assert.equal(data.operational.payables.date,'2026-10-03');
 assert.deepEqual(data.operational.payables.comparison,{value:280156293.98,date:'2026-09-29',end:'2026-09-29'});
 assert.equal(data.sections.debt.creditor.factory,271345289.98);
 const changed=withPlanningIndicators(source,'2026-10-01','2026-10-02');
 assert.equal(changed.operational.payables.value,269458249.98); assert.equal(changed.operational.payables.comparison.value,286311553.98);
 assert.equal(source.operational.payables.value,null);
});
test('configured old mappings read fixed A6/G, without searching counterparty A; adapter → compose → card',async()=>{
 const sheets=require('../app/lib/google-sheets.ts'), archive=require('../app/lib/source-input-archive.ts');
 const originals={sheetsClient:sheets.sheetsClient,discoverSheets:sheets.discoverSheets,sourceInput:archive.sourceInput};
 const identities=[],ranges=[];
 archive.sourceInput=async (key,load)=>{identities.push(key);return load()};
 sheets.discoverSheets=async()=>{throw Error('Generic header mapping must not run on this history source')};
 sheets.sheetsClient=()=>({spreadsheets:{get:async()=>({data:{sheets:[{properties:{title:NLPK_HISTORY_SHEET,gridProperties:{rowCount:fixture.length}}}]}}),values:{get:async ({range})=>{ranges.push(range);return {data:{values:fixture.slice(5)}}}}}});
 try {
  const c={id:'nlpk',name:'Кредиторка',status:'connected',type:'googleSheets',enabled:true,config:{spreadsheetId:'test-sheet-id'},bindings:['payables','nlpkPayables'].map(dataset=>({dataset,section:dataset==='payables'?'debt':'overview',sheet:NLPK_HISTORY_SHEET,headerRow:3,columns:{date:0,balance:2,counterparty:0},headers:{date:'Контрагенты',balance:'Кредит',counterparty:'Контрагенты'},confirmed:true,mode:'primary',priority:50}))};
  const {adapters}=require('../app/lib/connections/adapters.ts');
  const stored=await adapters.googleSheets.read(c,{},'2026-09-23','2026-10-06');
  assert.ok(ranges.every(r=>r.endsWith('!A6:G10'))); assert.equal(identities[0][0],NLPK_HISTORY_VERSION);
  assert.equal(stored.byBinding[bindingKey(c.bindings[1])].history.length,5);
  const projected=withPlanningIndicators(composeConnections(base,[c],new Map([[c.id,stored]])),'2026-09-30','2026-10-06');
  assert.equal(projected.operational.payables.value,271345289.98); assert.equal(projected.operational.payables.comparison.value,280156293.98);
  const before=JSON.stringify(identities[0]);
  await adapters.googleSheets.read({...c,config:{spreadsheetId:'different-sheet-id'}},{},'2026-09-23','2026-10-06');
  assert.notEqual(JSON.stringify(identities[2]),before);
 }finally{Object.assign(sheets,{sheetsClient:originals.sheetsClient,discoverSheets:originals.discoverSheets});archive.sourceInput=originals.sourceInput;}
});
test('legacy reader ignores service rows and retains history for independent period projections',async()=>{
 const sheets=require('../app/lib/google-sheets.ts'), original=sheets.sheetsClient;
 sheets.sheetsClient=()=>({spreadsheets:{get:async()=>({data:{sheets:[{properties:{title:NLPK_HISTORY_SHEET,gridProperties:{rowCount:fixture.length,columnCount:7}}}]}}),values:{get:async()=>({data:{values:fixture}})}}});
 try {
  const {readReceivables}=require('../app/lib/read-receivables.ts');
  const report=await readReceivables({debtEnabled:true,debtGoogleSheetId:'test',googleServiceAccountEmail:'test',googlePrivateKey:'test',factorySheet:NLPK_HISTORY_SHEET},new Date('2026-10-06T12:00:00Z'));
  assert.equal(report.payablesError,undefined);assert.equal(report.payables.factory,271345289.98);
  const projected=withPlanningIndicators({...base,receivables:report},'2026-09-30','2026-10-06');
  assert.equal(projected.operational.payables.comparison.value,280156293.98);
 }finally{sheets.sheetsClient=original;}
});
test('existing card renders actual date and comparison, comparison toggle hides only comparison text',()=>{
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
 const Panel=require('../app/operational-panel.tsx').default;
 const data=withPlanningIndicators({...base,receivables:{nlpkHistory:parseNlpkHistory(fixture)}},'2026-09-30','2026-10-06');
 const html=renderToStaticMarkup(React.createElement(Panel,{data:data.operational,compare:true})).replace(/\u00a0|\u202f/g,' ');
 assert.match(html,/271 345 289,98/);assert.match(html,/03\.10\.2026/);assert.match(html,/280 156 293,98/);assert.match(html,/29\.09\.2026/);
 const noCompare=renderToStaticMarkup(React.createElement(Panel,{data:data.operational,compare:false}));
 assert.doesNotMatch(noCompare,/Сравнение:/);assert.match(noCompare,/03\.10\.2026/);
});
test('cached aggregate cannot supply a different comparison period',()=>{
 const {coveredDashboard}=require('../app/lib/dashboard-query-cache.ts');
 const data=withPlanningIndicators({...base,receivables:{nlpkHistory:parseNlpkHistory(fixture)}},'2026-09-30','2026-10-06');
 assert.equal(coveredDashboard(data,'2026-10-01','2026-10-06'),undefined);
});
test('old interpreted snapshots and changed source mappings are rejected, unrelated sources retain cache compatibility',()=>{
 const {nlpkSnapshotCompatible}=require('../app/lib/connections/store.ts');
 const b={dataset:'nlpkPayables',section:'overview',sheet:NLPK_HISTORY_SHEET,headerRow:3,columns:{date:0,balance:6}};
 assert.equal(nlpkSnapshotCompatible([b],{nlpkPayables:[{date:'2026-10-03',balance:1}]}),false);
 assert.equal(nlpkSnapshotCompatible([b],{byBinding:{[bindingKey(b)]:[{date:'2026-10-03',balance:1}]}}),false);
 const stored={byBinding:{[bindingKey(b)]:parseNlpkHistory(fixture)}};
 assert.equal(nlpkSnapshotCompatible([b],stored),true);
 assert.equal(nlpkSnapshotCompatible([{...b,columns:{date:0,balance:2}}],stored),false);
 assert.equal(nlpkSnapshotCompatible([{...b,sheet:'Другой источник'}],{nlpkPayables:[]}),true);
});
