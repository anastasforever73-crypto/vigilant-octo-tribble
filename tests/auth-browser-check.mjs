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
const base = process.env.MART_TEST_BASE_URL || 'http://localhost:3100';
const browserEnv = { ...process.env, AGENT_BROWSER_DEFAULT_TIMEOUT: '60000' };
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
const production = process.env.MART_TEST_PRODUCTION === '1';
const authOnly = process.env.MART_TEST_AUTH_ONLY === '1';
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
const artifactDir = process.env.MART_TEST_ARTIFACTS_DIR || 'artifacts/verification';
let browserSession = `auth-post-check-${randomBytes(6).toString('hex')}`;
const run = (...args) => {
  try { return execFileSync(binary, ['--session', browserSession, ...args], { encoding: 'utf8', timeout: 90000, env: browserEnv, stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch { throw new Error('Browser command failed: ' + args.slice(0, 3).join(' ')); }
};
const evaluate = code => {
  let result;
  try { result = JSON.parse(execFileSync(binary, ['--session', browserSession, 'eval', '--stdin', '--json'], { input: code, encoding: 'utf8', timeout: 90000, env: browserEnv, stdio: ['pipe', 'pipe', 'pipe'] })); }
  catch { throw new Error('Browser evaluation failed at stage: ' + report.at(-1)); }
  assert.equal(result.success, true);
  return result.data.result;
};
const openMenu = () => {
  run('click', '.menu-button');
  run('wait', '--fn', "document.querySelector('aside').getAnimations().every(a => a.playState === 'finished')");
};
const pass = message => { report.push(message); console.log('PASS', message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 1000));
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error('Local server exited');
    if (logs.includes('Syntax error:') || logs.includes('Module not found')) throw new Error('Local page compilation failed');
    try { if ((await fetch(base + '/login')).ok) { ready = true; break; } } catch {}
    await pause();
  }
  assert.ok(ready, 'Local server ready');
  run('open', base + '/login');
  run('wait', '--load', 'networkidle');
  assert.match(run('snapshot', '-i'), /Логин/);
  assert.equal(evaluate("Boolean(document.querySelector('[data-nextjs-dialog]'))"), false);
  mkdirSync(artifactDir, { recursive: true });
  run('screenshot', join(artifactDir, 'auth-login.png'));
  for (const width of [320,375,390,430,768,1440]) {
    run('set', 'viewport', String(width), '700');
    assert.equal(evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'Login fits ' + width);
  }
  pass('Login page renders without error overlay and fits all six widths');
  const get = await fetch(base + '/api/auth/login');
  assert.equal(get.status, 405);
  assert.equal(get.headers.get('set-cookie'), null);
  pass('GET login returns 405 and creates no session');
  assert.equal((await fetch(base + '/login')).headers.get('referrer-policy'), 'strict-origin');
  for (const native of [false, true]) {
    if (native) {
      run('close');
      browserSession += '-native';
      browserEnv.AGENT_BROWSER_ARGS = [browserEnv.AGENT_BROWSER_ARGS, '--blink-settings=scriptEnabled=false'].filter(Boolean).join(',');
      run('open', 'about:blank');
    }
    for (const role of ['user', 'admin']) {
      run('cookies', 'clear');
      run('open', base + '/login');
      run('wait', '--load', 'networkidle');
      if (!native) run('wait', '--fn', "Boolean(document.querySelector('form')?.[Object.keys(document.querySelector('form')).find(k=>k.startsWith('__reactProps'))]?.onSubmit)");
      evaluate('sessionStorage.clear()');
      assert.equal(evaluate("document.querySelector('form').method"), 'post');
      assert.equal(evaluate("document.querySelector('form').getAttribute('action')"), '/api/auth/login');
      if (native) assert.equal(evaluate("Boolean(document.querySelector('form')[Object.keys(document.querySelector('form')).find(k=>k.startsWith('__reactProps'))]?.onSubmit)"), false);
      const submit = password => {
        evaluate(`(() => { const c = ${JSON.stringify({ login: credentials[role].login, password })}; for (const name of ['login', 'password']) { const input = document.querySelector('input[name="'+name+'"]'); input.value = c[name]; input.dispatchEvent(new Event('input', {bubbles:true})); } return true; })()`);
        run('click', 'form button');
      };
      for (const value of ['abc', 'abcde']) {
        assert.equal(evaluate(`(() => { const input = document.querySelector('input[name=password]'); input.value = ${JSON.stringify(value)}; return input.checkValidity(); })()`), false);
      }
      submit(String((Number(credentials[role].password) + 1) % 10000).padStart(4, '0'));
      run('wait', '--text', native ? 'Не удалось войти.' : 'Неверный логин или пароль');
      assert.equal(new URL(evaluate('location.href')).pathname, '/login');
      assert.equal(evaluate("document.querySelector('input[name=password]').value"), '');
      pass(`${role}, ${native ? 'scripts blocked' : 'JavaScript'}: wrong password rejected`);
      submit(credentials[role].password);
      run('wait', '--fn', "location.pathname === '/' && document.querySelector('nav') !== null");
      assert.equal(evaluate('location.href'), base + '/');
      assert.equal(evaluate("document.cookie.includes('mart_trade_session')"), false);
      run('wait', '--load', 'networkidle');
      const statuses = {
        dashboard: evaluate("(async () => (await fetch('/api/dashboard')).status)()"),
        settings: evaluate("(async () => (await fetch('/api/settings')).status)()"),
      };
      assert.equal(statuses.dashboard, 200);
      assert.equal(statuses.settings, role === 'admin' ? 200 : 403);
      pass(`${role}, ${native ? 'scripts blocked' : 'JavaScript'}: login, clean URL, HttpOnly session, role permissions`);
      if (!native && !authOnly) {
        const tabIds = ['overview', 'cash', 'opiu', 'balance', 'debt', 'sales', 'goods', 'logistics', ...(role === 'admin' ? ['settings'] : [])];
        const groupIds = ['cash', 'sales', 'goods', ...(role === 'admin' ? ['settings'] : [])];
        for (const id of groupIds) {
          run('click', '#nav-' + id + '-toggle');
          assert.equal(evaluate(`document.querySelector('#nav-${id}-toggle').getAttribute('aria-expanded')`), 'true');
          run('click', '#nav-' + id + '-toggle');
          assert.equal(evaluate(`document.querySelector('#nav-${id}-items').hidden`), true);
          run('click', '#nav-' + id + '-toggle');
        }
        assert.deepEqual(evaluate("Array.from(document.querySelectorAll('#nav-cash-items a')).map(a => a.textContent)"), ['ДДС', 'ОПиУ', 'Баланс', 'Расчёты и обязательства']);
        assert.equal(evaluate("new Set(Array.from(document.querySelectorAll('nav a')).map(a => a.href)).size === document.querySelectorAll('nav a').length"), true);
        const selectedDate = evaluate("document.querySelector('input[type=date]').value");
        for (const width of [320, 375, 390, 430, 768, 1440]) {
          run('set', 'viewport', String(width), '900');
          for (const tab of tabIds) {
            if (width <= 750) openMenu();
            run('click', '#tab-' + tab);
            run('wait', '--fn', `document.querySelector('#tab-${tab}').getAttribute('aria-current') === 'page'`);
            assert.equal(evaluate(`document.querySelector('#tab-${tab}').getAttribute('aria-current')`), 'page', `${tab}/${width}`);
            assert.equal(evaluate("document.querySelectorAll('[role=tabpanel]:not([hidden])').length"), 1);
            assert.equal(evaluate("document.querySelector('input[type=date]').value"), selectedDate);
            assert.equal(evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, `Overflow: ${role}/${tab}/${width}`);
            if (width <= 750) assert.equal(evaluate("document.querySelector('aside').getClientRects().length"), 0);
          }
          if (width <= 750) {
            assert.equal(evaluate("Array.from(document.querySelectorAll('.period-arrow')).every(button => button.getBoundingClientRect().width >= 44 && button.getBoundingClientRect().height >= 44)"), true);
            openMenu(); evaluate(`document.querySelector('.nav-backdrop').click()`);
            assert.equal(evaluate("document.querySelector('aside').getClientRects().length"), 0);
            openMenu(); run('press', 'Escape');
            assert.equal(evaluate("document.querySelector('aside').getClientRects().length"), 0);
          }
          if (width <= 750) openMenu();
          run('click', '#tab-overview');
          run('click', '.operational-cards button:first-child');
          assert.equal(evaluate("document.querySelector('.modal article').getBoundingClientRect().bottom <= innerHeight"), true);
          assert.equal(evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
          run('click', '.modal .close');
          run('screenshot', `artifacts/verification/mobile-${role}-${width}.png`);
        }
        run('click', '#tab-balance');
        assert.equal(new URL(evaluate('location.href')).pathname, '/balance');
        run('set', 'viewport', '375', '700');
        openMenu();
        run('set', 'viewport', '1440', '900');
        run('wait', '--fn', "!document.querySelector('.workspace').inert");
        assert.equal(evaluate("document.body.style.overflow"), '');
        assert.equal(evaluate("document.querySelector('.nav-backdrop') === null"), true);
        run('open', base + '/?tab=balance');
        run('wait', '--load', 'networkidle');
        assert.equal(new URL(evaluate('location.href')).pathname, '/balance');
        run('reload'); run('wait', '--load', 'networkidle');
        assert.equal(evaluate("document.querySelector('#nav-cash-toggle').getAttribute('aria-expanded')"), 'true');
        assert.ok(evaluate("document.querySelector('#panel-balance').textContent.includes('Источник баланса не подключён')"));
        // Empty/error fixtures stay in this browser and never connect a source.
        evaluate(`(() => { const original = window.fetch; window.__balanceState = 'pending'; window.fetch = (url, options) => {
          if (!String(url).startsWith('/api/dashboard')) return original(url, options);
          if (window.__balanceState === 'pending') return new Promise(() => {});
          const data = {source:'',cash:[],orders:[],debtor:{},creditor:{},balances:{}};
          if (window.__balanceState === 'unavailable') data.sections = {balance:{}};
          if (window.__balanceState === 'empty') data.sections = {balance:{balanceSheet:[]}};
          return Promise.resolve(new Response(JSON.stringify(data), {status:window.__balanceState === 'error' ? 503 : 200}));
        }; return true; })()`);
        for (const [index, [state, title]] of [
          ['pending', 'Загружаем баланс'], ['unavailable', 'Данные баланса недоступны'],
          ['empty', 'Нет данных на выбранную дату'], ['error', 'Баланс временно недоступен'],
        ].entries()) {
          evaluate(`(() => { window.__balanceState = ${JSON.stringify(state)}; const input = document.querySelector('.dates input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '2026-01-0${index + 1}'); input.dispatchEvent(new Event('input', {bubbles:true})); input.dispatchEvent(new Event('change', {bubbles:true})); return true; })()`);
          run('wait', '--fn', `document.querySelector('#panel-balance').textContent.includes(${JSON.stringify(title)})`);
          assert.equal(evaluate("document.querySelector('#panel-balance table') === null"), true);
        }
        run('reload'); run('wait', '--load', 'networkidle');
        pass(`${role}: balance loading, unavailable source, empty snapshot and request failure remain distinct without invented figures`);
        run('click', '#nav-goods-toggle');
        run('click', '#tab-overview');
        assert.equal(evaluate("document.querySelector('#nav-goods-toggle').getAttribute('aria-expanded')"), 'false');
        run('back'); run('wait', '--load', 'networkidle');
        assert.equal(evaluate("document.querySelector('#panel-balance').hidden"), false);
        pass(`${role}: all tabs, four group toggles, persistence, /balance reload/back, drawer dismissal, no page overflow at 320/375/390/430/768/1440`);
        if (role === 'admin') run('click', '#tab-settings');
        const overview = evaluate("document.querySelector('#panel-overview').textContent");
        assert.ok(!/денежный поток|поступления|выплаты|Сбор средств|Операционные расходы|Операционный остаток|Остаток денежных средств|дебитор|кредитор|задолж/i.test(overview));
        const cash = evaluate("document.querySelector('#panel-cash').textContent");
        for (const label of ['Поступления', 'Выплаты', 'Чистый поток', 'Денежный поток', 'Структура денежных средств', 'Детализация движения денег']) assert.ok(cash.includes(label));
        const groups = evaluate("Array.from(document.querySelectorAll('.nav-group-title')).map(e=>e.textContent)");
        assert.deepEqual(groups, ['Финансы', 'Продажи', 'Товары', ...(role === 'admin' ? ['Администрирование'] : [])]);
        pass(`${role}: grouped navigation, all tabs, date preservation, cash and debt isolated`);
        if (role === 'user') {
          run('open', base + '/?tab=settings');
          run('wait', '--load', 'networkidle');
          assert.equal(evaluate("document.querySelector('#panel-settings') === null"), true);
          assert.equal(evaluate("document.querySelector('#tab-overview').getAttribute('aria-current')"), 'page');
          assert.equal(evaluate("document.querySelectorAll('#panel-settings input, #panel-settings textarea, #panel-settings button, #panel-settings select').length"), 0);
          assert.equal(evaluate("(async () => (await fetch('/api/connections')).status)()"), 403);
          for (const [path, method] of [['/api/connections','POST'], ['/api/connections/inspect','POST'], ['/api/connections/unknown','POST'], ['/api/connections/unknown','PATCH'], ['/api/connections/unknown','DELETE'], ['/api/connections/unknown/check','POST'], ['/api/connections/unknown/sync','POST']]) {
            assert.equal(evaluate(`(async () => (await fetch(${JSON.stringify(path)}, {method:${JSON.stringify(method)}, headers:{'Content-Type':'application/json'}, body:'{}'})).status)()`), 403);
          }
          pass('user: no management controls, all source mutations forbidden');
        } else {
          run('wait', '--text', 'Требуется первоначальная настройка хранилища');
          assert.equal(evaluate("document.querySelectorAll('.source-editor').length"), 0);
          assert.equal(evaluate("Array.from(document.querySelectorAll('#panel-settings button')).some(b=>b.textContent==='Добавить подключение')"), false);
          assert.equal(evaluate("document.querySelectorAll('.readiness-checks li').length"), 3);
          const readiness = evaluate("(async () => (await (await fetch('/api/connections/readiness')).json()))()");
          assert.equal(readiness.available, false);
          assert.equal(readiness.checks.database, 'missing');
          assert.equal(readiness.checks.migration, 'unchecked');
          run('find', 'role', 'button', 'click', '--name', 'Проверить готовность системы');
          run('wait', '--text', 'Требуется первоначальная настройка хранилища');
          pass('admin: initial setup message, three readiness checks, retry, no unusable source form');
          run('screenshot', 'artifacts/verification/admin-connections.png');
          // Browser-only readiness fixture exposes the editor without configuring a real database or source.
          evaluate(`(() => { const original = window.fetch; window.fetch = (url, options) => {
            if (String(url) === '/api/connections/readiness') return Promise.resolve(new Response(JSON.stringify({available:true,message:'UI test fixture',checks:{database:'ready',migration:'ready',encryption:'ready'}})));
            if (String(url) === '/api/connections' && !options?.method?.match(/POST|DELETE|PATCH/)) return Promise.resolve(new Response(JSON.stringify({storage:{available:true,message:'UI test fixture'},connections:[]})));
            return original(url, options);
          }; return true; })()`);
          run('find', 'role', 'button', 'click', '--name', 'Проверить готовность системы');
          run('wait', '--text', 'Добавить подключение');
          run('find', 'role', 'button', 'click', '--name', 'Добавить подключение');
          run('find', 'role', 'button', 'click', '--name', 'Добавить связь с разделом');
          run('select', '.binding-editor label:first-of-type select', 'balanceSheet');
          assert.equal(evaluate("document.querySelectorAll('.binding-editor select')[1].value"), 'balance');
          for (const width of [320,375,390,430,768,1440]) {
            run('set','viewport',String(width),'700');
            assert.equal(evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'Source form fits ' + width);
          }
          pass('admin: source editor and balance mapping fit all six widths (browser-only readiness fixture; no source saved)');
        }
        run('click', '#tab-overview');
        run('screenshot', `artifacts/verification/${role}-operational.png`);
        assert.equal(evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true);
      }

      const network = run('network', 'requests');
      for (const c of Object.values(credentials)) {
        assert.ok(!network.includes(c.login), 'Login absent from request URLs');
        assert.ok(!network.includes(c.password), 'Password absent from request URLs');
      }
      assert.match(network, /POST.*\/api\/auth\/login/);
      assert.ok(!/GET\s+\S*\/api\/auth\/login/.test(network));
      if (!native) assert.equal(run('errors').trim(), '');
      assert.equal(evaluate("(async () => (await fetch('/api/auth/logout', {method:'POST'})).status)()"), 200);
      assert.equal(evaluate("(async () => (await fetch('/api/dashboard')).status)()"), 401);
      pass(`${role}, ${native ? 'scripts blocked' : 'JavaScript'}: logout revokes access`);
    }
  }
  await pause();
  for (const c of Object.values(credentials)) {
    for (const value of [c.login, c.password, encodeURIComponent(c.password)]) assert.ok(!logs.includes(value), 'Credentials absent from server logs');
  }
  assert.ok(!/\?(?:login|password)=/.test(logs));
  pass('Exact four-digit PINs accepted; three and five rejected by form');
  pass('Credentials absent from browser request URLs and local server logs');
  writeFileSync(join(artifactDir, `${authOnly ? 'auth-focused-report' : 'auth-post-report'}.json`), JSON.stringify({ date: new Date().toISOString(), scope: authOnly ? 'authentication' : 'authentication and dashboard', credentials: 'temporary; existing .env.local unchanged', passed: report }, null, 2));
} catch (error) {
  await pause();
  let message = error instanceof Error ? error.message : 'Authentication verification failed';
  try { message += '\nPage: ' + run('get', 'text', 'body'); } catch {}
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
