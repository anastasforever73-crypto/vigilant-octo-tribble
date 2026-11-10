const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const crypto = require('node:crypto');
const originalLoad = Module._load;
Module._load = function (name, parent, main) {
  if (name === 'server-only') return {};
  if (name.startsWith('@/')) name = require('node:path').join(process.cwd(), name.slice(2));
  return originalLoad.call(this, name, parent, main);
};
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const auth = require('../app/lib/auth.ts');
const { NextRequest } = require('next/server');
const hash = password => {
  const salt = crypto.randomBytes(16);
  return `scrypt$32768$8$3$${salt.toString('hex')}$${crypto.scryptSync(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }).toString('hex')}`;
};
const password = '旧🔐&я';
Object.assign(process.env, { AUTH_SECRET: crypto.randomBytes(48).toString('hex'), ADMIN_LOGIN: 'migration-admin', USER_LOGIN: 'migration-viewer', ADMIN_PASSWORD_HASH: hash(password), USER_PASSWORD_HASH: hash(password), DATABASE_URL: '', DASHBOARD_USERS_JSON: '[]', DASHBOARD_USERS_VERCEL_TOKEN: '', VERCEL: '', APP_ORIGIN: '', CODESPACES: 'false' });
const sign = value => crypto.createHmac('sha256', process.env.AUTH_SECRET).update(value).digest('base64url');
function legacyCookie(role, overrides = {}) {
  const payload = Buffer.from(JSON.stringify({ role, exp: Math.floor(Date.now() / 1000) + 3600, nonce: crypto.randomBytes(24).toString('base64url'), version: sign(`${role}:${process.env[`${role.toUpperCase()}_LOGIN`]}:${process.env[`${role.toUpperCase()}_PASSWORD_HASH`]}`), ...overrides })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}
test('existing Timeweb sessions keep their roles without changing secrets or hashes', async () => {
  for (const role of ['admin', 'user']) {
    const cookie = legacyCookie(role);
    const session = await auth.resolveSession(cookie);
    assert.equal(session.role, role);
    assert.equal(session.login, process.env[`${role.toUpperCase()}_LOGIN`]);
    assert.ok(session.sections.includes('overview'));
    assert.equal(await auth.resolveSession(cookie + 'x'), null);
    assert.equal(await auth.resolveSession(legacyCookie(role, { exp: 1 })), null);
  }
});
test('changed credentials and managed account overrides invalidate old sessions', () => {
  const cookie = legacyCookie('user');
  const previous = process.env.USER_PASSWORD_HASH;
  process.env.USER_PASSWORD_HASH = hash('1234');
  assert.equal(auth.verifySession(cookie, []), null);
  process.env.USER_PASSWORD_HASH = previous;
  const managed = { login: process.env.USER_LOGIN, passwordHash: previous, enabled: false, sections: ['debt'] };
  assert.equal(auth.verifySession(cookie, [managed]), null);
  assert.equal(auth.verifySession(cookie, [{ ...managed, enabled: true }]), null);
});
test('legacy four-character passwords work only for original configured accounts', async () => {
  const { POST } = require('../app/api/auth/login/route.ts');
  for (const role of ['admin', 'user']) {
    const response = await POST(new NextRequest('http://localhost:3212/api/auth/login', { method: 'POST', headers: { origin: 'http://localhost:3212', 'content-type': 'application/json' }, body: JSON.stringify({ login: process.env[`${role.toUpperCase()}_LOGIN`], password }) }));
    assert.equal(response.status, 200);
    assert.equal((await auth.resolveSession(response.cookies.get(auth.SESSION_COOKIE).value)).role, role);
  }
  assert.equal(await auth.verifyPassword(password, process.env.USER_PASSWORD_HASH), false);
  assert.equal(auth.isLegacyAccount({ login: process.env.USER_LOGIN, role: 'user', passwordHash: process.env.USER_PASSWORD_HASH }, [{ login: process.env.USER_LOGIN }]), false);
  await assert.rejects(() => auth.hashPin(password));
});
test('pinned HTTPS origin works behind Timeweb proxy and rejects spoofed or foreign hosts', () => {
  const { trustedRequestOrigin } = require('../app/lib/request-origin.ts');
  process.env.APP_ORIGIN = 'https://app.example.test';
  const request = (origin, host = 'app.example.test') => new NextRequest('http://0.0.0.0:3000/api/auth/login', { method: 'POST', headers: { host, origin, 'x-forwarded-host': 'app.example.test', 'x-forwarded-proto': 'https' } });
  assert.equal(trustedRequestOrigin(request('https://app.example.test')), 'https://app.example.test');
  assert.equal(trustedRequestOrigin(request('https://evil.example')), null);
  assert.equal(trustedRequestOrigin(request('https://app.example.test', 'evil.example')), null);
  process.env.APP_ORIGIN = 'https://app.example.test/';
  assert.equal(trustedRequestOrigin(request('https://app.example.test')), null);
  delete process.env.APP_ORIGIN;
});
test('dotenv-escaped legacy hashes retain passwords, roles and canonical sessions', async () => {
  const { POST } = require('../app/api/auth/login/route.ts');
  for (const role of ['admin', 'user']) {
    const key = `${role.toUpperCase()}_PASSWORD_HASH`;
    const original = process.env[key];
    const existing = auth.createSession(role);
    try {
      process.env[key] = original.replace(/\$/g, '\\$');
      assert.equal(auth.authConfigured(), true);
      assert.equal((await auth.resolveSession(existing)).role, role);
      const response = await POST(new NextRequest('http://localhost:3212/api/auth/login', { method: 'POST', headers: { origin: 'http://localhost:3212', 'content-type': 'application/json' }, body: JSON.stringify({ login: process.env[`${role.toUpperCase()}_LOGIN`], password }) }));
      assert.equal(response.status, 200);
      assert.equal((await auth.resolveSession(response.cookies.get(auth.SESSION_COOKIE).value)).role, role);
      process.env[key] = 'invalid\\$hash';
      assert.equal(auth.findAccount(process.env[`${role.toUpperCase()}_LOGIN`]), undefined);
    } finally { process.env[key] = original; }
  }
});
test('production proxy login works without APP_ORIGIN and rejects cross-origin or forwarded-host substitution', async () => {
  const previousMode=process.env.NODE_ENV;
  process.env.NODE_ENV='production';
  delete process.env.APP_ORIGIN;
  const { POST }=require('../app/api/auth/login/route.ts');
  const { trustedRequestOrigin }=require('../app/lib/request-origin.ts');
  const origin='https://dashboard.example.test';
  const request=(supplied=origin,host='dashboard.example.test')=>new NextRequest('http://0.0.0.0:3000/api/auth/login',{method:'POST',headers:{host,origin:supplied,'x-forwarded-host':'dashboard.example.test','x-forwarded-proto':'https','content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({login:process.env.ADMIN_LOGIN,password}).toString()});
  try {
    const accepted=await POST(request());
    assert.equal(accepted.status,303);
    assert.equal(accepted.headers.get('location'),origin+'/');
    assert.ok(accepted.cookies.get(auth.SESSION_COOKIE));
    assert.equal((await POST(request('https://evil.example'))).status,403);
    assert.equal((await POST(request(origin,'evil.example'))).status,403);
    assert.equal(trustedRequestOrigin(request('http://dashboard.example.test')),null);
    process.env.APP_ORIGIN='https://pinned.example.test';
    assert.equal(trustedRequestOrigin(request()),null);
    delete process.env.APP_ORIGIN;
    process.env.NODE_ENV='development';
    assert.equal(trustedRequestOrigin(request()),null);
  } finally {
    if(previousMode===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previousMode;
    delete process.env.APP_ORIGIN;
  }
});
