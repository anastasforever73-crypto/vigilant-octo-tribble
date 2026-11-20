const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
let builds = [], claimed = true, fail = false;
const sql = async (strings, ...values) => {
  const query = strings.reduce((text, part, index) => text + (index ? `$${index}` : '') + part, '');
  return (await db.query(query, values)).rows;
};
const original = Module._load;
Module._load = function(name, parent, main) {
  if (name === 'server-only') return {};
  if (name === './postgres') return { postgres: () => sql };
  if (name === './receivables') return { moscowToday: () => '2026-11-20' };
  if (name === './load-dashboard') return { dashboardArchiveSpec: (p, force) => ({ kind: 'dashboard', start: p.get('start'), end: p.get('end'), force }) };
  if (name === './period-archive') return {
    claimArchiveVerification: async () => claimed ? 'lease' : null,
    buildArchive: async spec => {
      builds.push(spec);
      if (fail) throw new Error('source unavailable');
      return { archive: { createdAt: 'saved' } };
    },
  };
  return original.call(this, name, parent, main);
};
require.extensions['.ts'] = (m, filename) => m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { refreshNextArchive } = require('../app/lib/archive-refresh-worker.ts');
process.env.DATABASE_URL = 'test-only';
test('automatic worker selects only due saved reports, respects leases and retains payload on failure', async () => {
  await db.exec(`CREATE TABLE mart_dashboard_archive(archive_key text,kind text,period_start text,period_end text,payload text,verified_at timestamptz,created_at timestamptz,attempted_at timestamptz,lease_until timestamptz)`);
  async function seed(end, age, extra = {}) {
    const row = { archive_key: end, kind: 'dashboard', period_start: '2026-01-01', period_end: end, payload: 'last-good', ...extra };
    await db.query(`INSERT INTO mart_dashboard_archive VALUES($1,$2,$3,$4,$5,now()-($6 * interval '1 second'),now()-interval '2 days',$7,$8)`, [row.archive_key,row.kind,row.period_start,row.period_end,row.payload,age,row.attempted_at || null,row.lease_until || null]);
  }
  await seed('2026-11-30', 200); // current but not due
  await seed('2026-09-30', 3500); // historical but not due
  assert.equal(await refreshNextArchive(), false);
  await seed('2026-08-31', 7200);
  await seed('2026-11-20', 400);
  assert.equal(await refreshNextArchive(), true);
  assert.equal(builds.at(-1).end, '2026-11-20');
  assert.equal(builds.at(-1).force, true);
  assert.equal(builds.at(-1).onlyIfChanged, true);
  claimed = false;
  const count = builds.length;
  assert.equal(await refreshNextArchive(), false);
  assert.equal(builds.length, count);
  claimed = true;
  await db.exec(`UPDATE mart_dashboard_archive SET lease_until=now()+interval '4 minutes' WHERE period_end='2026-11-20'`);
  await refreshNextArchive();
  assert.equal(builds.at(-1).end, '2026-08-31');
  await db.exec(`UPDATE mart_dashboard_archive SET attempted_at=now() WHERE period_end='2026-08-31'`);
  assert.equal(await refreshNextArchive(), false);
  await db.exec(`UPDATE mart_dashboard_archive SET attempted_at=NULL WHERE period_end='2026-08-31'`);
  fail = true;
  await assert.rejects(refreshNextArchive(), /source unavailable/);
  assert.equal((await db.query(`SELECT payload FROM mart_dashboard_archive WHERE period_end='2026-08-31'`)).rows[0].payload, 'last-good');
  process.env.ARCHIVE_AUTO_REFRESH = 'false';
  assert.equal(await refreshNextArchive(), false);
  delete process.env.ARCHIVE_AUTO_REFRESH;
  await db.close();
});
