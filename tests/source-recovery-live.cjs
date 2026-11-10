// Explicit read-only live verification; credentials and sessions are never printed.
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
require('@next/env').loadEnvConfig(process.cwd());
const load = Module._load;
Module._load = function(name, parent, main) { return name === 'server-only' ? {} : load.call(this, name, parent, main); };
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const binary = process.env.AGENT_BROWSER_BIN;
if (!binary) throw new Error('Set AGENT_BROWSER_BIN');
const session = 'dz-live-' + randomBytes(8).toString('hex');
const env = { ...process.env, AGENT_BROWSER_DEFAULT_TIMEOUT: '60000' };
const options = { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 90000, env };
const run = (...args) => execFileSync(binary, ['--session', session, ...args], options);
const evaluate = code => JSON.parse(execFileSync(binary, ['--session', session, 'eval', '--stdin', '--json'], { ...options, input: code })).data.result;
const base = process.env.RECOVERY_BASE_URL || 'http://127.0.0.1:3101';
const report = {};
let stage='open';
try {
 const {createSession}=require('../app/lib/auth.ts');
 run('open',base+'/login');
 evaluate(`document.cookie=${JSON.stringify('mart_trade_session='+createSession('admin')+'; Path=/; SameSite=Strict')};true`);
 run('open',base+'/?tab=debt');
 run('wait','--fn',"document.querySelector('.receivables')?.getAttribute('aria-busy') === 'false'");
 stage='refresh';
 evaluate(`(() => {const original=window.fetch;window.__reads=[];window.fetch=async(...args)=>{const response=await original(...args);if(String(args[0]).startsWith('/api/dashboard')){window.__data=await response.clone().json();window.__reads.push(response.status)}return response};return true})()`);
 run('find','role','button','click','--name','Обновить данные','--exact');
 run('wait','--fn',"window.__reads.length>0 && document.querySelector('.receivables').getAttribute('aria-busy')==='false'");
 const summary=evaluate(`(() => {const d=window.__data; return {status:window.__reads[0],total:d.receivables.current?.totalCents,top:document.querySelectorAll('.scroll[aria-label^="ТОП"] tbody tr').length,cash:d.sections?.cash?.cash.length,debtErrors:d.receivables.errors,connected:Object.values(d.sources).filter(s=>s.status==='connected').map(s=>s.name),payablesAlert:document.querySelector('.debt-cards .connection-alert')?.textContent,updatedAt:d.receivables.updatedAt}})()`);
 assert.equal(summary.status,200);assert.ok(summary.total>0);assert.equal(summary.top,10);assert.ok(summary.cash>0);assert.deepEqual(summary.debtErrors,{});assert.ok(summary.updatedAt);
 report.summary=summary;
 stage='save both existing connections';
 if(process.env.RECOVERY_SAVE_CHECK==='1') {
 const saved=evaluate(`(async()=>{const list=await (await fetch('/api/connections')).json();const chosen=list.connections.filter(c=>c.enabled&&['fintablo','debt'].includes(c.type));const results=[];for(const c of chosen){const r=await fetch('/api/connections/'+c.id,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...c,secrets:{}})});const v=await r.json();results.push({type:c.type,status:r.status,before:c.bindings.length,after:v.connection?.bindings.length})}return results})()`);
 assert.equal(saved.length,2);for(const r of saved){assert.equal(r.status,200);assert.equal(r.before,r.after)}report.saves=saved;
 }
 stage='responsive layout';
 for(const width of [390,1440]){run('set','viewport',String(width),'900');assert.equal(evaluate('document.documentElement.scrollWidth <= innerWidth'),true);}
 run('screenshot','artifacts/source-recovery/dashboard.png');
 stage='source panel';run('open',base+'/?tab=settings');run('wait','--text','Управление подключениями');
 const ui=evaluate(`({conflict:document.body.textContent.includes('Один показатель раздела не может иметь две связи'),fin:document.body.textContent.includes('ФИНТАБЛО'),google:document.body.textContent.includes('Google Sheets — дебиторка / кредиторка')})`);
 assert.equal(ui.conflict,false);assert.ok(ui.fin&&ui.google);report.ui=ui;
 stage='production OPIU';run('open',base+'/?tab=opiu');run('wait','--fn',"document.querySelector('.opiu')?.getAttribute('aria-busy') === 'false'");
 const opiu=evaluate(`({rows:document.querySelectorAll('.opiu tbody tr').length,error:document.querySelector('.opiu-error')?.textContent})`);assert.ok(opiu.rows>0);assert.ok(!opiu.error);report.opiu=opiu;
 report.browserErrors=run('errors').trim();
 fs.writeFileSync('artifacts/source-recovery/browser-results.json',JSON.stringify(report,null,2));console.log('PASS',JSON.stringify(report));
} catch {console.error('Browser verification failed:',stage);process.exitCode=1;}
finally{try{run('cookies','clear');run('close')}catch{}}
