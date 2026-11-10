const fs=require('node:fs'),Module=require('node:module'),ts=require('typescript'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
require('@next/env').loadEnvConfig(process.cwd(),false,{info(){},error(){}});
const load=Module._load;Module._load=function(n,p,m){return n==='server-only'?{}:load.call(this,n,p,m);};
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const binary=process.env.AGENT_BROWSER_BIN||'/home/codespace/.npm/_npx/6de2aa2fded2970c/node_modules/.bin/agent-browser';
const base=process.env.EXPORT_TEST_URL||'http://127.0.0.1:3104';
const session='excel-export-check',out='artifacts/excel-export';
fs.mkdirSync(out,{recursive:true});
const options={encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:65000,env:{...process.env,AGENT_BROWSER_DEFAULT_TIMEOUT:'60000'}};
const run=(...args)=>execFileSync(binary,['--session',session,...args],options);
const ev=code=>JSON.parse(execFileSync(binary,['--session',session,'eval','--stdin','--json'],{...options,input:code})).data.result;
async function main(){
 const auth=require('../app/lib/auth.ts'),users=(await require('../app/lib/user-registry.ts').readRegistry()).users;
 const viewer=users.find(u=>u.enabled);const results=[];
 for(const role of ['admin','user']){
  const cookie=auth.createSession(role,role==='user'?viewer?.login||process.env.USER_LOGIN:undefined,users);
  run('open',base+'/login');ev(`document.cookie=${JSON.stringify('mart_trade_session='+cookie+'; Path=/; SameSite=Strict')};true`);
  run('set','viewport','1440','1000');run('open',base+'/?tab=debt');
  run('wait','--fn',"!!document.querySelector('#panel-debt .excel-export-button:not(:disabled)')");
  assert.equal(ev("document.querySelectorAll('#panel-debt .excel-export-button').length"),1);
  // Capture real request URL and the browser download event without persisting financial data.
  ev(`(()=>{window.__exports=[];window.__downloads=[];const f=window.fetch;window.fetch=async(...a)=>{if(String(a[0]).startsWith('/api/export'))window.__exports.push(String(a[0]));return f(...a)};HTMLAnchorElement.prototype.click=function(){window.__downloads.push(this.download)};document.querySelector('#panel-debt .excel-export-button').click();return true})()`);
  run('wait','--fn',"window.__downloads.length > 0 || !!document.querySelector('#panel-debt .excel-export-error')");
  assert.equal(ev("document.querySelector('#panel-debt .excel-export-error')?.textContent||''"),'');
  assert.match(ev('window.__exports[0]'),/section=debt.*start=.*end=.*compare=1.*asOf=/);
  assert.match(ev('window.__downloads[0]'),/Дебиторская_задолженность_.*\.xlsx/);
  run('screenshot',out+'/'+role+'-desktop.png');
  run('set','viewport','390','844');run('screenshot',out+'/'+role+'-mobile.png');
  assert.equal(ev("document.documentElement.scrollWidth > window.innerWidth + 1"),false);
  // A formation failure must become a red, accessible alert.
  ev(`(()=>{window.fetch=async()=>new Response('{}',{status:502,headers:{'content-type':'application/json'}});document.querySelector('#panel-debt .excel-export-button').click();return true})()`);
  run('wait','--fn',"!!document.querySelector('#panel-debt .excel-export-error[role=alert]')");
  assert.match(ev("document.querySelector('#panel-debt .excel-export-error').textContent"),/Не удалось сформировать Excel/);
  assert.equal(ev("getComputedStyle(document.querySelector('#panel-debt .excel-export-error')).color"),'rgb(185, 28, 28)');
  results.push({role,download:true,filters:true,redAlert:true,mobileOverflow:false});
 }
 fs.writeFileSync(out+'/browser-check.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));run('close');
}
main().catch(e=>{console.error(e.message);try{run('close')}catch{}process.exitCode=1});
