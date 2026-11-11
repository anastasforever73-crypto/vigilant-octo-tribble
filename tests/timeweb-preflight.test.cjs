const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Module = require('node:module');
const ts = require('typescript');
const crypto = require('node:crypto');
const load = Module._load;
Module._load = function (name, parent, main) { return name === 'server-only' ? {} : load.call(this, name, parent, main); };
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const { seal } = require('../app/lib/connections/crypto.ts');
Module._load = load;
async function run({ collision = false, wrongKey = false, missingTable = false } = {}) {
  const env = { AUTH_SECRET: crypto.randomBytes(48).toString('hex'), ADMIN_LOGIN: 'existing-admin', ADMIN_PASSWORD_HASH: 'private-admin-hash', USER_LOGIN: 'existing-viewer', USER_PASSWORD_HASH: 'private-viewer-hash', DATABASE_URL: 'postgresql://private-user:private-pass@db.example.test/db', CONNECTIONS_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex') };
  const oldKey = process.env.CONNECTIONS_ENCRYPTION_KEY;
  process.env.CONNECTIONS_ENCRYPTION_KEY = wrongKey ? crypto.randomBytes(32).toString('hex') : env.CONNECTIONS_ENCRYPTION_KEY;
  const encrypted = seal({ token: 'fixture-source-token' }, 'fixture-connection-id');
  process.env.CONNECTIONS_ENCRYPTION_KEY = env.CONNECTIONS_ENCRYPTION_KEY;
  const logs = [], queries = [];
  const sql = async (parts, ...values) => {
    const query = parts.join('?'); queries.push(query);
    if (query.includes('to_regclass')) return [{ name: missingTable && values[0] === 'mart_user_registry' ? null : values[0] }];
    if (query.includes('mart_user_registry')) return [{ value: JSON.stringify(collision ? [{ login: env.USER_LOGIN, passwordHash: 'different-hash', enabled: true }] : []) }];
    if (query.includes('mart_connections')) return [{ id: 'fixture-connection-id', secrets: encrypted }];
    throw Error('Unexpected query');
  };
  const localProcess = { env, cwd: () => process.cwd(), exitCode: 0, exit() { throw Error('Unexpected exit'); } };
  const context = { AbortSignal, process: localProcess, console: { log(value) { logs.push(value); } }, require(name) {
    if (name.endsWith('/postgres') || name.endsWith('/lib/postgres.cjs')) return { postgres: () => sql, environmentOverride: () => null, storageEnabled: () => Boolean(process.env.DATABASE_URL) || process.env.TEMPORARY_STORAGE_ENABLED === "true", temporaryStorage: () => !process.env.DATABASE_URL && process.env.TEMPORARY_STORAGE_ENABLED === "true" };
    if (name === '@next/env') return { loadEnvConfig() {} };
    return require(name);
  } };
  context.require.extensions = require.extensions;
  try { await vm.runInNewContext(fs.readFileSync('scripts/timeweb-preflight.cjs', 'utf8'), context); }
  finally { if (oldKey === undefined) delete process.env.CONNECTIONS_ENCRYPTION_KEY; else process.env.CONNECTIONS_ENCRYPTION_KEY = oldKey; }
  assert.ok(queries.every(query => /^SELECT\b/.test(query)));
  const output = logs.join('\n');
  for (const value of [env.AUTH_SECRET, env.DATABASE_URL, env.CONNECTIONS_ENCRYPTION_KEY, env.ADMIN_PASSWORD_HASH, 'fixture-source-token']) assert.ok(!output.includes(value));
  return JSON.parse(logs.at(-1));
}
test('preflight verifies real authenticated ciphertext using only SELECT and sanitized output', async () => {
  const result = await run(); assert.equal(result.ready, true, JSON.stringify(result.issues));
});
test('preflight blocks account conflicts, wrong encryption keys and absent production schema', async () => {
  assert.ok((await run({ collision: true })).issues.some(issue => issue.code === 'legacy_user_collision'));
  assert.ok((await run({ wrongKey: true })).issues.some(issue => issue.code === 'encryption_mismatch'));
  assert.ok((await run({ missingTable: true })).issues.some(issue => issue.code === 'missing_table'));
});
