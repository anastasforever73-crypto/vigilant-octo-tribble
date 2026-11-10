import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, randomInt, scryptSync } from 'node:crypto';
import { mkdirSync, writeFileSync, mkdtempSync, cpSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

// Disposable credentials exist only in memory and in the isolated server environment.
// Never dump command arguments, request bodies, cookies, or raw errors on failure.
const binary = process.env.AGENT_BROWSER_BIN;
if (!binary) throw new Error('Set AGENT_BROWSER_BIN to an installed agent-browser executable');
const base = 'http://localhost:3100';
const browserEnv = { ...process.env, AGENT_BROWSER_DEFAULT_TIMEOUT: '20000' };
const credentials = Object.fromEntries(['user', 'admin'].map(role => [role, { login: randomBytes(16).toString('hex'), password: String(randomInt(0, 10000)).padStart(4, '0') }]));
const hash = password => {
  const salt = randomBytes(16);
  return `scrypt$32768$8$3$${salt.toString('hex')}$${scryptSync(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }).toString('hex')}`;
};
const env = { ...process.env, AUTH_SECRET: randomBytes(48).toString('hex'), DATABASE_URL: '', CONNECTIONS_ENCRYPTION_KEY: '', GOOGLE_SHEETS_ENABLED: 'false', FINTABLO_ENABLED: 'false', DEBT_ENABLED: 'false' };
for (const role of ['user', 'admin']) {
  env[`${role.toUpperCase()}_LOGIN`] = credentials[role].login;
  // Next's dotenv expansion also processes inherited values when .env.local is present.
  env[`${role.toUpperCase()}_PASSWORD_HASH`] = hash(credentials[role].password).replaceAll('$', '\\$');
}
// A separate process uses temporary credentials, never the user's running dev server.
const production = true;
const checkRoot = production ? process.cwd() : mkdtempSync(join(tmpdir(), 'mart-ui-verification-'));
if (!production) {
  for (const name of ['app', 'public', 'proxy.ts', 'package.json', 'tsconfig.json', 'next.config.ts', 'next-env.d.ts', 'postcss.config.mjs', 'shadcn-tailwind-4.13.0.css']) cpSync(join(process.cwd(), name), join(checkRoot, name), { recursive: true });
  symlinkSync(join(process.cwd(), 'node_modules'), join(checkRoot, 'node_modules'), 'dir');
  writeFileSync(join(checkRoot, '.env.local'), 'USER_PASSWORD_HASH=\nADMIN_PASSWORD_HASH=\n', { mode: 0o600 });
}
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', production ? 'start' : 'dev', ...(!production ? ['--webpack'] : []), '--hostname', '127.0.0.1', '--port', '3100'], { cwd: checkRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '';
server.stdout.on('data', chunk => { logs += chunk; });
server.stderr.on('data', chunk => { logs += chunk; });
const report = [];
let browserSession = `auth-post-check-${randomBytes(6).toString('hex')}`;
const run = (...args) => {
  try { return execFileSync(binary, ['--session', browserSession, ...args], { encoding: 'utf8', timeout: 30000, env: browserEnv, stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch { throw new Error('Browser command failed: ' + args.slice(0, 3).join(' ')); }
};
const evaluate = code => {
  let result;
  try { result = JSON.parse(execFileSync(binary, ['--session', browserSession, 'eval', '--stdin', '--json'], { input: code, encoding: 'utf8', timeout: 30000, env: browserEnv, stdio: ['pipe', 'pipe', 'pipe'] })); }
  catch { throw new Error('Browser evaluation failed at stage: ' + report.at(-1)); }
  assert.equal(result.success, true);
  return result.data.result;
};
const setDate = (selector, value) => {
  evaluate(`(() => {const input=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
};
const pass = message => { report.push(message); console.log('PASS', message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 1000));

const categoryValues={Текущая:10000,Просроченная:0,Сомнительная:50000,Безнадежная:5000};
const details=[{source:'Транзит',key:'Тестовый получатель с очень длинным наименованием для проверки мобильной таблицы',date:'2026-03-02',age:200,category:'Безнадежная',balanceCents:5000,row:20},{source:'Транзит',key:'Тестовый получатель',date:'2026-09-18',age:0,category:'Текущая',balanceCents:10000,row:21},{source:'Склад',key:'Тестовое направление',date:'2026-08-09',age:40,category:'Сомнительная',balanceCents:50000,row:10}];
const bySource={Транзит:{source:'Транзит',asOf:'2026-09-18',totalCents:15000,advancesCents:0,categories:{Текущая:10000,Просроченная:0,Сомнительная:0,Безнадежная:5000},details:details.slice(0,2),weeklyShipmentCents:20000,complete:true,diagnostics:[{source:'Транзит',reason:'Исключено: будущая дата отгрузки',count:1,amountCents:10000,unknownAmounts:0,rows:[22]}]},Склад:{source:'Склад',asOf:'2026-09-18',totalCents:50000,advancesCents:-3000,categories:{Текущая:0,Просроченная:0,Сомнительная:50000,Безнадежная:0},details:details.slice(2),weeklyShipmentCents:30000,complete:true,diagnostics:[]}};
const current={asOf:'2026-09-18',updatedAt:'2026-09-18T12:00:00Z',historical:false,totalCents:65000,advancesCents:-3000,categories:categoryValues,bySource,details};
const fixture={source:'browser-fixture',cash:[],orders:[],debtor:{},creditor:{},balances:{},sources:{},receivables:{asOf:'2026-09-18',updatedAt:current.updatedAt,week:{start:'2026-09-07',end:'2026-09-13'},current,sources:bySource,errors:{},archive:{status:'available',diagnostics:[],snapshots:[{...current,asOf:'2026-09-11',historical:true,details:null},{...current,asOf:'2026-09-14',historical:true,details:null}]}}};
try {
  let ready = false;
  for (let i=0;i<60;i++) { try { if ((await fetch(base+'/login')).ok) {ready=true;break;} } catch {} await pause(); }
  assert.ok(ready);
  mkdirSync('artifacts/verification',{recursive:true});
  for (const role of ['user','admin']) {
    run('open',base+'/login'); run('wait','--load','networkidle');
    evaluate(`(() => {const c=${JSON.stringify(credentials[role])}; for(const name of ['login','password']) document.querySelector('input[name="'+name+'"]').value=c[name]; return true;})()`);
    run('click','form button'); run('wait','--fn',"location.pathname === '/' && document.querySelector('nav') !== null");
    run('wait','--load','networkidle');
    if(evaluate("document.querySelector('#nav-cash-toggle').getAttribute('aria-expanded')") !== 'true') run('click','#nav-cash-toggle');
    run('click','#tab-debt');
    run('wait','--text','Полный итог ДЗ не подтверждён');
    assert.equal(evaluate("document.querySelector('.receivables .debt-cards').textContent.includes('0,00')"),false);
    pass(role+': missing source is not zero debt');
    evaluate(`(() => {const original=window.fetch; window.__debtFixture=${JSON.stringify(fixture)};window.__debtReads=0;window.__debtFail=false;window.fetch=(url,options)=>{
      if(String(url).startsWith('/api/dashboard')) { window.__debtReads++; return Promise.resolve(new Response(JSON.stringify(window.__debtFail ? {error:'Тестовая ошибка чтения'} : window.__debtFixture),{status:window.__debtFail?503:200,headers:{'Content-Type':'application/json'}})); }
      return original(url,options);
    };return true;})()`);
    run('find','role','button','click','--name','Обновить данные','--exact');
    run('wait','--text','650,00');
    assert.ok(evaluate("document.querySelector('.receivables').textContent.includes('50,00')"));
    assert.ok(evaluate("document.querySelector('.receivables').textContent.includes('-30,00')"));
    assert.ok(evaluate("document.querySelector('.receivables').textContent.includes('Исключено: будущая дата')"));
    for(const width of [320,375,390,430,768,1440]) {
      run('set','viewport',String(width),'900');
      run('wait','--fn',"document.documentElement.scrollWidth <= innerWidth && Array.from(document.querySelectorAll('.receivables .recharts-wrapper')).every(el=>el.getBoundingClientRect().right <= innerWidth)");
      assert.equal(evaluate('document.documentElement.scrollWidth <= innerWidth'),true,'Debt overflow '+width);
      assert.equal(evaluate("Array.from(document.querySelectorAll('.receivables .recharts-wrapper')).every(el=>el.getBoundingClientRect().right <= innerWidth)"),true);
      run('screenshot',`artifacts/verification/receivables-${role}-${width}.png`,'--full');
    }
    // A period outside the debt ages must not hide old unpaid shipments.
    setDate('.dates label:first-of-type input','2026-09-17');
    run('wait','--fn',"document.querySelector('.period-summary').textContent.includes('17 сент.')");
    run('wait','--text','650,00');
    assert.ok(evaluate("document.querySelector('.receivables').textContent.includes('Безнадежная')"));
    const reads=evaluate('window.__debtReads');
    evaluate(`(() => {const report=window.__debtFixture.receivables;report.current.totalCents=70000;report.current.categories.Безнадежная=10000;report.current.bySource.Транзит.totalCents=20000;report.current.bySource.Транзит.categories.Безнадежная=10000;report.current.details[0].balanceCents=10000;report.sources.Транзит.totalCents=20000;return true;})()`);
    run('find','role','button','click','--name','Обновить данные','--exact'); run('wait','--text','700,00');
    assert.ok(evaluate('window.__debtReads')>reads);
    setDate('.debt-date-controls input','2026-09-11');
    run('wait','--text','Исторический ТОП недоступен');
    setDate('.debt-date-controls input','2026-09-10');run('wait','--text','За выбранную дату нет полного подтверждённого снимка');
    assert.equal(evaluate("document.querySelector('.receivables .debt-cards').textContent.includes('700,00')"),false);
    run('find','role','button','click','--name','Сегодня по Москве');
    evaluate('window.__debtFail=true');run('find','role','button','click','--name','Обновить данные','--exact');run('wait','--text','Обновление не выполнено');
    assert.equal(evaluate("document.querySelector('.receivables').textContent.includes('700,00')"),false);
    assert.equal(run('errors').trim(),'');
    pass(role+': shared totals, categories, advances, archive missing date/no historic TOP, refresh and error states; responsive six widths');
    run('find','role','button','click','--name','Выйти','--exact');run('wait','--url','**/login');
    pass(role+': logout button redirects to login');
  }
  writeFileSync('artifacts/verification/receivables-browser-report.json',JSON.stringify({date:new Date().toISOString(),fixture:'browser-only; no real source written',passed:report},null,2));
} catch (error) {
  await pause();
  let message = error instanceof Error ? error.message : 'Authentication verification failed';
  // Avoid a second long browser call after a timeout; the stage and server status are sufficient.
  message += '\nServer: ' + logs;
  for (const c of Object.values(credentials)) {
    for (const value of [c.login, c.password, encodeURIComponent(c.password)]) message = message.replaceAll(value, '[REDACTED]');
  }
  console.error('FAIL', message);
  process.exitCode = 1;
} finally {
  try { run('close'); } catch {}
  server.kill('SIGTERM');
  if (server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); setTimeout(resolve, 5000); });
  if (!production) rmSync(checkRoot, { recursive: true, force: true });
}
