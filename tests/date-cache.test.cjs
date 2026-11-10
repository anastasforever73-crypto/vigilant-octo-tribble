/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), Module = require('node:module'), ts = require('typescript');
const test = require('node:test'), assert = require('node:assert/strict');
const load = Module._load;
Module._load = function(n,p,m) { return n === 'server-only' ? {} : load.call(this,n,p,m); };
require.extensions['.ts'] = (m,f) => m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, f);
const { MemoryCache } = require('../app/lib/memory-cache.ts');
const { DashboardQueryCache, coveredDashboard } = require('../app/lib/dashboard-query-cache.ts');
const { buildLive } = require('../app/lib/live-data.ts');
const fixture = { source: 'fixture', cash: [{ date: '2026-01-20', amount: 100, source: 'account', counterparty: 'a', article: 'a', flow: '' }], orders: [], debtor: {}, creditor: {}, balances: { date: '2026-01-31', account: 15 }, fields: { cash: true, balances: true, orders: false }, period: { start: '2026-01-01', end: '2026-01-31', comparisonStart: '2025-12-01' }, archive: { mode: 'archive', sourceVersion: 'v1', createdAt: '2026-02-01' } };
test('LRU enforces bytes and entry limits', () => {
  const c = new MemoryCache(20, 2); c.set('a', 1, 8); c.set('b', 2, 8); c.get('a'); c.set('c',3,8);
  assert.equal(c.get('b'),undefined); assert.equal(c.get('a'),1); c.set('huge',4,21); assert.equal(c.get('huge'),undefined);
  c.clear(); assert.deepEqual(c.values(),[]);
});
test('coverage includes comparison and stock date; no client aggregation of restricted debt totals', () => {
  const selected = coveredDashboard(fixture,'2026-01-20','2026-01-31');
  assert.ok(selected); assert.deepEqual(buildLive(selected,'2026-01-20','2026-01-31',true),buildLive(fixture,'2026-01-20','2026-01-31',true));
  assert.equal(coveredDashboard(fixture,'2026-01-01','2026-01-30'),undefined);
  assert.equal(coveredDashboard(fixture,'2025-12-01','2026-01-31'),undefined);
  assert.equal(coveredDashboard({...fixture,debtPayments:100},'2026-01-20','2026-01-31'),undefined);
});
test('browser cache deduplicates, reuses covered intervals and isolates sessions and revisions', async () => {
  let requests = 0, version = 'v1';
  global.fetch = async () => { requests++; await new Promise(r=>setTimeout(r,5)); return Response.json({...fixture,archive:{...fixture.archive,sourceVersion:version}}); };
  const c = new DashboardQueryCache('org1:user1:rights1:session1');
  await Promise.all([c.load('2026-01-01','2026-01-31'),c.load('2026-01-01','2026-01-31')]); assert.equal(requests,1);
  await c.load('2026-01-20','2026-01-31'); assert.equal(requests,1);
  assert.equal(new DashboardQueryCache('org2:user1:rights1:session1').get('2026-01-01','2026-01-31'),undefined);
  version = 'v2'; await c.load('2026-01-01','2026-01-31',{revalidate:true}); assert.equal(c.get('2026-01-01','2026-01-31').archive.sourceVersion,'v2');
  c.clear(); assert.equal(c.get('2026-01-01','2026-01-31'),undefined);
});
test('logout fences pending responses and prefetch misses never populate cache',async()=>{
  let release; global.fetch = () => new Promise(resolve=>{release=resolve});
  const c = new DashboardQueryCache('session'); const request = c.load('2026-01-01','2026-01-31'); c.clear(); release(Response.json(fixture));
  assert.equal(await request,undefined); assert.equal(c.get('2026-01-01','2026-01-31'),undefined);
  global.fetch = async()=>new Response(null,{status:204});
  assert.equal(await c.load('2026-02-01','2026-02-28',{prefetch:true}),undefined);
});
