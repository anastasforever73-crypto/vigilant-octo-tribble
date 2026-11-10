// Read-only browser checks against local production build; no source mutation.
const fs=require('node:fs'),Module=require('node:module'),ts=require('typescript'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
require('@next/env').loadEnvConfig(process.cwd());
const load=Module._load;Module._load=function(n,p,m){return n==='server-only'?{}:load.call(this,n,p,m)};
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const binary=process.env.AGENT_BROWSER_BIN;
if(!binary)throw Error('AGENT_BROWSER_BIN required');
const session='mart-enhancements-local';
const options={encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:65000,env:{...process.env,AGENT_BROWSER_DEFAULT_TIMEOUT:'60000'}};
const run=(...args)=>execFileSync(binary,['--session',session,...args],options);
const ev=code=>JSON.parse(execFileSync(binary,['--session',session,'eval','--stdin','--json'],{...options,input:code})).data.result;
const out='artifacts/dashboard-enhancements';fs.mkdirSync(out,{recursive:true});
const report={};let stage='start';
try{
 const {createSession}=require('../app/lib/auth.ts');
 run('open','http://127.0.0.1:3102/login');
 ev(`document.cookie=${JSON.stringify('mart_trade_session='+createSession('admin')+'; Path=/; SameSite=Strict')};true`);
 run('set','viewport','1440','1000');run('open','http://127.0.0.1:3102/');
 run('wait','--fn',"document.querySelector('.receivables')?.getAttribute('aria-busy')==='false'");
 assert.equal(ev("document.querySelectorAll('.key-indicators .mini').length"),8);
 assert.equal(ev("document.querySelector('.key-indicators').textContent.includes('Кредиторская задолженность НЛПК')"),true);
 run('screenshot',out+'/overview-desktop.png');
 stage='tooltip hover';
 run('hover','.key-indicators [aria-label="О показателе «Расчётный счёт»"]');
 assert.equal(ev("document.querySelector('.key-indicators [role=tooltip]')!==null"),true,stage);
 stage='tooltip Escape';run('press','Escape');assert.equal(ev("document.querySelector('.key-indicators [role=tooltip]')===null"),true);
 report.overview=true;
 stage='mobile';
 for(const width of [320,390,768,1440]){
  run('set','viewport',String(width),'1000');
  assert.equal(ev('document.documentElement.scrollWidth<=innerWidth'),true,'overflow '+width);
 }
 run('set','viewport','390','844');run('press','Escape');
 // Pointer of type touch reproduces tap without synthesized hover.
 ev("document.querySelector('.key-indicators .info-tip-trigger').dispatchEvent(new PointerEvent('pointerenter',{pointerType:'touch',bubbles:true}));document.querySelector('.key-indicators .info-tip-trigger').click();true");
 assert.equal(ev("document.querySelector('.key-indicators [role=tooltip]')!==null"),true,stage);
 assert.equal(ev("(()=>{const r=document.querySelector('.key-indicators [role=tooltip]').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})()"),true);
 run('screenshot',out+'/overview-mobile.png');run('press','Escape');report.responsive=true;
 const navigate=tab=>ev(`document.querySelector('#tab-${tab}').click();true`);
 stage='debt';navigate('debt');
 assert.equal(ev("document.querySelector('.debt-comparison').textContent.includes('За предыдущий период нет полного подтверждённого снимка')"),true);
 for(const width of [320,390,768,1440]){run('set','viewport',String(width),'1000');assert.equal(ev('document.documentElement.scrollWidth<=innerWidth'),true,'debt overflow '+width);}
 run('screenshot',out+'/debt-desktop.png');
 run('find','role','button','click','--name','День','--exact');
 run('wait','--fn',"document.querySelector('.receivables')?.getAttribute('aria-busy')==='false'");
 assert.equal(ev("document.querySelector('.debt-comparison').textContent.includes('Предыдущий сопоставимый период')"),true);
 run('uncheck','.compare input');assert.equal(ev("document.querySelector('.debt-comparison').textContent.includes('Сравнение выключено')"),true);
 run('check','.compare input');report.comparison=true;
 stage='cash';navigate('cash');
 assert.equal(ev("document.querySelector('.wide-alert')===null"),true);
 run('hover','#panel-cash .info-tip-trigger');assert.equal(ev("document.querySelector('#panel-cash [role=tooltip]').textContent.includes('Требует внимания')"),true);run('press','Escape');report.attention=true;
 stage='admin';navigate('settings');
 run('wait','--fn',"document.querySelector('.connection-card')!==null");
 const colors=ev("Array.from(document.querySelectorAll('.connection-card button')).map(b=>({text:b.textContent,primary:b.classList.contains('primary'),danger:b.classList.contains('danger')}))");
 assert.ok(colors.filter(b=>/Проверить подключение|Обновить данные/.test(b.text)).every(b=>b.primary));
 assert.ok(colors.filter(b=>/Удалить|Отключить/.test(b.text)).every(b=>b.danger));
 ev("window.__confirms=[];window.__mutations=[];window.confirm=t=>{window.__confirms.push(t);return false};const f=window.fetch;window.fetch=(...args)=>{if(args[1]?.method&&args[1].method!=='GET')window.__mutations.push(args[1].method);return f(...args)};true");
 ev("Array.from(document.querySelectorAll('.connection-card button')).filter(b=>/^(Удалить|Отключить)$/.test(b.textContent)).forEach(b=>b.click());true");
 assert.ok(ev('window.__confirms.length')>0);assert.equal(ev('window.__mutations.length'),0);
 run('screenshot',out+'/admin-desktop.png');
 run('set','viewport','390','844');assert.equal(ev('document.documentElement.scrollWidth<=innerWidth'),true);run('screenshot',out+'/admin-mobile.png');
 report.admin=true;report.errors=run('errors');assert.ok(!/Error:/.test(report.errors));
 fs.writeFileSync(out+'/browser-results.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(e){console.error('Browser check failed at '+stage+': '+e.message.split('\n')[0]);process.exitCode=1}finally{try{run('close')}catch{}}
