/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const crypto = require('node:crypto');
const rows = new Map();
let revision = 1, sourceContent = 'v1', unavailable = false, failWrite = false;
const sql = async (strings, ...v) => {
  if (unavailable) throw new Error('offline');
  const q = strings.join('?');
  if (q.includes('FROM mart_connections')) return [{ id: 'test', revision, enabled: true }];
  if (q.includes('FROM mart_source_snapshots')) return [{ connection_id: 'test', content_hash: sourceContent }];
  if (q.includes('FROM mart_source_input_archive')) return [];
  if (q.startsWith('SELECT archive_key')) return rows.has(v[0]) ? [{ ...rows.get(v[0]), has_payload: Boolean(rows.get(v[0]).payload) }] : [];
  if (q.startsWith('SELECT *')) return rows.has(v[0]) ? [{ ...rows.get(v[0]) }] : [];
  if (q.startsWith('INSERT')) {
    const [key, kind, start, end, token] = v;
    const old = rows.get(key);
    if (old?.lease_until && Date.parse(old.lease_until) > Date.now()) return [];
    rows.set(key, { ...old, archive_key: key, kind, period_start: start, period_end: end, lease_token: token, lease_until: new Date(Date.now() + 240000).toISOString(), last_error: null });
    return [{ archive_key: key }];
  }
  if (q.includes('SET source_version=')) {
    const [source_version, source_probe, data_hash, key, token] = v;
    const row = rows.get(key);
    if (row.lease_token !== token || Date.parse(row.lease_until) < Date.now()) return [];
    Object.assign(row, { source_version, source_probe: JSON.parse(source_probe), data_hash, verified_at: new Date().toISOString(), lease_token: null, lease_until: null, last_error: null });
    return [{ created_at: row.created_at, observed_at: row.observed_at, verified_at: row.verified_at }];
  }
  if (q.includes('SET payload=')) {
    if (failWrite) throw new Error('write failure');
    const [payload, schema_version, source_version, calculation_version, source_probe, data_hash, observed_at, key, token] = v;
    const row = rows.get(key);
    if (row.lease_token !== token || Date.parse(row.lease_until) < Date.now()) return [];
    Object.assign(row, { payload, schema_version, source_version, calculation_version, source_probe: JSON.parse(source_probe), data_hash, observed_at, created_at: new Date().toISOString(), last_error: null, lease_token: null, lease_until: null });
    return [{ created_at: row.created_at }];
  }
  if (q.includes('SET last_error=')) {
    const [message, key, token] = v;
    const row = rows.get(key);
    if (row?.lease_token === token) Object.assign(row, { last_error: message, lease_token: null, lease_until: null });
    return [];
  }
  throw new Error('Unexpected SQL');
};
const originalLoad = Module._load;
Module._load = function(name, parent, main) {
  if (name === 'server-only') return {};
  if (name.endsWith('/postgres') || name.endsWith('/lib/postgres.cjs')) return { postgres: () => sql };
  if (name.startsWith('@/')) name = require('node:path').join(process.cwd(), name.slice(2));
  return originalLoad.call(this, name, parent, main);
};
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
process.env.DATABASE_URL = 'test-only';
process.env.CONNECTIONS_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
const archive = require('../app/lib/period-archive.ts');
const { visibleDashboard } = require('../app/lib/dashboard-access.ts');
const { buildLive } = require('../app/lib/live-data.ts');
const { canView } = require('../app/lib/user-access.ts');
const params = { start: '2026-01-01', end: '2026-01-31', comparisonStart: '2025-12-01' };
let amount = 100, reads = 0;
const spec = { kind: 'dashboard', ...params, complete: d => Boolean(d.fields.cash), load: async () => { reads++; return { source: 'fixture', cash: [{ date: '2026-01-10', amount, source: 'account', counterparty: 'C', article: 'A', flow: '' }], orders: [], balances: {}, debtor: {}, creditor: {}, period: params, fields: { cash: true, orders: false, balances: false } }; } };
const key = archive.archiveKey(spec);
test('archive parity, persisted encrypted payload, filters and access', async () => {
  const normal = await archive.archivedLoad(spec);
  const cached = await archive.archivedLoad(spec);
  assert.equal(reads, 1); assert.equal(cached.archive.mode, 'archive');
  assert.deepEqual(buildLive(normal, params.start, params.end, true), buildLive(cached, params.start, params.end, true));
  assert.deepEqual(buildLive(normal, '2026-01-11', params.end, false), buildLive(cached, '2026-01-11', params.end, false));
  assert.ok(!rows.get(key).payload.includes('counterparty'));
  const limited = visibleDashboard(cached, { role: 'user', sections: ['sales'] });
  assert.equal(limited.cash.length, 0); assert.equal(limited.sections.cash, undefined);
  assert.equal(canView({ role: 'user', sections: ['sales'] }, 'movements'), false);
  assert.equal(canView({ role: 'user', sections: ['cash'] }, 'movements'), true);
});
test('historical correction changes revision and replaces snapshot', async () => {
  amount = 150; revision++;
  const updated = await archive.archivedLoad(spec);
  assert.equal(updated.cash[0].amount, 150);
  assert.equal((await archive.archivedLoad(spec)).cash[0].amount, 150);
});
test('corruption, incompatible schema and missing snapshot use normal reader', async () => {
  for (const change of [r => r.payload = 'broken', r => r.schema_version = 999, () => rows.delete(key)]) {
    archive.clearArchiveMemory(); change(rows.get(key)); const before = reads;
    assert.equal((await archive.archivedLoad(spec)).archive.mode, 'live');
    assert.equal(reads, before + 1);
    assert.equal((await archive.archivedLoad(spec)).archive.mode, 'archive');
  }
});
test('incomplete refresh and write failure preserve good payload and suppress stale hits', async () => {
  const old = rows.get(key).payload;
  await archive.archivedLoad({ ...spec, complete: () => false }, true);
  assert.equal(rows.get(key).payload, old); assert.ok(rows.get(key).last_error);
  assert.equal((await archive.archivedLoad(spec)).archive.mode, 'archive');
  failWrite = true;
  const result = await archive.archivedLoad(spec, true);
  assert.equal(result.cash[0].amount, amount); assert.match(result.archive.message, /сохранить/);
  failWrite = false;
});
test('parallel claims and fencing reject an expired writer', async () => {
  const tokens = await Promise.all([archive.claimArchive(spec), archive.claimArchive(spec)]);
  assert.equal(tokens.filter(Boolean).length, 1);
  const old = tokens.find(Boolean);
  rows.get(key).lease_until = '2000-01-01';
  const current = await archive.claimArchive(spec);
  await archive.buildArchive(spec, old);
  assert.equal(rows.get(key).lease_token, current);
  await archive.buildArchive(spec, current);
  assert.equal(rows.get(key).lease_token, null);
});
test('storage outage still serves normal data', async () => {
  unavailable = true;
  const result = await archive.archivedLoad(spec);
  assert.equal(result.cash[0].amount, amount); assert.match(result.archive.message, /недоступен/);
  unavailable = false;
});
test('archive admin route rejects unauthenticated users', async () => {
  const { NextRequest } = require('next/server');
  const route = require('../app/api/archive/route.ts');
  assert.equal((await route.GET(new NextRequest('http://localhost:3000/api/archive'))).status, 401);
  assert.equal((await route.POST(new NextRequest('http://localhost:3000/api/archive', { method: 'POST' }))).status, 401);
});
test('viewer cannot list or build archives; foreign-origin admin write is rejected', async () => {
  const { NextRequest } = require('next/server');
  const auth = require('../app/lib/auth.ts');
  const route = require('../app/api/archive/route.ts');
  const prior = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  process.env.AUTH_SECRET = crypto.randomBytes(48).toString('hex');
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = `scrypt$32768$8$3$${salt}$${crypto.randomBytes(64).toString('hex')}`;
  process.env.ADMIN_LOGIN = 'archive-test-admin'; process.env.ADMIN_PASSWORD_HASH = hash;
  process.env.USER_LOGIN = 'archive-test-viewer'; process.env.USER_PASSWORD_HASH = hash;
  try {
    const request = (method, role, origin) => new NextRequest('http://localhost:3000/api/archive', { method, headers: { cookie: `${auth.SESSION_COOKIE}=${auth.createSession(role)}`, origin } });
    assert.equal((await route.GET(request('GET', 'user', 'http://localhost:3000'))).status, 403);
    assert.equal((await route.POST(request('POST', 'user', 'http://localhost:3000'))).status, 403);
    assert.equal((await route.POST(request('POST', 'admin', 'https://foreign.example'))).status, 403);
  } finally { process.env.DATABASE_URL = prior; }
});

test('storage failure after claiming a lease still uses the source reader', async () => {
  const token = await archive.claimArchive(spec);
  unavailable = true;
  try {
    const result = await archive.buildArchive(spec, token);
    assert.equal(result.cash[0].amount, amount);
    assert.match(result.archive.message, /недоступен/);
  } finally { unavailable = false; rows.get(key).lease_until = '2000-01-01'; }
});

test('archiving an older connection snapshot never renews its freshness', async () => {
  const old = { ...spec, kind: 'old-snapshot', observedAt: () => '2020-01-01T00:00:00.000Z' };
  const first = await archive.archivedLoad(old);
  assert.equal(first.archive.observedAt, '2020-01-01T00:00:00.000Z');
  assert.equal((await archive.archivedLoad(old)).archive.mode, 'archive');
});

test('historical archive has no TTL; old createdAt and payload survive repeated reads', async () => {
  const persistent = { ...spec, kind: 'persistent' };
  await archive.archivedLoad(persistent);
  const row = rows.get(archive.archiveKey(persistent));
  row.observed_at = '2000-01-01T00:00:00.000Z'; row.created_at = '2000-01-02T00:00:00.000Z';
  const payload = row.payload, before = reads;
  for (let i = 0; i < 3; i++) assert.equal((await archive.archivedLoad(persistent)).archive.mode, 'archive');
  assert.equal(reads, before); assert.equal(row.payload, payload); assert.equal(row.created_at, '2000-01-02T00:00:00.000Z');
});
test('current data remains readable while background refresh is due', async () => {
  const current = { ...spec, kind: 'current', retention: 'current' };
  await archive.archivedLoad(current);
  rows.get(archive.archiveKey(current)).observed_at = '2000-01-01';
  assert.equal((await archive.archivedLoad(current)).archive.mode, 'archive');
});
test('content changes and calculation version invalidate historical archives', async () => {
  const before = reads; sourceContent = 'v2'; amount = 200;
  assert.equal((await archive.archivedLoad(spec)).cash[0].amount, 200);
  assert.equal(reads, before + 1);
  assert.equal((await archive.archivedLoad({ ...spec, calculationVersion: 'new-formulas' })).archive.mode, 'live');
});
test('content identity excludes sync time and object-key order', () => {
  const { contentHash } = require('../app/lib/archive-version.ts');
  assert.equal(contentHash({ cash: [{ amount: 2, date: '2020' }], syncedAt: 'old' }), contentHash({ syncedAt: 'new', cash: [{ date: '2020', amount: 2 }] }));
  assert.notEqual(contentHash({ cash: [{ amount: 2 }] }), contentHash({ cash: [{ amount: 3 }] }));
});
test('upstream revisions are checked by refresh jobs, never by period switches', async () => {
  let externalVersion = '1', unavailable = false;
  const monitored = { ...spec, kind: 'monitored', probe: async () => ({ versions: unavailable ? {} : { file: externalVersion }, warnings: unavailable ? ['Metadata unavailable'] : [], checkedAt: '2026-09-28' }) };
  await archive.archivedLoad(monitored);
  assert.equal((await archive.archivedLoad(monitored)).archive.mode, 'archive');
  externalVersion = '2';
  assert.equal((await archive.archivedLoad(monitored)).archive.mode, 'archive');
  assert.equal((await archive.archivedLoad(monitored, true)).archive.mode, 'live');
  unavailable = true;
  const old = rows.get(archive.archiveKey(monitored)).payload;
  const result = await archive.archivedLoad(monitored);
  assert.equal(result.archive.mode, 'archive'); assert.equal(result.archive.verification, 'unconfirmed');
  assert.equal(rows.get(archive.archiveKey(monitored)).payload, old);
});
test('upstream mutation during read never replaces a good historical snapshot', async () => {
  let externalVersion = '1';
  const monitored = { ...spec, kind: 'racing', probe: async () => ({ versions: { file: externalVersion }, warnings: [], checkedAt: '2026-09-28' }) };
  await archive.archivedLoad(monitored); const old = rows.get(archive.archiveKey(monitored)).payload;
  await archive.archivedLoad({ ...monitored, load: async () => { externalVersion = '2'; return spec.load(); } }, true);
  assert.equal(rows.get(archive.archiveKey(monitored)).payload, old); assert.ok(rows.get(archive.archiveKey(monitored)).last_error);
});

test('background verification of unchanged data preserves payload and creation time', async () => {
  const monitored = { ...spec, kind: 'unchanged' };
  await archive.archivedLoad(monitored);
  const key = archive.archiveKey(monitored), row = rows.get(key);
  const old = { payload: row.payload, createdAt: row.created_at, observedAt: row.observed_at };
  const token = await archive.claimArchive(monitored);
  await archive.buildArchive({ ...monitored, onlyIfChanged: true }, token);
  assert.equal(rows.get(key).payload, old.payload); assert.equal(rows.get(key).created_at, old.createdAt); assert.equal(rows.get(key).observed_at, old.observedAt); assert.ok(rows.get(key).verified_at);
  amount += 5;
  const next = await archive.claimArchive(monitored);
  await archive.buildArchive({ ...monitored, onlyIfChanged: true }, next);
  assert.notEqual(rows.get(key).payload, old.payload);
});
test('material hash keeps receivables archive and ignores transport timestamps', () => {
  const { reportContentHash } = require('../app/lib/archive-version.ts');
  assert.equal(reportContentHash({ cash: [], orders: [], updatedAt: 'a', sources: { date: 'a' }, operational: { account: { source: 'a', reason: 'a', value: 1, date: '2020-01-01T12:00:00Z' } } }), reportContentHash({ cash: [], orders: [], updatedAt: 'b', sources: { date: 'b' }, operational: { account: { source: 'a', reason: 'a', value: 1, date: '2021-01-01T12:00:00Z' } } }));
  assert.notEqual(reportContentHash({ receivables: { archive: { snapshots: [1] } } }), reportContentHash({ receivables: { archive: { snapshots: [2] } } }));
});

test('account detail release rebuilds aggregate-only archive and retains detail on the next read', async () => {
 const legacy={...spec,kind:'account-detail-regression',calculationVersion:'native-plans-v1',load:async()=>({...await spec.load(),operational:{account:{value:100}}})};
 const old=await archive.archivedLoad(legacy);
 assert.equal(old.operational.account.breakdown,undefined);
 const next={...legacy,calculationVersion:'native-plans-v1:account-breakdown-v1',load:async()=>({...await legacy.load(),operational:{account:{value:100,breakdown:[{id:1,name:'Банк',value:100}]}}})};
 const rebuilt=await archive.archivedLoad(next);
 assert.equal(rebuilt.archive.mode,'live');assert.equal(rebuilt.operational.account.breakdown.length,1);
 const cached=await archive.archivedLoad(next);
 assert.equal(cached.archive.mode,'archive');assert.deepEqual(cached.operational.account.breakdown,rebuilt.operational.account.breakdown);
});
