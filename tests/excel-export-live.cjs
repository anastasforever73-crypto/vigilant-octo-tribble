// Read-only verification against the existing configured sources and accounts.
const fs=require('node:fs'), Module=require('node:module'), ts=require('typescript'), assert=require('node:assert/strict');
require('@next/env').loadEnvConfig(process.cwd(),false,{info(){},error(){}});
const load=Module._load;Module._load=function(n,p,m){if(n==='server-only')return {};if(n.startsWith('@/'))n=process.cwd()+'/'+n.slice(2);return load.call(this,n,p,m);};
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const ExcelJS=require('exceljs'),auth=require('../app/lib/auth.ts');
const {dashboardReport,opiuReport,reportTitles}=require('../app/lib/excel-report.ts');
const base=process.env.EXPORT_TEST_URL||'http://127.0.0.1:3104';
const report={url:base,checks:[]};
async function run(){
 const viewers=(await require('../app/lib/user-registry.ts').readRegistry()).users;
 const viewer=viewers.find(v=>v.enabled);
 const accounts=[{role:'admin',cookie:auth.createSession('admin',undefined,viewers),sections:Object.keys(reportTitles)}];
 if(viewer) accounts.push({role:'user',cookie:auth.createSession('user',viewer.login,viewers),sections:viewer.sections});
 else if(process.env.USER_LOGIN)accounts.push({role:'user',cookie:auth.createSession('user',process.env.USER_LOGIN,viewers),sections:Object.keys(reportTitles)});
 for(const account of accounts){
  const headers={cookie:`${auth.SESSION_COOKIE}=${account.cookie}`};
  const start='2026-09-01',end='2026-09-30';
  const response=await fetch(`${base}/api/dashboard?start=${start}&end=${end}`,{headers});assert.equal(response.status,200);
  const data=await response.json();
  for(const section of Object.keys(reportTitles)){
   let options={section,start,end,compare:true};let expected;
   if(account.role!=='admin'&&!account.sections.includes(section)){assert.equal((await fetch(`${base}/api/export?section=${section}&start=${start}&end=${end}&compare=1`,{headers})).status,403);report.checks.push({role:account.role,section,denied:true});continue;}
   if(section==='opiu'){
    const response=await fetch(`${base}/api/opiu`,{headers});assert.equal(response.status,200);const data=await response.json();const month=data.defaultMonth;
    options={...options,start:month+'-01',end:new Date(Date.UTC(+month.slice(0,4),+month.slice(5,7),0)).toISOString().slice(0,10),segment:'ИТОГО'};expected=opiuReport(data,options);
   }else {if(section==='debt')options.asOf=data.receivables?.asOf;expected=dashboardReport(data,options);}
   const params=new URLSearchParams({...options,compare:'1'});
   const response=await fetch(`${base}/api/export?${params}`,{headers});assert.equal(response.status,200,account.role+' '+section);
   const buffer=Buffer.from(await response.arrayBuffer());const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer);
   assert.deepEqual(workbook.worksheets.map(s=>s.name),['Отчёт','Детализация']);
   assert.ok(decodeURIComponent(response.headers.get('content-disposition')).includes('.xlsx'));
   let checked=0;
   for(const [name,tables]of [['Отчёт',expected.tables],['Детализация',expected.details]]){
    const sheet=workbook.getWorksheet(name);
    for(const [i,t]of tables.entries()){
     if(!t.rows.length)continue;
     const table=sheet.getTable(`${name==='Отчёт'?'Report':'Detail'}${i}`);assert.ok(table);
     const first=Number(table.table.tableRef.match(/\d+/)[0]);
     for(let r=0;r<t.rows.length;r++)for(let c=0;c<t.rows[r].length;c++){
      const value=t.rows[r][c];if(typeof value==='number'){assert.ok(sheet.getCell(first+1+r,c+1).value === value,`${account.role} ${section} ${t.title} ${r}:${c}`);checked++;}
     }
    }
   }
   report.checks.push({role:account.role,section,bytes:buffer.length,numericCellsVerified:checked});
  }
 }
 assert.ok(accounts.some(a=>a.role==='user'),'No existing viewer account available');
 assert.equal((await fetch(`${base}/api/export?section=cash&start=2026-09-01&end=2026-09-30&compare=0`)).status,401);
 fs.mkdirSync('artifacts/excel-export',{recursive:true});fs.writeFileSync('artifacts/excel-export/live-check.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
run().catch(e=>{console.error(e.message);process.exitCode=1;});
