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
const base = 'http://127.0.0.1:3000';
const report = { date: new Date().toISOString(), roles: {} };
let stage = 'start';
try {
  const { createSession } = require('../app/lib/auth.ts');
  for (const role of ['admin', 'user']) {
    stage = role + ': open';
    run('open', base + '/login');
    // Local session stays in browser memory and is removed at the end; no credential output.
    evaluate(`document.cookie=${JSON.stringify('mart_trade_session=' + createSession(role) + '; Path=/; SameSite=Strict')}; true`);
    run('open', base + '/?tab=debt');
    run('wait', '--fn', "document.querySelector('.receivables')?.getAttribute('aria-busy') === 'false'");
    evaluate(`(() => { const original = window.fetch; window.__dzReads = []; window.fetch = async (...args) => {
      const response = await original(...args);
      if (String(args[0]).startsWith('/api/dashboard')) { window.__dzPayload = await response.clone().json(); window.__dzReads.push({method:args[1]?.method,status:response.status}); }
      return response;
    }; return true; })()`);
    stage = role + ': live refresh';
    run('find', 'role', 'button', 'click', '--name', 'Обновить данные', '--exact');
    run('wait', '--fn', "window.__dzReads.length === 1 && document.querySelector('.receivables').getAttribute('aria-busy') === 'false'");
    const summary = evaluate(`(() => {
      const r = window.__dzPayload.receivables, c = r.current;
      const money = n => (n/100).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₽';
      const shown = Array.from(document.querySelectorAll('.receivables .debt-cards .mini b')).map(b => b.textContent);
      const amounts = [c?.totalCents,c?.bySource.Транзит?.totalCents,c?.bySource.Склад?.totalCents,c?.advancesCents];
      return {asOf:r.asOf,week:r.week,request:window.__dzReads[0],partial:c?.partial,totalCents:c?.totalCents,sourceTotals:Object.fromEntries(Object.entries(c?.bySource || {}).map(([k,v])=>[r.sourceSheets[k],v.totalCents])),
        uiMatches:amounts.every((v,i)=>v!==undefined&&money(v)===shown[i]),
        sourceSumMatches:c?.totalCents===Object.values(c?.bySource || {}).reduce((s,v)=>s+v.totalCents,0),
        categorySumMatches:c?.totalCents===Object.values(c?.categories || {}).reduce((s,v)=>s+v,0),
        excludedCount:Object.values(r.sources).reduce((s,v)=>s+v.excludedRows.length,0),
        warning:document.querySelector('.receivables').textContent.includes('Расчёт с предупреждениями'),
        errors:r.errors};
    })()`);
    assert.equal(summary.request.status, 200);
    assert.equal(summary.request.method, role === 'admin' ? 'POST' : 'GET');
    assert.equal(summary.partial, false);
    assert.equal(summary.uiMatches, true); assert.equal(summary.sourceSumMatches, true); assert.equal(summary.categorySumMatches, true);
    assert.equal(summary.warning, summary.excludedCount > 0);
    assert.deepEqual(summary.errors, {});
    stage = role + ': excluded rows';
    const exclusionSelector = '.scroll[aria-label="Исключённые строки"]';
    assert.equal(evaluate(`document.querySelector(${JSON.stringify(exclusionSelector)}).closest('.panel').querySelector('.tools>span').textContent`), summary.excludedCount + ' строк');
    run('fill', 'input[aria-label="Поиск: Исключённые строки"]', 'Нет даты УПД');
    assert.equal(evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(exclusionSelector + ' tbody tr')})).every(r=>r.textContent.includes('Нет даты УПД'))`), true);
    run('fill', 'input[aria-label="Поиск: Исключённые строки"]', '');
    run('click', exclusionSelector + ' + .settings-actions button:last-child');
    assert.equal(evaluate(`document.querySelector(${JSON.stringify(exclusionSelector)}).closest('.panel').textContent.includes('Страница 2 из')`), true);
    for (const width of [320, 375, 390, 430, 768, 1440]) {
      run('set', 'viewport', String(width), '900');
      assert.equal(evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'Page overflow ' + width);
      assert.equal(evaluate(`(() => {const t=document.querySelector(${JSON.stringify(exclusionSelector)});return t.scrollWidth > t.clientWidth ? getComputedStyle(t).overflowX==='auto' : true;})()`), true);
    }
    if (role === 'admin') {
      run('screenshot', 'artifacts/verification/dz-live-desktop.png');
      run('set', 'viewport', '390', '900');
      run('screenshot', 'artifacts/verification/dz-live-mobile.png');
      stage = 'browser-only missing sheet fixture';
      evaluate(`(() => {const original=window.fetch;window.fetch=(url,options)=>{
        if (!String(url).startsWith('/api/dashboard')) return original(url,options);
        const data=structuredClone(window.__dzPayload),r=data.receivables,c=r.current,s=r.sources.Транзит;
        delete r.sources.Склад;delete c.bySource.Склад;c.partial=true;c.totalCents=s.totalCents;c.categories=s.categories;c.advancesCents=s.advancesCents;c.details=c.details.filter(d=>d.source==='Транзит');r.errors.Склад='Тест недоступного листа';
        return Promise.resolve(new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}}));
      };return true;})()`);
      run('find', 'role', 'button', 'click', '--name', 'Обновить данные', '--exact');
      run('wait', '--text', 'Частичный результат: рассчитаны только доступные листы.');
      assert.equal(evaluate("document.querySelectorAll('.receivables .debt-cards .mini b')[2].textContent"), 'Нет данных');
      assert.equal(evaluate("document.querySelector('.receivables .debt-cards .mini span').textContent"), 'ДЗ по доступным листам (частично)');
      summary.partialFixturePassed = true;
    }
    report.roles[role] = summary;
    console.log('PASS', role, JSON.stringify(summary));
    run('cookies', 'clear');
  }
  fs.writeFileSync('artifacts/verification/receivables-live-ui.json', JSON.stringify(report, null, 2));
} catch {
  console.error('Live browser verification failed at stage: ' + stage);
  process.exitCode = 1;
} finally {
  try { run('cookies', 'clear'); run('close'); } catch {}
}
