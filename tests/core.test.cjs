const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const crypto = require('node:crypto');
// Server-only is enforced by Next's bundler; this isolated Node test loads server modules directly.
const originalLoad = Module._load;
Module._load = function(name, parent, main) {
  if (name === 'server-only') return {};
  if (name.startsWith('@/')) name = require('node:path').join(process.cwd(), name.slice(2));
  return originalLoad.call(this, name, parent, main);
};
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const values = require('../app/lib/source-values.ts');
const auth = require('../app/lib/auth.ts');
const sheets = require('../app/lib/google-sheets.ts');
const { buildLive } = require('../app/lib/live-data.ts');
const { fintabloToDashboardData } = require('../app/lib/fintablo-adapter.ts');
const { readFintablo } = require('../app/lib/fintablo.ts');
const hash = password => { const salt=crypto.randomBytes(16); return `scrypt$32768$8$3$${salt.toString('hex')}$${crypto.scryptSync(password,salt,64,{N:32768,r:8,p:3,maxmem:64*1024*1024}).toString('hex')}`; };
process.env.AUTH_SECRET = crypto.randomBytes(48).toString('hex');
process.env.USER_LOGIN = crypto.randomBytes(12).toString('hex');
process.env.ADMIN_LOGIN = crypto.randomBytes(12).toString('hex');
const password = String(crypto.randomInt(0, 10000)).padStart(4, '0');
process.env.USER_PASSWORD_HASH = hash(password);
process.env.ADMIN_PASSWORD_HASH = hash(crypto.randomBytes(32).toString('hex'));
test('password hashes: correct, wrong, malformed and missing config', async () => {
  assert.equal(auth.authConfigured(),true);
  assert.equal(await auth.verifyPassword(password,process.env.USER_PASSWORD_HASH),true);
  assert.equal(await auth.verifyPassword(password+'x',process.env.USER_PASSWORD_HASH),false);
  assert.equal(await auth.verifyPassword(password,'invalid'),false);
});
test('signed sessions reject tampering, expiration and changed credentials', () => {
  const cookie=auth.createSession('user'); assert.equal(auth.verifySession(cookie).role,'user');
  assert.equal(auth.verifySession(cookie+'x'),null);
  const payload=Buffer.from(JSON.stringify({role:'admin',exp:Math.floor(Date.now()/1000)+60})).toString('base64url');
  assert.equal(auth.verifySession(payload+'.'+cookie.split('.')[1]),null);
  const now=Date.now; Date.now=()=>now()+9*60*60*1000;
  try { assert.equal(auth.verifySession(cookie),null); } finally { Date.now=now; }
  const old=process.env.USER_PASSWORD_HASH; process.env.USER_PASSWORD_HASH=hash('another-random-test-password');
  assert.equal(auth.verifySession(cookie),null); process.env.USER_PASSWORD_HASH=old;
});
test('local refresh accepts its exact loopback origin and rejects foreign origins', async () => {
  const { NextRequest } = require('next/server');
  const previous = process.env.NODE_ENV;
  const request = (origin, host = '127.0.0.1:3000') => new NextRequest('http://127.0.0.1:3000/api/dashboard', {method:'POST', headers:{host, origin, cookie:`${auth.SESSION_COOKIE}=${auth.createSession('admin')}`}});
  try {
    process.env.NODE_ENV = 'development';
    assert.equal(await auth.guard(request('http://127.0.0.1:3000'), 'admin'), null);
    for (const origin of ['https://other.example', 'http://127.0.0.1:3001', 'http://localhost:3000', 'null']) assert.equal((await auth.guard(request(origin), 'admin')).status, 403);
    assert.equal((await auth.guard(request('https://other.example', 'other.example'), 'admin')).status, 403);
    process.env.NODE_ENV = 'production';
    assert.equal(await auth.guard(request('http://127.0.0.1:3000'), 'admin'), null);
    assert.equal((await auth.guard(request('http://localhost:3000'), 'admin')).status, 403);
  } finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
});
test('Codespaces origin is pinned to server environment, never to forwarded headers', async () => {
  const { NextRequest } = require('next/server');
  const { trustedRequestOrigin } = require('../app/lib/request-origin.ts');
  const names=['CODESPACES','CODESPACE_NAME','GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN','PORT'];
  const saved=Object.fromEntries(names.map(n=>[n,process.env[n]]));
  Object.assign(process.env,{CODESPACES:'true',CODESPACE_NAME:'test-workspace',GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:'app.github.dev',PORT:'3000'});
  const publicOrigin='https://test-workspace-3000.app.github.dev';
  const request=(origin,headers={})=>new NextRequest('http://127.0.0.1:3000/api/auth/login',{method:'POST',headers:{host:'127.0.0.1:3000',...(origin===undefined?{}:{origin}),...headers}});
  try {
    assert.equal(trustedRequestOrigin(request('http://127.0.0.1:3000')), 'http://127.0.0.1:3000');
    assert.equal(trustedRequestOrigin(request(publicOrigin,{'x-forwarded-host':'test-workspace-3000.app.github.dev','x-forwarded-proto':'https'})),publicOrigin);
    assert.equal(trustedRequestOrigin(request(publicOrigin,{host:'test-workspace-3000.app.github.dev'})),publicOrigin);
    for(const origin of [undefined,'null','https://evil.example','https://other-3000.app.github.dev','https://test-workspace-3001.app.github.dev',publicOrigin+'/',publicOrigin+'@evil.example',publicOrigin+', https://evil.example']) {
      assert.equal(trustedRequestOrigin(request(origin,{'x-forwarded-host':'evil.example','x-forwarded-proto':'https',forwarded:'host=evil.example;proto=https'})),null);
    }
    assert.equal(trustedRequestOrigin(request(publicOrigin,{host:'evil.example'})),null);
    assert.equal(trustedRequestOrigin(request('https://evil.example',{host:'evil.example','x-forwarded-host':'evil.example'})),null);
    process.env.PORT = '3100';
    const portOrigin = 'https://test-workspace-3100.app.github.dev';
    const boundRequest = (origin, host = '127.0.0.1:3100') => new NextRequest('http://0.0.0.0:3100/api/auth/login', {method:'POST',headers:{origin,host,'x-forwarded-host':'evil.example'}});
    assert.equal(trustedRequestOrigin(boundRequest('http://127.0.0.1:3100')), 'http://127.0.0.1:3100');
    assert.equal(trustedRequestOrigin(boundRequest(portOrigin)), portOrigin);
    assert.equal(trustedRequestOrigin(boundRequest(portOrigin, 'test-workspace-3100.app.github.dev')), portOrigin);
    assert.equal(trustedRequestOrigin(boundRequest(publicOrigin)), null);
    assert.equal(trustedRequestOrigin(boundRequest(portOrigin, 'evil.example')), null);
    assert.equal(trustedRequestOrigin(boundRequest('https://evil.example', 'evil.example')), null);
    const proxiedRequest = (origin, forwardedHost = 'test-workspace-3100.app.github.dev') => new NextRequest('https://0.0.0.0:3100/api/auth/login', {method:'POST',headers:{origin,host:'localhost:3100','x-forwarded-host':forwardedHost,'x-forwarded-proto':'https'}});
    assert.equal(trustedRequestOrigin(proxiedRequest('http://localhost:3100')), portOrigin);
    assert.equal(trustedRequestOrigin(proxiedRequest('https://localhost:3100')), portOrigin);
    for (const origin of ['https://evil.example', 'null', publicOrigin, 'http://localhost:3000']) assert.equal(trustedRequestOrigin(proxiedRequest(origin)), null);
    for (const host of ['evil.example', 'test-workspace-3000.app.github.dev', 'test-workspace-3100.app.github.dev, evil.example']) assert.equal(trustedRequestOrigin(proxiedRequest('http://localhost:3100', host)), null);
    const rewrittenForm = await require('../app/api/auth/login/route.ts').POST(new NextRequest('https://0.0.0.0:3100/api/auth/login', {
      method: 'POST', headers: { origin:'http://localhost:3100', host:'localhost:3100', 'x-forwarded-host':'test-workspace-3100.app.github.dev', 'content-type':'application/x-www-form-urlencoded' },
      body: new URLSearchParams({login:process.env.USER_LOGIN,password}).toString(),
    }));
    assert.equal(rewrittenForm.status, 303);
    assert.equal(rewrittenForm.headers.get('location'), portOrigin + '/');
    assert.equal(auth.verifySession(rewrittenForm.cookies.get(auth.SESSION_COOKIE)?.value)?.role, 'user');
    process.env.PORT = '3000';
    const { POST }=require('../app/api/auth/login/route.ts');
    for(const origin of ['http://127.0.0.1:3000',publicOrigin]) for(const native of [false,true]) {
      const body={login:process.env.USER_LOGIN,password};
      const response=await POST(new NextRequest('http://127.0.0.1:3000/api/auth/login',{method:'POST',headers:{origin,host:'127.0.0.1:3000','content-type':native?'application/x-www-form-urlencoded':'application/json'},body:native?new URLSearchParams(body).toString():JSON.stringify(body)}));
      assert.equal(response.status,native?303:200);
      assert.equal(auth.verifySession(response.cookies.get(auth.SESSION_COOKIE)?.value)?.role,'user');
      if(native)assert.equal(response.headers.get('location'),origin+'/');
    }
    process.env.CODESPACES='false';
    assert.equal(trustedRequestOrigin(request(publicOrigin)),null);
  } finally {for(const n of names)if(saved[n]===undefined)delete process.env[n];else process.env[n]=saved[n];}
});
test('dates and numbers: empty, Russian, Sheets serial, invalid', () => {
  assert.equal(values.date('14.09.2026'),'2026-09-14'); assert.equal(values.date(25569),'1970-01-01');
  assert.equal(values.number('1\u00a0234,50'),1234.5); assert.equal(values.number(''),0); assert.equal(values.date(null),'');
  assert.throws(()=>values.date('31.02.2026')); assert.throws(()=>values.number('1oops'));
  assert.throws(()=>values.period(new URLSearchParams('start=2026-09-15&end=2026-09-14')));
});
test('Google IDs, denied access and malformed keys use safe messages', () => {
  assert.equal(sheets.spreadsheetId('https://docs.google.com/spreadsheets/d/real-id/edit'),'real-id');
  assert.throws(()=>sheets.spreadsheetId('https://example.org/a'));
  const error=sheets.safeSheetsError({response:{status:403},message:'PRIVATE-SECRET'});
  assert.equal(error.code,'access_denied'); assert.ok(!error.message.includes('PRIVATE-SECRET'));
  assert.throws(()=>sheets.sheetsClient({googleServiceAccountEmail:'temporary',googlePrivateKey:'bad'}),/неверный формат/);
});
test('period isolation, missing balance, non-duplicated debtor and no fake comparison', () => {
  const order = (date, paymentType) => ({date,order:'order',payer:'',client:'Client',region:'',product:'',qty:1,paymentType,revenue:100,manager:'Manager',department:'',volume:1,paid:70,debt:30,delivery:''});
  const data={source:'test-only',cash:[],orders:[order('2026-09-14','cash'),order('2026-09-14','bank'),order('2026-08-14','bank')],debtor:{total:900},creditor:{factory:300},balances:{},fields:{cash:false,orders:true,balances:false}};
  const live=buildLive(data,'2026-09-14','2026-09-14',true);
  assert.equal(live.revenue,200); assert.equal(live.debtors.length,1); assert.equal(live.debtors[0].value,60);
  assert.equal(live.totalDebt,900); assert.equal(live.balance,undefined); assert.equal(live.incoming,undefined);
  assert.equal(live.revenueDelta,'Нет данных для сравнения'); assert.equal(live.alerts.length,0);
});
test('Fintablo balances retain actual snapshot date instead of selected historical end', () => {
  const data=fintabloToDashboardData({source:'fintablo',updatedAt:'2026-09-14T12:00:00Z',period:{start:'2026-08-01',end:'2026-08-31'},accounts:[],transactions:[]});
  assert.equal(data.balances.date,'2026-09-14');
});
test('Fintablo network failure is sanitized and unsafe destination rejected', async () => {
  await assert.rejects(readFintablo('2026-09-14','2026-09-14',{fintabloBaseUrl:'https://127.0.0.1',fintabloToken:'test-only'}),e=>e.code==='invalid_url');
  const original=global.fetch; global.fetch=async()=>{throw new Error('sensitive-url-token');};
  try {await assert.rejects(readFintablo('2026-09-14','2026-09-14',{fintabloBaseUrl:'https://api.fintablo.ru',fintabloToken:'test-only'}),e=>e.code==='network'&&!e.message.includes('sensitive'));} finally {global.fetch=original;}
});

test('login POST accepts JSON and native forms without reflecting credentials', async () => {
  const { POST } = require('../app/api/auth/login/route.ts');
  const { NextRequest } = require('next/server');
  const origin = 'http://localhost:3100';
  const adminHash = process.env.ADMIN_PASSWORD_HASH;
  process.env.ADMIN_PASSWORD_HASH = hash(password);
  try {
    for (const role of ['user', 'admin']) {
      for (const native of [false, true]) {
        const credentials = { login: process.env[`${role.toUpperCase()}_LOGIN`], password };
        const response = await POST(new NextRequest(origin + '/api/auth/login', {
          method: 'POST', headers: { origin, 'content-type': native ? 'application/x-www-form-urlencoded' : 'application/json' },
          body: native ? new URLSearchParams(credentials).toString() : JSON.stringify(credentials),
        }));
        assert.equal(response.status, native ? 303 : 200);
        assert.equal(auth.verifySession(response.cookies.get(auth.SESSION_COOKIE)?.value)?.role, role);
        assert.match(response.headers.get('cache-control'), /no-store/);
        assert.match(response.headers.get('set-cookie'), /HttpOnly/);
        assert.match(response.headers.get('set-cookie'), /Secure/);
        assert.match(response.headers.get('set-cookie'), /SameSite=strict/i);
        if (native) assert.equal(response.headers.get('location'), origin + '/');
        const output = JSON.stringify([...response.headers]) + await response.text();
        assert.ok(!output.includes(password));
        assert.ok(!output.includes(credentials.login));
      }
    }
    for (const [contentType, body, originHeader, status] of [
      ['application/json', JSON.stringify({ login: process.env.USER_LOGIN, password: 'wrong' }), origin, 401],
      ['application/json', '{', origin, 400],
      ['text/plain', '{}', origin, 415],
      ['application/json', '{}', 'https://elsewhere.example', 403],
      ['application/x-www-form-urlencoded', new URLSearchParams({ login: process.env.USER_LOGIN, password: 'wrong' }).toString(), origin, 303],
    ]) {
      const response = await POST(new NextRequest(origin + '/api/auth/login', { method: 'POST', headers: { origin: originHeader, 'content-type': contentType }, body }));
      assert.equal(response.status, status);
      assert.equal(response.cookies.get(auth.SESSION_COOKIE), undefined);
      if (status === 303) assert.equal(response.headers.get('location'), origin + '/login?error=auth');
    }
    const rejectedQuery = await POST(new NextRequest(origin + '/api/auth/login?password=sentinel', {
      method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ login: process.env.USER_LOGIN, password }),
    }));
    assert.equal(rejectedQuery.status, 400);
    assert.equal(rejectedQuery.cookies.get(auth.SESSION_COOKIE), undefined);
  } finally { process.env.ADMIN_PASSWORD_HASH = adminHash; }
});

test('exactly four ASCII digits, including leading zeros; other passwords rejected even with matching hashes', async () => {
  const { validPassword } = await import('../app/lib/password-policy.mjs');
  for (const value of ['abc', 'abcde', '', '🔐🔐', 'abcd', '🔐я&?', '１２３４', '12345', '123']) {
    assert.equal(validPassword(value), false);
    assert.equal(await auth.verifyPassword(value, hash(value)), false);
  }
  for (const value of [password, '0' + String(crypto.randomInt(0, 1000)).padStart(3, '0')]) {
    assert.equal(validPassword(value), true);
    assert.equal(await auth.verifyPassword(value, hash(value)), true);
  }
});

test('five failures lock the account for 15 minutes, including concurrent requests; success resets failures', async () => {
  delete require.cache[require.resolve('../app/api/auth/login/route.ts')];
  const { POST } = require('../app/api/auth/login/route.ts');
  const { NextRequest } = require('next/server');
  const origin = 'http://localhost:3100';
  const request = (login, value, native = false) => POST(new NextRequest(origin + '/api/auth/login', {
    method: 'POST', headers: { origin, 'content-type': native ? 'application/x-www-form-urlencoded' : 'application/json' },
    body: native ? new URLSearchParams({ login, password: value }).toString() : JSON.stringify({ login, password: value }),
  }));
  const now = Date.now;
  let time = now();
  Date.now = () => time;
  const previousHash = process.env.ADMIN_PASSWORD_HASH;
  process.env.ADMIN_PASSWORD_HASH = hash(password);
  try {
    const badLogin = await request('nonexistent', password);
    const badPassword = await request(process.env.USER_LOGIN, 'bad!');
    assert.equal(badLogin.status, 401);
    assert.equal(badPassword.status, 401);
    assert.deepEqual(await badLogin.json(), await badPassword.json());
    assert.equal((await request(process.env.USER_LOGIN, password)).status, 200);
    // Successful logins must never consume the failure budget.
    for (let i = 0; i < 6; i++) assert.equal((await request(process.env.USER_LOGIN, password)).status, 200);
    for (const role of ['USER', 'ADMIN']) {
      const login = process.env[`${role}_LOGIN`];
      const responses = await Promise.all(Array.from({ length: 6 }, () => request(login, 'bad!')));
      assert.deepEqual(responses.map(r => r.status), [401, 401, 401, 401, 429, 429]);
      assert.equal(responses[4].headers.get('retry-after'), '900');
      for (const response of responses) assert.equal(response.cookies.get(auth.SESSION_COOKIE), undefined);
      assert.equal((await request(login, password)).status, 429);
      if (role === 'USER') assert.equal((await request(process.env.ADMIN_LOGIN, password)).status, 200);
      const native = await request(login, password, true);
      assert.equal(native.status, 303);
      assert.equal(native.headers.get('location'), origin + '/login?error=auth');
      assert.equal(native.cookies.get(auth.SESSION_COOKIE), undefined);
      time += 15 * 60 * 1000 - 1;
      assert.equal((await request(login, password)).status, 429);
      time++;
      assert.equal((await request(login, password)).status, 200);
      for (let i = 0; i < 4; i++) assert.equal((await request(login, 'bad!')).status, 401);
      assert.equal((await request(login, password)).status, 200);
      assert.equal((await request(login, 'bad!')).status, 401);
      assert.equal((await request(login, password)).status, 200);
    }
    // Invalid lengths use the same generic credential error and count as failures.
    for (const value of ['abc', 'abcde']) {
      const result = await request(process.env.USER_LOGIN, value);
      assert.equal(result.status, 401);
      assert.deepEqual(await result.json(), { error: 'Неверный логин или пароль' });
    }
  } finally { Date.now = now; process.env.ADMIN_PASSWORD_HASH = previousHash; }
});

test('connection secrets and snapshots use authenticated encryption bound to their record', () => {
  const { seal, unseal } = require('../app/lib/connections/crypto.ts');
  const previous = process.env.CONNECTIONS_ENCRYPTION_KEY;
  process.env.CONNECTIONS_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
  const secrets = { token: crypto.randomBytes(32).toString('hex'), privateKey: crypto.randomBytes(40).toString('hex') };
  try {
    const sealed = seal(secrets, 'record-one');
    assert.ok(!sealed.includes(secrets.token)); assert.ok(!sealed.includes(secrets.privateKey));
    assert.deepEqual(unseal(sealed, 'record-one'), secrets);
    assert.notEqual(seal(secrets, 'record-one'), sealed);
    assert.throws(() => unseal(sealed, 'record-two'), /расшифровать/);
    const parts = sealed.split('.'); parts[3] = Buffer.alloc(20).toString('base64');
    assert.throws(() => unseal(parts.join('.'), 'record-one'), /расшифровать/);
    process.env.CONNECTIONS_ENCRYPTION_KEY = '';
    assert.throws(() => seal(secrets, 'record-one'), /ключ/);
  } finally { if (previous === undefined) delete process.env.CONNECTIONS_ENCRYPTION_KEY; else process.env.CONNECTIONS_ENCRYPTION_KEY = previous; }
});

test('source assignments require explicit confirmation; URLs cannot retain credentials', () => {
  const { parseConnection } = require('../app/lib/connections/model.ts');
  const base = { name: 'Unit validation only', type: 'googleSheets', enabled: true, config: { spreadsheetId: 'https://docs.google.com/spreadsheets/d/unit-id/edit?unused=discard' }, bindings: [] };
  assert.equal(parseConnection(base).config.spreadsheetId, 'unit-id');
  assert.throws(() => parseConnection({ ...base, config: { baseUrl: 'https://service.example/?token=secret' } }), /без секретов/);
  const binding = { dataset: 'cash', section: 'cash', sheet: 'Unit validation only', headerRow: 1, columns: { date: 0, amount: 1 }, headers: { date: 'Date', amount: 'Amount' }, confirmed: true };
  assert.equal(parseConnection({ ...base, bindings: [binding] }).bindings.length, 1);
  assert.throws(() => parseConnection({ ...base, bindings: [{ ...binding, confirmed: false }] }), /Подтвердите/);
  assert.throws(() => parseConnection({ ...base, bindings: [{ ...binding, headers: {} }] }), /заголов/);
  assert.throws(() => parseConnection({ ...base, bindings: [{ ...binding, section: 'overview' }] }), /не поддерживается/);
  assert.equal(parseConnection({ ...base, bindings: [binding, { ...binding, sheet: 'Second', mode: 'merge' }] }).bindings.length, 2);
  assert.throws(() => parseConnection({ ...base, type: 'invented-api' }), /тип/);
});

test('source composition replaces one dataset and never sums conflicting providers', () => {
  const { composeConnections, sectionData } = require('../app/lib/connections/compose.ts');
  const row = amount => ({ date: '2026-09-15', amount, source: '', counterparty: '', article: '', flow: '' });
  const base = { source: '', cash: [row(10)], orders: [], debtor: {}, creditor: {}, balances: {}, fields: { cash: true, orders: false, balances: false } };
  const connection = { id: 'unit', name: 'Unit', enabled: true, status: 'connected', bindings: [{ section: 'cash', dataset: 'cash' }] };
  const result = composeConnections(base, [connection], new Map([['unit', { cash: [row(20)] }]]));
  assert.equal(sectionData(result, 'cash').cash.reduce((sum, r) => sum + r.amount, 0), 20);
  assert.equal(sectionData(result, 'overview').cash[0].amount, 10);
  assert.equal(base.cash[0].amount, 10);
  assert.equal(composeConnections(base, [connection, { ...connection, id: 'other' }], new Map()).sections.cash.cash[0].amount, 10);
  const disabled = composeConnections(base, [{ ...connection, enabled: false }], new Map([['unit', { cash: [row(20)] }]]));
  assert.deepEqual(sectionData(disabled, 'cash').cash, base.cash);
  assert.equal(sectionData(disabled, 'cash').fields.cash, true);
});

test('all connection management APIs enforce admin role before reading input or storage', async () => {
  const { NextRequest } = require('next/server');
  const origin = 'http://localhost:3100';
  const collection = require('../app/api/connections/route.ts');
  const item = require('../app/api/connections/[id]/route.ts');
  const inspect = require('../app/api/connections/inspect/route.ts');
  const check = require('../app/api/connections/[id]/check/route.ts');
  const sync = require('../app/api/connections/[id]/sync/route.ts');
  const readiness = require('../app/api/connections/readiness/route.ts');
  const routes = [[readiness.GET, 'GET'], [collection.GET, 'GET'], [collection.POST, 'POST'], [item.POST, 'POST'], [item.PATCH, 'PATCH'], [item.DELETE, 'DELETE'], [inspect.POST, 'POST'], [check.POST, 'POST'], [sync.POST, 'POST']];
  for (const role of [null, 'user']) {
    for (const [handler, method] of routes) {
      const request = new NextRequest(origin + '/api/connections', { method, headers: { origin, ...(role ? { cookie: `${auth.SESSION_COOKIE}=${auth.createSession(role)}` } : {}) } });
      assert.equal((await handler(request, { params: Promise.resolve({ id: 'unread' }) })).status, role ? 403 : 401);
    }
  }
  const oldUrl = process.env.DATABASE_URL; delete process.env.DATABASE_URL;
  try {
    const headers = { origin, cookie: `${auth.SESSION_COOKIE}=${auth.createSession('admin')}`, 'content-type': 'application/json' };
    const response = await collection.GET(new NextRequest(origin + '/api/connections', { headers }));
    const result = await response.json(); assert.equal(result.storage.available, false); assert.deepEqual(result.connections, []);
    assert.equal((await collection.POST(new NextRequest(origin + '/api/connections', { method: 'POST', headers, body: '{}' }))).status, 503);
    const crm = await inspect.POST(new NextRequest(origin + '/api/connections/inspect', { method: 'POST', headers, body: JSON.stringify({ name: 'CRM', type: 'crm', enabled: true, config: {}, bindings: [] }) }));
    assert.equal(crm.status, 422); assert.equal((await crm.json()).status, 'adapter_required');
    const foreign = await collection.POST(new NextRequest(origin + '/api/connections', { method: 'POST', headers: { ...headers, origin: 'https://other.example' }, body: '{}' }));
    assert.equal(foreign.status, 403);
  } finally { if (oldUrl !== undefined) process.env.DATABASE_URL = oldUrl; }
});

test('saving source credentials rejects cleared secrets and unsupported Fintablo scopes', () => {
  const { parseConnection, parseSecrets, validateCredentials } = require('../app/lib/connections/model.ts');
  const google = parseConnection({ name: 'Validation only', type: 'googleSheets', enabled: true, config: { spreadsheetId: 'unit-only' }, bindings: [] });
  assert.throws(() => validateCredentials(google, {}), e => e.code === 'credentials_required');
  const saved = { serviceAccountEmail: 'unit@example.invalid', privateKey: 'unit-only-not-a-real-key' };
  assert.doesNotThrow(() => validateCredentials(google, { ...saved, ...parseSecrets({ privateKey: '', serviceAccountEmail: '' }) }));
  const fintablo = parseConnection({ name: 'Validation only', type: 'fintablo', enabled: true, config: {}, bindings: [] });
  assert.throws(() => validateCredentials(fintablo, {}), e => e.code === 'credentials_required');
  assert.doesNotThrow(() => validateCredentials(fintablo, { token: 'unit-only' }));
  assert.throws(() => validateCredentials({ ...fintablo, config: { baseUrl: 'https://example.invalid' } }, { token: 'unit-only' }), e => e.code === 'url');
  assert.throws(() => validateCredentials({ ...fintablo, config: { accountIds: [1] }, bindings: [{ dataset: 'pnl' }] }, { token: 'unit-only' }), e => e.code === 'pnl_scope');
  assert.doesNotThrow(() => validateCredentials({ ...fintablo, type: 'crm' }, {}));
});

test('storage diagnostics distinguish configuration, migration, access and network errors without secrets', () => {
  const { storageConfiguration, storageFailure } = require('../app/lib/connections/storage-health.ts');
  assert.equal(storageConfiguration({}).code, 'configuration_missing');
  const env = { DATABASE_URL: 'postgresql://unit:unit@db.example.invalid/unit', CONNECTIONS_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex') };
  assert.equal(storageConfiguration(env), undefined);
  assert.equal(storageConfiguration({ ...env, DATABASE_URL: 'https://invalid' }).code, 'database_url_invalid');
  assert.equal(storageConfiguration({ ...env, CONNECTIONS_ENCRYPTION_KEY: 'bad' }).code, 'encryption_invalid');
  assert.equal(storageConfiguration({ ...env, AUTH_SECRET: env.CONNECTIONS_ENCRYPTION_KEY }).code, 'encryption_invalid');
  for (const [code, expected] of [['42P01', 'migration_required'], ['42703', 'migration_required'], ['28P01', 'database_auth'], ['42501', 'database_permissions'], ['unknown', 'database_unavailable']]) {
    const status = storageFailure({ code, message: 'SECRET-CONNECTION-STRING', detail: env });
    assert.equal(status.code, expected);
    assert.equal(status.available, false);
    assert.ok(!JSON.stringify(status).includes('SECRET'));
    assert.ok(!JSON.stringify(status).includes(env.DATABASE_URL));
    assert.ok(!JSON.stringify(status).includes(env.CONNECTIONS_ENCRYPTION_KEY));
  }
});

test('saved credential masks reveal no characters and cannot replace secrets', () => {
  const { maskedSecrets, SECRET_MASK, parseSecrets } = require('../app/lib/connections/model.ts');
  assert.deepEqual(maskedSecrets(['token', 'privateKey', 'untrusted']), { token: SECRET_MASK, privateKey: SECRET_MASK });
  assert.deepEqual(maskedSecrets([]), {});
  assert.throws(() => parseSecrets({ token: SECRET_MASK }), /Маску/);
  assert.deepEqual(parseSecrets({ token: '' }), {});
});

test('credentials accept POST bodies only and never URL parameters', async () => {
  const { NextRequest } = require('next/server');
  const { input } = require('../app/lib/connections/http.ts');
  const origin = 'http://localhost:3100';
  const body = JSON.stringify({ secrets: { token: 'isolated-unit-secret' } });
  for (const method of ['PATCH', 'PUT', 'DELETE']) {
    await assert.rejects(input(new NextRequest(origin + '/api/connections/id', { method, headers: { 'content-type': 'application/json' }, body })), e => e.status === 405);
  }
  assert.deepEqual(await input(new NextRequest(origin + '/api/connections/id', { method: 'POST', headers: { 'content-type': 'application/json' }, body })), JSON.parse(body));
  await assert.rejects(input(new NextRequest(origin + '/api/connections/id?token=unit', { method: 'POST', headers: { 'content-type': 'application/json' }, body })), e => e.status === 400);
  const { PATCH } = require('../app/api/connections/[id]/route.ts');
  const response = await PATCH(new NextRequest(origin + '/api/connections/id', { method: 'PATCH', headers: { origin, cookie: `${auth.SESSION_COOKIE}=${auth.createSession('admin')}`, 'content-type': 'application/json' }, body }), { params: Promise.resolve({ id: 'never-read' }) });
  assert.equal(response.status, 405);
  assert.ok(!(await response.text()).includes('isolated-unit-secret'));
});

test('readiness reports missing database and configured key independently', async () => {
  const { storageStatus } = require('../app/lib/connections/store.ts');
  const oldUrl = process.env.DATABASE_URL, oldKey = process.env.CONNECTIONS_ENCRYPTION_KEY;
  delete process.env.DATABASE_URL;
  process.env.CONNECTIONS_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
  try {
    const status = await storageStatus();
    assert.equal(status.available, false);
    assert.deepEqual(status.checks, { database: 'missing', migration: 'unchecked', encryption: 'ready' });
    assert.ok(!JSON.stringify(status).includes(process.env.CONNECTIONS_ENCRYPTION_KEY));
  } finally {
    if (oldUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.CONNECTIONS_ENCRYPTION_KEY; else process.env.CONNECTIONS_ENCRYPTION_KEY = oldKey;
  }
});

test('balance source binding is explicit, separate from cash balances, and respects disabled sources', () => {
  const { parseConnection } = require('../app/lib/connections/model.ts');
  const { composeConnections } = require('../app/lib/connections/compose.ts');
  const binding = { section: 'balance', dataset: 'balanceSheet', sheet: 'Balance', headerRow: 1, confirmed: true, columns: {date:0, category:1, article:2, amount:3}, headers: {date:'Date', category:'Category', article:'Article', amount:'Amount'} };
  const input = parseConnection({ name:'Test fixture', type:'googleSheets', enabled:true, config:{}, bindings:[binding] });
  assert.equal(input.bindings[0].section, 'balance');
  assert.throws(() => parseConnection({...input, bindings:[{...binding, dataset:'balances'}]}));
  assert.throws(() => parseConnection({...input, bindings:[{...binding, confirmed:false}]}));
  const base = {source:'test', cash:[], orders:[], debtor:{}, creditor:{}, balances:{account:99}};
  const connection = {...input, id:'test-balance', revision:1, status:'connected', secretFields:[]};
  const rows = [{date:'2026-09-01', category:'Активы', article:'Тестовая статья', amount:123}];
  const snapshots = new Map([[connection.id,{balanceSheet:rows}]]);
  assert.equal(composeConnections(base, [connection], snapshots).sections.balance.balanceSheet, rows);
  assert.equal(composeConnections(base, [{...connection, enabled:false}], snapshots).sections.balance.balanceSheet, undefined);
  assert.equal(composeConnections(base, [], snapshots).sections.balance, undefined);
});

test('admin-only configuration, individual viewers, revocation, logout and proxy protection', async () => {
  const names = ['AUTH_SECRET', 'ADMIN_LOGIN', 'ADMIN_PASSWORD_HASH', 'USER_LOGIN', 'USER_PASSWORD_HASH', 'DASHBOARD_USERS_JSON'];
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const { NextRequest } = require('next/server');
  const origin = 'http://localhost:3100';
  const makeRequest = (path, body, cookie) => new NextRequest(origin + path, {
    method: body ? 'POST' : 'GET', headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie: `${auth.SESSION_COOKIE}=${cookie}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  delete require.cache[require.resolve('../app/api/auth/login/route.ts')];
  const { POST } = require('../app/api/auth/login/route.ts');
  try {
    for (const name of names) delete process.env[name];
    assert.equal(auth.authConfigured(), false);
    const missing = await POST(makeRequest('/api/auth/login', { login: 'not-configured', password }));
    assert.equal(missing.status, 503);
    assert.match((await missing.json()).error, /Вход ещё не настроен/);
    Object.assign(process.env, { AUTH_SECRET: crypto.randomBytes(48).toString('hex'), ADMIN_LOGIN: crypto.randomBytes(12).toString('hex'), ADMIN_PASSWORD_HASH: hash(password) });
    assert.equal(auth.authConfigured(), true, 'No viewer is required to enable administrator login');
    const admin = await POST(makeRequest('/api/auth/login', { login: process.env.ADMIN_LOGIN, password }));
    assert.equal(admin.status, 200);
    const adminCookie = admin.cookies.get(auth.SESSION_COOKIE).value;
    assert.equal(auth.verifySession(adminCookie).role, 'admin');
    const viewers = Array.from({ length: 2 }, () => ({ login: crypto.randomBytes(12).toString('hex'), passwordHash: hash(password) }));
    process.env.DASHBOARD_USERS_JSON = JSON.stringify(viewers);
    const sessions = [];
    for (const viewer of viewers) {
      const response = await POST(makeRequest('/api/auth/login', { login: viewer.login, password }));
      assert.equal(response.status, 200);
      const cookie = response.cookies.get(auth.SESSION_COOKIE).value;
      assert.equal(auth.verifySession(cookie).login, viewer.login);
      assert.equal(auth.verifySession(cookie).role, 'user');
      assert.equal((await auth.guard(makeRequest('/api/settings', undefined, cookie), 'admin')).status, 403);
      sessions.push(cookie);
    }
    const wrongPin = String((Number(password) + 1) % 10000).padStart(4, '0');
    for (const credentials of [{ login: process.env.ADMIN_LOGIN, password: wrongPin }, { login: 'unknown-login', password }]) {
      const response = await POST(makeRequest('/api/auth/login', credentials));
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: 'Неверный логин или пароль' });
      assert.equal(response.cookies.get(auth.SESSION_COOKIE), undefined);
    }
    const { proxy } = require('../proxy.ts');
    assert.equal((await proxy(makeRequest('/api/dashboard'))).status, 401);
    assert.equal((await proxy(makeRequest('/'))).headers.get('location'), origin + '/login');
    assert.equal((await proxy(makeRequest('/api/dashboard', undefined, adminCookie))).status, 200);
    const logout = await require('../app/api/auth/logout/route.ts').POST(makeRequest('/api/auth/logout', {}, adminCookie));
    assert.equal(logout.status, 200);
    assert.equal(logout.cookies.get(auth.SESSION_COOKIE).value, '');
    assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal((await proxy(makeRequest('/api/dashboard', undefined, logout.cookies.get(auth.SESSION_COOKIE).value))).status, 401);
    process.env.DASHBOARD_USERS_JSON = JSON.stringify(viewers.slice(1));
    assert.equal(auth.verifySession(sessions[0]), null);
    assert.equal(auth.verifySession(sessions[1]).login, viewers[1].login);
    assert.equal(auth.verifySession(adminCookie).role, 'admin');
    process.env.DASHBOARD_USERS_JSON = JSON.stringify([{ ...viewers[1], passwordHash: hash(wrongPin) }]);
    assert.equal(auth.verifySession(sessions[1]), null);
    for (const invalid of ['{', '{}', JSON.stringify([viewers[0], viewers[0]]), JSON.stringify([{ ...viewers[0], login: process.env.ADMIN_LOGIN }]), JSON.stringify([{ ...viewers[0], role: 'admin' }]), JSON.stringify([{ ...viewers[0], passwordHash: 'bad' }])]) {
      process.env.DASHBOARD_USERS_JSON = invalid;
      assert.equal(auth.authConfigured(), true, 'Invalid viewer configuration must not lock out the administrator');
      assert.equal(await auth.resolveSession(sessions[0]), null);
    }
  } finally {
    for (const name of names) if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name];
  }
});

test('debt mapping allows optional direction and marker, reports every missing required action', () => {
  const { parseConnection, bindingIssues } = require('../app/lib/connections/model.ts');
  const b = { section: 'debt', dataset: 'debt', sheet: 'Реестр', headerRow: 1, columns: { category: 0, balance: 1 }, headers: { category: 'Категория', balance: 'Долг' }, confirmed: true };
  const c = { name: 'Test', type: 'googleSheets', enabled: true, config: {}, bindings: [b] };
  assert.doesNotThrow(() => parseConnection(c));
  assert.deepEqual(bindingIssues('googleSheets', b), []);
  const incomplete = { ...b, sheet: '', columns: { category: 0 }, confirmed: false };
  const issues = bindingIssues('googleSheets', incomplete).join('; ');
  assert.match(issues, /Выберите лист/); assert.match(issues, /Остаток долга/); assert.match(issues, /Подтвердите/);
  assert.doesNotMatch(issues, /Направление|Признак/);
  assert.throws(() => parseConnection({ ...c, bindings: [{ ...incomplete, confirmed: true }] }), /Связь 1.*Остаток долга/);
  assert.deepEqual(bindingIssues('fintablo', { ...b, columns: {}, sheet: '/v1/transaction' }), []);
});

test('sheet discovery preserves empty columns and columns beyond ZZ', async () => {
  const { google } = require('googleapis');
  const original = google.sheets;
  const key = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  const settings = { googleSheetId: 'unit-sheet', googleServiceAccountEmail: 'test@example.invalid', googlePrivateKey: key };
  const row = ['Категория', '', 'Долг']; row[702] = 'Последняя';
  google.sheets = () => ({ spreadsheets: {
    get: async () => ({ data: { sheets: [{ properties: { title: 'Реестр', gridProperties: { columnCount: 703 } } }] } }),
    values: { get: async request => { assert.match(request.range, /A1:ZZZ1/); return { data: { values: [row] } }; } },
  } });
  try {
    assert.equal((await sheets.discoverSheets(settings)).sheets[0].title, 'Реестр');
    const result = await sheets.discoverSheets(settings, 'Реестр', 1);
    assert.equal(result.headers.length, 703);
    assert.equal(result.headers[1].index, 1); assert.match(result.headers[1].label, /Без заголовка/);
    assert.equal(result.headers[702].label, 'Последняя');
    await assert.rejects(sheets.discoverSheets(settings, 'Нет листа', 1), /существующий лист/);
  } finally { google.sheets = original; }
});

test('multiple sources: explicit fallback, merge deduplication and detailed conflicts', () => {
  const {resolveValues,mergeRows}=require('../app/lib/connections/merge.ts');
  const {conflictIssues}=require('../app/lib/connections/model.ts');
  const b={section:'cash',dataset:'cash',sheet:'First',headerRow:1,columns:{},confirmed:true};
  const main={binding:{...b,mode:'primary'},value:[{id:'one',amount:100}],name:'FinTablo'};
  const fallback={binding:{...b,mode:'fallback'},value:[{id:'two',amount:200}],name:'Google Sheets'};
  assert.deepEqual(resolveValues([fallback,main]),main.value);
  assert.deepEqual(resolveValues([{...main,value:undefined},fallback]),fallback.value);
  assert.deepEqual(resolveValues([main,fallback].map(e=>({...e,binding:{...b,mode:'merge'}}))),[...main.value,...fallback.value]);
  assert.equal(mergeRows([[{id:1,amount:2}],[{amount:2,id:1}]]).length,1);
  assert.throws(()=>mergeRows([{wallet:1},{wallet:2}]),/только для строк/);
  const c={name:'FinTablo',enabled:true,bindings:[b]};
  assert.match(conflictIssues([c,{...c,name:'Google Sheets'}])[0],/FinTablo.*Google Sheets/);
  assert.equal(conflictIssues([c,{...c,name:'Google Sheets',bindings:[fallback.binding]}]).length,0);
});
test('unavailable saved debt cannot hide live receivables or independently loaded creditors',()=>{
  const {composeConnections}=require('../app/lib/connections/compose.ts');
  const base={cash:[],orders:[],balances:{},debtor:{total:300},creditor:{factory:400},receivables:{current:{totalCents:30000}},sources:{}};
  const c={id:'sheets',name:'Sheets',enabled:true,bindings:[{section:'debt',dataset:'debt'}]};
  const result=composeConnections(base,[c],new Map()).sections.debt;
  assert.equal(result.receivables.current.totalCents,30000);
  assert.equal(result.creditor.factory,400);
});

test('OPiU reads used cells instead of rejecting a large empty allocated grid',async()=>{
  const sheets=require('../app/lib/google-sheets.ts'), settings=require('../app/lib/source-settings.ts');
  const oldClient=sheets.sheetsClient, oldSettings=settings.getSourceSettings;
  const cell=formattedValue=>({formattedValue});
  const grid=[{values:[cell('ОПиУ 2026')]},{},{values:['','ИТОГО','ТРАНЗИТ','СКЛАД'].map(cell)},{values:['','Август','Август','Август'].map(cell)},{},{values:[cell('Выручка'),...Array.from({length:3},()=>({effectiveValue:{numberValue:100},formattedValue:'100'}))]}];
  const ranges=[];
  settings.getSourceSettings=()=>({googleServiceAccountEmail:'fixture',googlePrivateKey:'fixture'});
  sheets.sheetsClient=()=>({spreadsheets:{get:async p=>{
    if(!p.ranges)return {data:{sheets:[{properties:{title:'Анализ ОПИУ ',sheetId:1,gridProperties:{rowCount:1000,columnCount:1000}}}]}};
    ranges.push(...p.ranges);return {data:{sheets:[{data:[{rowData:grid}]}]}};
  },values:{get:async()=>({data:{values:grid.map(r=>(r.values||[]).map(c=>c.formattedValue))}})}}});
  try {const r=await require('../app/lib/read-opiu.ts').readOpiu();assert.equal(r.rows.length,1);assert.deepEqual(ranges,["'Анализ ОПИУ '!A1:D6"]);}
  finally{sheets.sheetsClient=oldClient;settings.getSourceSettings=oldSettings;}
});
