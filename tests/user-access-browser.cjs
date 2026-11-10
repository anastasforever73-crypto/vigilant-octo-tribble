// Isolated browser fixtures: no deployed users, source credentials or database writes.
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const binary = process.env.AGENT_BROWSER_BIN;
if (!binary) throw Error('AGENT_BROWSER_BIN is required');
const pin = String(crypto.randomInt(10000)).padStart(4, '0');
const salt = crypto.randomBytes(16);
const hash = `scrypt$32768$8$3$${salt.toString('hex')}$${crypto.scryptSync(pin, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }).toString('hex')}`;
const admin = crypto.randomUUID(), user = crypto.randomUUID();
// Skip local dotenv expansion so isolated scrypt hashes are not interpolated as env references.
const env = { ...process.env, __NEXT_PROCESSED_ENV: 'true', AUTH_SECRET: crypto.randomBytes(48).toString('hex'), ADMIN_LOGIN: admin, ADMIN_PASSWORD_HASH: hash,
  USER_LOGIN: '', USER_PASSWORD_HASH: '', DASHBOARD_USERS_JSON: JSON.stringify([{ login: user, passwordHash: hash, enabled: true, sections: ['debt', 'opiu'] }]),
  DATABASE_URL: '', GOOGLE_SERVICE_ACCOUNT_EMAIL: '', GOOGLE_PRIVATE_KEY: '', FINTABLO_API_TOKEN: '', FINTABLO_ENABLED: 'false', GOOGLE_SHEETS_ENABLED: 'false', DEBT_ENABLED: 'false',
  DASHBOARD_USERS_VERCEL_TOKEN: '', DASHBOARD_USERS_ENV_ID: '', VERCEL: '', PORT: '3104' };
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3104'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
const options = { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 65000 };
const run = (...args) => execFileSync(binary, ['--session', 'user-access-test', ...args], options);
const evaluate = code => JSON.parse(execFileSync(binary, ['--session', 'user-access-test', 'eval', '--stdin', '--json'], { ...options, input: code })).data.result;
let stage = 'server';
(async () => {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('startup timeout')), 15000);
    server.once('exit', () => { clearTimeout(timeout); reject(Error('startup failed')); });
    server.stdout.on('data', chunk => { if (chunk.toString().includes('Ready')) { clearTimeout(timeout); resolve(); } });
  });
  for (const [role, login] of [['admin', admin], ['user', user]]) {
    stage = role + ' login';
    run('open', 'http://127.0.0.1:3104/login');
    run('fill', 'input[name=login]', login);
    run('fill', 'input[name=password]', pin);
    stage = role + ' submit';
    run('find', 'role', 'button', 'click', '--name', 'Войти', '--exact');
    stage = role + ' session redirect';
    run('wait', role === 'admin' ? '#panel-overview .key-indicators' : '#panel-debt .receivables');
    if (role === 'admin') {
      assert.equal(evaluate("document.querySelector('#tab-settings')!==null && document.querySelector('#tab-users')!==null"), true);
      evaluate("document.querySelector('#tab-users').click();true");
      run('wait', '.admin-users');
      // Mock only the browser response to exercise the editor; actual route CRUD is covered in user-access.test.cjs.
      evaluate(`window.__realFetch=window.fetch;window.__userWrites=[];window.fetch=async (...args)=>args[0]==='/api/users'?new Response(JSON.stringify({users:[],version:'isolated-version',writable:true}),{headers:{'Content-Type':'application/json'}}):window.__realFetch(...args);document.querySelector('#tab-overview').click();true`);
      evaluate("document.querySelector('#tab-users').click();true");
      run('wait', '--fn', "!Array.from(document.querySelectorAll('.admin-users button')).find(b=>b.textContent.includes('Создать пользователя'))?.disabled");
      run('find', 'role', 'button', 'click', '--name', 'Создать пользователя', '--exact');
      assert.equal(evaluate("document.querySelector('.user-form input[type=password]').value"), '');
      assert.equal(evaluate("document.querySelectorAll('.user-sections input').length"), 8);
      for (const width of [1440, 390]) {
        run('set', 'viewport', String(width), '1000');
        assert.equal(evaluate('document.documentElement.scrollWidth<=innerWidth'), true);
        run('screenshot', `/tmp/user-editor-${width}.png`);
      }
      run('find', 'role', 'button', 'click', '--name', 'Отмена', '--exact');
      evaluate('window.fetch=window.__realFetch;true');
    } else {
      stage = 'viewer permissions';
      assert.equal(evaluate("new URLSearchParams(location.search).get('tab')"), 'debt');
      assert.equal(evaluate("document.querySelector('#tab-overview')===null && document.querySelector('#panel-overview')===null"), true);
      assert.equal(evaluate("document.querySelector('#tab-settings')===null && document.querySelector('#tab-users')===null && document.querySelector('#tab-cash')===null && document.querySelector('#panel-cash')===null"), true);
      assert.equal(evaluate("Array.from(document.querySelectorAll('button')).some(b=>/Сохранить|Обновить данные|Проверить подключение|Добавить связь|Удалить|Отключить/.test(b.textContent))"), false);
      evaluate("document.querySelector('#tab-debt').click();true");
      assert.equal(evaluate("document.querySelector('#panel-debt').hidden"), false);
      assert.equal(evaluate("document.querySelector('#nav-cash-items').hidden"), false, 'Filtered finance group opens correctly');
      for (const width of [1440, 390]) {
        run('set', 'viewport', String(width), '1000');
        assert.equal(evaluate('document.documentElement.scrollWidth<=innerWidth'), true);
        run('screenshot', `/tmp/user-view-${width}.png`);
      }
      for (const path of ['/settings', '/?tab=settings', '/api/settings', '/api/users', '/api/connections', '/api/fintablo', '/api/google-sheets', '/balance']) assert.equal(evaluate(`(async()=> (await fetch(${JSON.stringify(path)})).status)()`), 403, path);
      assert.equal(evaluate("(async()=> (await fetch('/api/dashboard',{method:'POST'})).status)()"), 403);
    }
    stage = role + ' logout';
    run('find', 'role', 'button', 'click', '--name', 'Выйти', '--exact');
    run('wait', 'input[name=login]');
    assert.equal(evaluate("(async()=> (await fetch('/api/dashboard')).status)()"), 401);
    console.log(`PASS ${role}: PIN login, permissions, desktop/mobile, logout`);
  }
  console.log(run('errors'));
})().catch(() => { console.error('Browser verification failed at: ' + stage); try { console.error(evaluate("JSON.stringify({path:location.pathname,alert:document.querySelector('[role=alert]')?.textContent})")); } catch {} process.exitCode = 1; }).finally(async () => {
  try { run('close'); } catch {}
  server.kill('SIGTERM');
  await new Promise(resolve => { if (server.exitCode !== null) resolve(); else server.once('exit', resolve); });
});
