const fs=require('node:fs'), Module=require('node:module'), ts=require('typescript'), assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const load=Module._load; Module._load=function(n,p,m){return n==='server-only'?{}:load.call(this,n,p,m)};
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const binary=process.env.AGENT_BROWSER_BIN;
if(!binary)throw Error('AGENT_BROWSER_BIN required');
const session='period-archive-check';
const options={encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:65000,env:{...process.env,AGENT_BROWSER_DEFAULT_TIMEOUT:'60000'}};
const run=(...args)=>execFileSync(binary,['--session',session,...args],options);
const ev=code=>JSON.parse(execFileSync(binary,['--session',session,'eval','--stdin','--json'],{...options,input:code})).data.result;
const out='artifacts/period-archive';fs.mkdirSync(out,{recursive:true});
const report=process.env.RESPONSIVE_ONLY && fs.existsSync(out+'/browser-check.json') ? JSON.parse(fs.readFileSync(out+'/browser-check.json','utf8')) : {};let stage='open';
try {
  run('open','http://127.0.0.1:3103/login');
  ev(`document.cookie=${JSON.stringify('mart_trade_session='+require('../app/lib/auth.ts').createSession('admin')+'; Path=/; SameSite=Strict')};true`);
  run('set','viewport','1440','1000'); run('open','http://127.0.0.1:3103/');
  run('wait','--fn',"document.querySelector('.source-note') && !document.querySelector('.source-note').textContent.includes('Обновляем данные')");
  assert.ok(ev("document.body.innerText.includes('Остатки и резервы')"));
  assert.equal(ev("!!document.querySelector('[data-nextjs-dialog]')"),false);
  report.initialLoad=true;
  const labels={overview:'Остатки и резервы',movements:'Поступления и выплаты',salary:'Заработная плата',debt:'Дебиторская задолженность',cash:'Деньги',projects:'Потоки по проектам',opiu:'Прибыль и фонды',plan:'Планирование',balance:'Баланс',sales:'Продажи по менеджерам',goods:'Управление товаром',logistics:'Логистика',settings:'Источники и архив',users:'Пользователи'};
  if (!process.env.RESPONSIVE_ONLY) report.navigation=[];
  for(const [tab,label] of Object.entries(process.env.RESPONSIVE_ONLY ? {} : labels)) {
    stage=tab;
    ev(`(()=>{const link=document.querySelector('#tab-${tab}');const group=link.closest('.nav-group');const groups=[...document.querySelectorAll('.nav-group')];document.querySelectorAll('.nav-mode-switch button')[groups.indexOf(group)].click();return true})()`);
    run('click',`#tab-${tab}`);
    run('wait','--fn',`document.querySelector('h1')?.textContent===${JSON.stringify(label)}`);
    assert.equal(ev("document.querySelectorAll('[data-nextjs-dialog]').length"),0,stage);
    report.navigation.push(tab);
    for (const width of [320,768,1440]) { run('set','viewport',String(width),'1000'); assert.equal(ev('document.documentElement.scrollWidth<=innerWidth'),true,tab+' overflow '+width); }
    if (tab==='cash') run('wait','--fn',"document.querySelectorAll('.expense-donut .recharts-sector').length>0");
    if (['overview','debt','cash'].includes(tab)) run('screenshot',out+'/'+tab+'-reference-desktop.png');
    if(tab==='cash') { assert.equal(ev("document.querySelectorAll('.period-modes button').length"),3); run('screenshot',out+'/money-desktop.png'); }
    if(tab==='opiu') { run('wait','--fn',"document.querySelector('.opiu')?.getAttribute('aria-busy')==='false'"); assert.ok(ev("!!document.querySelector('.opiu-controls')")); run('select','select[aria-label="Блок ОПиУ"]','СКЛАД'); assert.equal(ev("document.querySelector('select[aria-label=\"Блок ОПиУ\"]').value"),'СКЛАД'); report.directionFilter=true; }
    if(tab==='settings') { run('wait','--fn',"document.querySelector('.archive-panel tbody')?.textContent.includes('ОПиУ')"); run('screenshot',out+'/archive-desktop.png');
      ev("window.__archivePosts=[];const old=window.fetch;window.fetch=async(...a)=>{const r=await old(...a);if(a[0]==='/api/archive'&&a[1]?.method==='POST')window.__archivePosts.push(r.status);return r};true");
      run('select','.archive-panel select','opiu');run('find','role','button','click','--name','Создать/обновить архив','--exact');
      run('wait','--fn',"window.__archivePosts?.includes(202)");report.backgroundAction=true;
 }
  }
  stage='responsive';
  ev("document.querySelector('#tab-overview').click();true");
  for(const width of [320,390,768,1440]) {
    run('set','viewport',String(width),'900');
    assert.equal(ev('document.documentElement.scrollWidth<=innerWidth'),true,'overview overflow '+width);
  }
  run('set','viewport','390','844');run('click','.menu-button');
  assert.equal(ev("document.querySelector('.dashboard-sidebar').getAttribute('aria-modal')"),'true');
  run('wait','--fn',"document.querySelector('.dashboard-sidebar').getBoundingClientRect().left===0"); assert.equal(ev("document.querySelector('.dashboard-sidebar').getBoundingClientRect().right<=innerWidth"),true); run('screenshot',out+'/navigation-mobile.png');run('press','Escape');
  assert.equal(ev("document.querySelector('.dashboard-sidebar').classList.contains('is-open')"),false);
  report.responsive=true;
  stage='period-filter';ev("document.querySelector('#tab-cash').click();true");
  run('find','role','button','click','--name','День','--exact');
  run('wait','--fn',"!document.querySelector('.source-note').textContent.includes('Обновляем данные')");
  const values=ev("Array.from(document.querySelectorAll('.dates input')).map(x=>x.value)"); assert.equal(values[0],values[1]);
  report.periodFilter=true;
  report.console=run('errors');
  run('screenshot',out+'/money-mobile.png');
  fs.writeFileSync(out+'/browser-check.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} catch(error) { run('screenshot',out+'/failure.png'); console.error('Browser check failed:',stage, error.message.slice(0,400)); console.error(ev("Array.from(document.querySelectorAll('body *')).filter(e=>e.getBoundingClientRect().right>innerWidth+1 && e.getBoundingClientRect().width>0).map(e=>({tag:e.tagName,cls:e.className,left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right})).slice(0,15)")); process.exitCode=1; }
finally { try { run('close'); } catch {} }
