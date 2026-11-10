// Read-only migration checks. Never log environment values, hashes or registry contents.
const fs = require('node:fs');
const { neon } = require('@neondatabase/serverless');
try {
if (process.env.MIGRATION_ENV_FILE) {
  const values = JSON.parse(fs.readFileSync(process.env.MIGRATION_ENV_FILE, 'utf8'));
  for (const [key, value] of Object.entries(values)) process.env[key] = typeof value === 'string' ? value : JSON.stringify(value);
} else require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
} catch { console.log(JSON.stringify({ ready: false, readOnly: true, issues: [{ code: 'invalid_local_configuration' }] })); process.exit(1); }
const issues = [];
const add = (code, message) => issues.push({ code, message });
async function main() {
  for (const name of ['AUTH_SECRET', 'ADMIN_LOGIN', 'ADMIN_PASSWORD_HASH', 'DATABASE_URL', 'CONNECTIONS_ENCRYPTION_KEY']) if (!process.env[name]) add('missing_setting', name);
  if (process.env.AUTH_SECRET && process.env.AUTH_SECRET.length < 32) add('invalid_auth_secret', 'AUTH_SECRET');
  if (process.env.CONNECTIONS_ENCRYPTION_KEY && (!/^[a-f0-9]{64}$/i.test(process.env.CONNECTIONS_ENCRYPTION_KEY) || process.env.CONNECTIONS_ENCRYPTION_KEY === process.env.AUTH_SECRET)) add('invalid_encryption_key', 'CONNECTIONS_ENCRYPTION_KEY');
  if (issues.length) return;
  const sql = neon(process.env.DATABASE_URL, { fetchOptions: { signal: AbortSignal.timeout(15000) } });
  try {
    const tables = ['mart_connections', 'mart_source_links', 'mart_source_snapshots', 'mart_source_runs', 'mart_dashboard_archive', 'mart_source_input_archive', 'mart_wallet_percentage', 'mart_user_write_lock', 'mart_login_attempts', 'mart_user_registry'];
    // Resolve table names without reading or logging source records.
    for (const table of tables) {
      const result = await sql`SELECT to_regclass(${table}) AS name`;
      if (!result[0]?.name) add('missing_table', table);
    }
    if (issues.length) return;
    const rows = await sql`SELECT value FROM mart_user_registry WHERE id=1`;
    if (!rows.length) { add('uninitialized_registry', 'Existing production registry must be transferred; do not initialize an empty replacement.'); return; }
    const users = JSON.parse(rows[0].value);
    if (!Array.isArray(users)) { add('invalid_registry', 'Stored registry is not an array.'); return; }
    if (users.some(user => user.login === process.env.ADMIN_LOGIN)) add('admin_login_collision', 'The current Timeweb administrator login conflicts with a managed viewer.');
    const legacy = users.find(user => user.login === process.env.USER_LOGIN);
    if (legacy && (legacy.enabled === false || legacy.passwordHash !== process.env.USER_PASSWORD_HASH)) add('legacy_user_collision', 'The managed registry overrides the current Timeweb viewer credentials; resolve before release.');
    const encrypted = await sql`SELECT id, secrets FROM mart_connections WHERE secrets IS NOT NULL LIMIT 1`;
    if (encrypted.length) {
      // Reuse the application's authenticated decryption format, without revealing the plaintext.
      const Module = require('node:module'), ts = require('typescript');
      const load = Module._load;
      Module._load = function(name, parent, main) { return name === 'server-only' ? {} : load.call(this, name, parent, main); };
      require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
      try { require('../app/lib/connections/crypto.ts').unseal(encrypted[0].secrets, String(encrypted[0].id)); }
      catch { add('encryption_mismatch', 'The existing connection cannot be decrypted with the selected key.'); }
      Module._load = load;
    }
  } catch { add('storage_check_failed', 'Production storage could not be verified; no data was changed.'); }
}
main().then(() => { console.log(JSON.stringify({ ready: issues.length === 0, readOnly: true, issues })); process.exitCode = issues.length ? 1 : 0; }).catch(() => { console.log(JSON.stringify({ ready: false, readOnly: true, issues: [{ code: 'check_failed' }] })); process.exitCode = 1; });
