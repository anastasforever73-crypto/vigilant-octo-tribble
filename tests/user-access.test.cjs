const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const crypto = require('node:crypto');
const ts = require('typescript');
const load = Module._load;
let locked = false, attempts = 0, registryRaw = '[]', registryRevision = 'initial', registryOffline = false, registryWrites = 0;
const sql = async (strings, ...values) => {
  const query = strings.join('');
  if (query.includes('mart_user_registry')) {
    if (registryOffline) throw Error('offline');
    if (query.includes('SELECT')) return [{ value: registryRaw, revision: registryRevision }];
    if (query.includes('UPDATE')) {
      if (values[2] !== registryRevision) return [];
      registryRaw = values[0]; registryRevision = values[1]; registryWrites++;
      return [{ revision: registryRevision }];
    }
  }
  if (query.includes('INSERT INTO mart_user_write_lock')) { if (locked) return []; locked = true; return [{ token: true }]; }
  if (query.includes('DELETE FROM mart_user_write_lock')) { locked = false; return []; }
  if (query.includes('INSERT INTO mart_login_attempts')) return [{ attempts: ++attempts, expires_at: new Date(Date.now() + 900000).toISOString() }];
  if (query.includes('DELETE FROM mart_login_attempts')) { attempts = 0; return []; }
  throw Error('Unexpected SQL');
};
Module._load = function(name, parent, main) {
  if (name === 'server-only') return {};
  if (name === '@neondatabase/serverless') return { neon: () => sql };
  if (name.startsWith('@/')) name = process.cwd() + '/' + name.slice(2);
  return load.call(this, name, parent, main);
};
require.extensions['.ts'] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const auth = require('../app/lib/auth.ts');
const registry = require('../app/lib/user-registry.ts');
const { NextRequest } = require('next/server');
const { proxy } = require('../proxy.ts');
const origin = 'http://localhost:3100';
const request = (path, cookie, method = 'GET', body, requestOrigin = origin) => new NextRequest(origin + path, { method, headers: { origin: requestOrigin, 'content-type': 'application/json', ...(cookie ? { cookie: `${auth.SESSION_COOKIE}=${cookie}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

test('roles, PIN login/logout, immediate revocation, direct URLs, API boundaries and registry CRUD', async () => {
  // These credentials exist only in this process, never in any deployed environment.
  const saved = { ...process.env }, originalFetch = global.fetch;
  const pin = String(crypto.randomInt(10000)).padStart(4, '0');
  const adminLogin = crypto.randomUUID(), viewerLogin = crypto.randomUUID();
  registryRaw = '[]'; registryRevision = 'initial'; registryWrites = 0; registryOffline = false;
  try {
    for (const key of ['DATABASE_URL', 'VERCEL', 'USER_LOGIN', 'USER_PASSWORD_HASH', 'DASHBOARD_USERS_VERCEL_TOKEN', 'DASHBOARD_USERS_ENV_ID']) delete process.env[key];
    Object.assign(process.env, { AUTH_SECRET: crypto.randomBytes(48).toString('hex'), ADMIN_LOGIN: adminLogin, ADMIN_PASSWORD_HASH: await auth.hashPin(pin), DASHBOARD_USERS_JSON: '[]' });
    const login = require('../app/api/auth/login/route.ts').POST;
    const logout = require('../app/api/auth/logout/route.ts').POST;
    const admin = await login(request('/api/auth/login', null, 'POST', { login: adminLogin, password: pin }));
    assert.equal(admin.status, 200);
    const adminCookie = admin.cookies.get(auth.SESSION_COOKIE).value;
    Object.assign(process.env, { DASHBOARD_USERS_VERCEL_TOKEN: 'isolated-token', DASHBOARD_USERS_PROJECT_ID: 'isolated-project', DASHBOARD_USERS_TEAM_ID: 'isolated-team', DASHBOARD_USERS_ENV_ID: 'isolated-env', DATABASE_URL: 'mock-only' });
    global.fetch = async () => { throw Error('User management must not call Vercel'); };
    const users = require('../app/api/users/route.ts');
    const initial = await (await users.GET(request('/api/users', adminCookie))).json();
    const body = { action: 'create', login: viewerLogin, pin, enabled: true, sections: ['overview', 'debt'], version: initial.version };
    assert.equal((await users.POST(request('/api/users', adminCookie, 'POST', body, 'https://evil.invalid'))).status, 403);
    assert.equal((await users.POST(request('/api/users', adminCookie, 'POST', { ...body, role: 'admin' }))).status, 422);
    const created = await users.POST(request('/api/users', adminCookie, 'POST', body));
    assert.equal(created.status, 200);
    let publicState = await created.json();
    assert.deepEqual(Object.keys(publicState.users[0]).sort(), ['enabled', 'login', 'sections']);
    assert.equal(JSON.parse(registryRaw)[0].pin, undefined);
    assert.ok(registry.validHash(JSON.parse(registryRaw)[0].passwordHash));
    const fullPassword = 'test-' + crypto.randomUUID();
    const passwordUpdate = await users.POST(request('/api/users', adminCookie, 'POST', { ...body, action: 'update', originalLogin: viewerLogin, pin: fullPassword, version: publicState.version }));
    assert.equal(passwordUpdate.status, 200);
    publicState = await passwordUpdate.json();
    assert.equal(await auth.verifyPassword(fullPassword, JSON.parse(registryRaw)[0].passwordHash), true);
    assert.equal(await auth.verifyPassword(pin, JSON.parse(registryRaw)[0].passwordHash), false);
    const user = await login(request('/api/auth/login', null, 'POST', { login: viewerLogin, password: fullPassword }));
    assert.equal(user.status, 200);
    const userCookie = user.cookies.get(auth.SESSION_COOKIE).value;
    assert.deepEqual((await auth.resolveSession(userCookie)).sections, ['overview', 'debt']);
    for (const path of ['/settings', '/sources', '/?tab=settings', '/?tab=users', '/?tab=cash', '/balance', '/api/settings', '/api/users', '/api/connections', '/api/fintablo', '/api/google-sheets', '/api/opiu']) assert.equal((await proxy(request(path, userCookie))).status, 403, path);
    assert.equal((await proxy(request('/?tab=debt', userCookie))).status, 200);
    assert.equal((await proxy(request('/api/dashboard', userCookie, 'POST', {}))).status, 403);
    for (const [file, methods] of [
      ['settings', ['GET', 'POST']], ['users', ['GET', 'POST']], ['connections', ['GET', 'POST']], ['connections/inspect', ['POST']], ['connections/readiness', ['GET']],
      ['connections/[id]', ['POST', 'DELETE']], ['connections/[id]/check', ['POST']], ['connections/[id]/sync', ['POST']], ['sources/check', ['POST']], ['debt-metadata', ['POST']], ['fintablo', ['GET']], ['google-sheets', ['GET']], ['dashboard', ['POST']], ['opiu', ['GET']],
    ]) for (const method of methods) {
      const route = require(`../app/api/${file}/route.ts`);
      assert.equal((await route[method](request('/api/' + file, userCookie, method, method === 'GET' ? undefined : {}), { params: Promise.resolve({ id: 'unused' }) })).status, 403, file + ' ' + method);
    }
    assert.equal(registryWrites, 2, 'Viewer requests must not mutate the registry');
    assert.equal((await users.POST(request('/api/users', adminCookie, 'POST', body))).status, 409, 'Stale revisions rejected');
    const change = { ...body, action: 'update', originalLogin: viewerLogin, pin: '', enabled: false, version: publicState.version };
    publicState = await (await users.POST(request('/api/users', adminCookie, 'POST', change))).json();
    assert.equal(await auth.resolveSession(userCookie), null);
    assert.equal((await login(request('/api/auth/login', null, 'POST', { login: viewerLogin, password: fullPassword }))).status, 401);
    const enabled = await users.POST(request('/api/users', adminCookie, 'POST', { ...change, enabled: true, sections: ['cash'], version: publicState.version }));
    assert.equal(enabled.status, 200);
    assert.equal(await auth.resolveSession(userCookie), null, 'Re-enabling does not revive old sessions');
    const newLogin = await login(request('/api/auth/login', null, 'POST', { login: viewerLogin, password: fullPassword }));
    const nextCookie = newLogin.cookies.get(auth.SESSION_COOKIE).value;
    assert.deepEqual((await auth.resolveSession(nextCookie)).sections, ['cash']);
    registryOffline = true;
    assert.equal(await auth.resolveSession(nextCookie), null, 'No stale runtime env fallback');
    assert.equal((await auth.resolveSession(adminCookie)).role, 'admin', 'Admin remains available during registry outage');
    registryOffline = false;
    for (const cookie of [adminCookie, nextCookie]) {
      const response = await logout(request('/api/auth/logout', cookie, 'POST', {}));
      assert.equal(response.status, 200);
      assert.equal(response.cookies.get(auth.SESSION_COOKIE).value, '');
      assert.equal((await proxy(request('/api/dashboard', ''))).status, 401);
    }
    attempts = 5;
    assert.equal((await login(request('/api/auth/login', null, 'POST', { login: viewerLogin, password: fullPassword }))).status, 429, 'Shared limiter blocks across instances');
  } finally {
    global.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

test('API projection removes denied sections, nested fallbacks and raw source metadata', () => {
  const { visibleDashboard } = require('../app/lib/dashboard-access.ts');
  const base = { source: 'private-source', cash: [], orders: [{ secret: 'sales-only' }], balances: { account: 12 }, creditor: { total: 2 }, debtor: {}, sources: { key: { name: 'private-source-config' } }, operational: { day: '2026-09-22' }, receivables: { total: 9 }, sections: { balance: { balanceSheet: [{ amount: 77 }] } } };
  const visible = visibleDashboard(base, { role: 'user', sections: ['overview'] });
  assert.equal(visible.operational, base.operational);
  assert.equal(visible.receivables, undefined);
  assert.deepEqual(visible.orders, []);
  assert.deepEqual(Object.keys(visible.sections), ['overview']);
  assert.doesNotMatch(JSON.stringify(visible), /sales-only|private-source|balanceSheet/);
  assert.equal(visibleDashboard(base, { role: 'admin', sections: [] }), base);
});

test('viewer dashboard reads never record or synchronize saved connections; admin behavior is retained', async () => {
  const store = require('../app/lib/connections/store.ts');
  const sync = require('../app/lib/connections/sync.ts');
  const originals = { listConnections: store.listConnections, snapshots: store.snapshots, recordSync: store.recordSync, syncConnection: sync.syncConnection, database: process.env.DATABASE_URL };
  let writes = 0;
  try {
    process.env.DATABASE_URL = 'mock-only';
    store.listConnections = async () => [
      { id: 'debt', type: 'debt', name: 'debt', enabled: true, bindings: [] },
      { id: 'cash', type: 'fintablo', name: 'cash', enabled: true, bindings: [{ section: 'cash', dataset: 'cash', sheet: 'cash', mode: 'primary' }] },
    ];
    store.snapshots = async () => new Map();
    store.recordSync = async () => { writes++; };
    sync.syncConnection = async () => { writes++; };
    const { withConnections } = require('../app/lib/connections/dashboard.ts');
    const data = { source: '', sources: {}, cash: [], orders: [], debtor: {}, creditor: {}, balances: {} };
    await withConnections(data, '2026-09-01', '2026-09-22', false, true);
    assert.equal(writes, 0);
    await withConnections(data, '2026-09-01', '2026-09-22');
    assert.equal(writes, 2);
  } finally {
    Object.assign(store, { listConnections: originals.listConnections, snapshots: originals.snapshots, recordSync: originals.recordSync });
    sync.syncConnection = originals.syncConnection;
    if (originals.database === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originals.database;
  }
});
