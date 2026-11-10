/* eslint-disable @typescript-eslint/no-require-imports */
// Read actual sources without editing them. Only the new archive is written.
const fs = require('node:fs'), Module = require('node:module'), ts = require('typescript');
const assert = require('node:assert/strict');
require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const original = Module._load;
Module._load = function(name, parent, main) {
  if (name === 'server-only') return {};
  if (name.startsWith('@/')) name = require('node:path').join(process.cwd(), name.slice(2));
  return original.call(this, name, parent, main);
};
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, f);
const { neon } = require('@neondatabase/serverless');
const crypto = require('node:crypto');
const archive = require('../app/lib/period-archive.ts');
let stage = 'create';
(async () => {
  const sql = neon(process.env.DATABASE_URL);
  const spec = { kind: `verification-${crypto.randomUUID()}`, start: '2001-01-01', end: '2001-01-31', load: async () => ({ value: 1 }), complete: d => typeof d.value === 'number' };
  const key = archive.archiveKey(spec);
  const checks = [];
  try {
    await archive.archivedLoad(spec);
    assert.equal((await archive.archivedLoad(spec)).archive.mode, 'archive'); checks.push('PostgreSQL persistence and decrypt');
    // Simulate a snapshot much older than the former five-minute TTL.
    await sql`UPDATE mart_dashboard_archive SET observed_at='2000-01-01',created_at='2000-01-02',verified_at='2000-01-02' WHERE archive_key=${key}`;
    const persisted = (await sql`SELECT payload,created_at FROM mart_dashboard_archive WHERE archive_key=${key}`)[0];
    assert.equal((await archive.archivedLoad(spec)).archive.mode, 'archive');
    const { execFileSync } = require('node:child_process');
    stage = 'restart';
    const freshProcess = JSON.parse(execFileSync(process.execPath, ['scripts/verify-archive-restart.cjs', spec.kind], { encoding: 'utf8', timeout: 30000 }));
    assert.equal(freshProcess.mode, 'archive'); assert.equal(Date.parse(freshProcess.createdAt), Date.parse(persisted.created_at));
    checks.push('Historical snapshot survives a fresh Node process with source reader disabled');
    stage = 'background unchanged';
    const verificationToken = await archive.claimArchiveVerification(spec);
    assert.ok(verificationToken); assert.equal(await archive.claimArchiveVerification(spec), null);
    assert.equal((await archive.archivedLoad(spec)).archive.mode, 'archive');
    await archive.buildArchive({ ...spec, onlyIfChanged: true }, verificationToken);
    const verified = (await sql`SELECT payload,created_at FROM mart_dashboard_archive WHERE archive_key=${key}`)[0];
    assert.equal(verified.payload, persisted.payload); assert.equal(Date.parse(verified.created_at), Date.parse(persisted.created_at));
    checks.push('Background verification retains unchanged payload and creation time');
    stage = 'concurrency';
    const claims = await Promise.all([archive.claimArchive(spec), archive.claimArchive(spec)]);
    assert.equal(claims.filter(Boolean).length, 1); checks.push('Concurrent atomic claim');
    stage = 'fencing';
    const oldToken = claims.find(Boolean);
    await sql`UPDATE mart_dashboard_archive SET lease_until=now()-interval '1 minute' WHERE archive_key=${key}`;
    const newToken = await archive.claimArchive(spec);
    await archive.buildArchive({ ...spec, load: async () => ({ value: 2 }) }, oldToken);
    assert.equal((await sql`SELECT lease_token FROM mart_dashboard_archive WHERE archive_key=${key}`)[0].lease_token, newToken);
    await archive.buildArchive({ ...spec, load: async () => ({ value: 3 }) }, newToken);
    assert.equal((await archive.archivedLoad(spec)).value, 3); checks.push('Expired writer fencing');
    await archive.archivedLoad({ ...spec, load: async () => ({ value: 4 }) }, true);
    assert.equal((await archive.archivedLoad(spec)).value, 4); checks.push('Historical replacement');
    const before = (await sql`SELECT payload FROM mart_dashboard_archive WHERE archive_key=${key}`)[0].payload;
    await archive.archivedLoad({ ...spec, complete: () => false }, true);
    assert.equal((await sql`SELECT payload FROM mart_dashboard_archive WHERE archive_key=${key}`)[0].payload, before); checks.push('Incomplete refresh preserves good payload');
    archive.clearArchiveMemory();
    await sql`UPDATE mart_dashboard_archive SET payload='corrupted',last_error=NULL WHERE archive_key=${key}`;
    assert.equal((await archive.archivedLoad(spec)).value, 1);
    assert.equal((await archive.archivedLoad(spec)).archive.mode, 'archive'); checks.push('Corrupt archive fallback and repair');
    await sql`UPDATE mart_dashboard_archive SET schema_version=999 WHERE archive_key=${key}`;
    assert.equal((await archive.archivedLoad(spec)).archive.mode, 'live'); checks.push('Schema mismatch fallback');
    console.log(JSON.stringify({ postgresChecks: checks }, null, 2));
    fs.writeFileSync('artifacts/period-archive/postgres-check.json', JSON.stringify({ postgresChecks: checks }, null, 2));
  } finally { await sql`DELETE FROM mart_dashboard_archive WHERE archive_key=${key}`; }
})().catch(() => { console.error('Archive storage integration check failed at', stage); process.exitCode = 1; });
