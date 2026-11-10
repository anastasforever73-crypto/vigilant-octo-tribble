// Operator-only recovery. Production is read through a READ ONLY transaction.
// No credentials, source records or database error messages are written to stdout.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const TABLES = ['mart_connections', 'mart_source_links', 'mart_source_snapshots', 'mart_source_runs', 'mart_dashboard_archive', 'mart_source_input_archive', 'mart_wallet_percentage', 'mart_user_write_lock', 'mart_login_attempts', 'mart_user_registry'];
function fail(code) { const e = new Error(code); e.safeCode = code; throw e; }
function identity(url) {
  const u = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(u.protocol)) fail('invalid_database_url');
  return crypto.createHash('sha256').update(u.hostname.toLowerCase().replace(/-pooler(?=\.)/, '') + ':' + (u.port || '5432') + u.pathname).digest('hex');
}
function load(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function privateWrite(file, value) {
  // Never overwrite another backup or follow an existing symlink.
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); } finally { fs.closeSync(fd); }
}
function summary(backup) {
  const t = backup.tables;
  return {
    format: backup.format, exportedAt: backup.exportedAt, readOnlySource: true,
    rows: Object.fromEntries(TABLES.map(name => [name, t[name].length])),
    sourceTypes: t.mart_connections.reduce((a, r) => { const type = ['googleSheets', 'debt', 'fintablo', 'crm'].includes(r.type) ? r.type : 'other'; a[type] = (a[type] || 0) + 1; return a; }, {}),
    encryptedPayloadsReadableWithoutOldKey: false,
  };
}
const ENCRYPTED = {
  mart_source_snapshots: 'connection_id,period_start,period_end',
  mart_dashboard_archive: 'archive_key', mart_source_input_archive: 'input_key',
};
const ORDER = { mart_connections:'id', mart_source_links:'id', mart_source_runs:'id', mart_wallet_percentage:'effective_from', mart_user_write_lock:'id', mart_login_attempts:'bucket', mart_user_registry:'id', ...ENCRYPTED };
async function exportBackup(sql, sourceUrl) {
  const options = () => ({ isolationLevel: 'RepeatableRead', readOnly: true });
  const capture = () => sql.transaction(TABLES.map(name => sql.query(ENCRYPTED[name]
    ? `SELECT ${ORDER[name]},md5(row_to_json(t)::text) AS recovery_hash,octet_length(payload) AS payload_bytes FROM public.${name} t ORDER BY ${ORDER[name]}`
    : `SELECT * FROM public.${name} ORDER BY ${ORDER[name]}`)), options());
  // The HTTP driver limits response size. Read encrypted rows in bounded pages,
  // then verify the complete source manifest did not change during the export.
  const before = await capture();
  const tables = Object.fromEntries(TABLES.map((name,i) => [name, ENCRYPTED[name] ? [] : before[i]]));
  const tasks = [];
  for (const name of Object.keys(ENCRYPTED)) {
    const manifest = before[TABLES.indexOf(name)];
    for (let offset=0; offset<manifest.length;) {
      let bytes=0, count=0;
      do { bytes += Number(manifest[offset+count].payload_bytes || 0); count++; }
      while (offset+count < manifest.length && bytes + Number(manifest[offset+count].payload_bytes || 0) < 6_000_000);
      tasks.push({ name, offset, count }); offset += count;
    }
  }
  for (let i=0; i<tasks.length; i+=3) {
    const group = tasks.slice(i,i+3);
    const results = await Promise.allSettled(group.map(t => sql.transaction([sql.query(`SELECT t.*,md5(row_to_json(t)::text) AS recovery_hash FROM public.${t.name} t ORDER BY ${ORDER[t.name]} LIMIT $1 OFFSET $2`,[t.count,t.offset])], options())));
    for (let j=0;j<results.length;j++) {
      if (results[j].status !== 'fulfilled') {
        const e = results[j].reason;
        const text = String(e?.message || '') + ' ' + String(e?.cause?.message || '') + ' ' + String(e?.sourceError?.message || '');
        fail(/size|too large|exceed/i.test(text) ? 'backup_response_size_limit' : /timeout|aborted/i.test(text) ? 'backup_page_timeout' : 'backup_page_read_failed');
      }
      const page = results[j].value[0];
      if (page.length !== group[j].count) fail('source_changed_retry_export');
      const expected = before[TABLES.indexOf(group[j].name)].slice(group[j].offset,group[j].offset+group[j].count);
      for(let k=0;k<page.length;k++) {
        if(page[k].recovery_hash !== expected[k].recovery_hash) fail('source_changed_retry_export');
        delete page[k].recovery_hash;
      }
      tables[group[j].name].push(...page);
    }
  }
  const after = await capture();
  if (JSON.stringify(before) !== JSON.stringify(after)) fail('source_changed_retry_export');
  // Check each fetched ciphertext row belongs to that same manifest, including its metadata.
  // PostgreSQL row_to_json and JS JSON differ in timestamp formatting, so ask PostgreSQL
  // for each row's original hash alongside the row instead of recomputing JSON locally.
  return { format: 'mart-timeweb-recovery-v1', exportedAt: new Date().toISOString(), sourceIdentity: identity(sourceUrl), tables };
}
function validate(backup, env) {
  if (backup?.format !== 'mart-timeweb-recovery-v1' || !/^[a-f0-9]{64}$/.test(backup.sourceIdentity || '') || TABLES.some(t => !Array.isArray(backup.tables?.[t]))) fail('invalid_backup');
  if (!env.DATABASE_URL || identity(env.DATABASE_URL) === backup.sourceIdentity) fail('target_must_be_separate');
  if (!/^[a-f0-9]{64}$/i.test(env.CONNECTIONS_ENCRYPTION_KEY || '') || env.CONNECTIONS_ENCRYPTION_KEY === env.AUTH_SECRET) fail('target_key_required');
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32 || !env.ADMIN_LOGIN || !env.ADMIN_PASSWORD_HASH) fail('preserved_auth_required');
  const registry = backup.tables.mart_user_registry;
  if (registry.length !== 1 || registry[0].id !== 1) fail('initialized_registry_required');
  let users;
  try { users = JSON.parse(registry[0].value); } catch { fail('invalid_registry'); }
  if (!Array.isArray(users) || users.length > 100) fail('invalid_registry');
  const names = new Set();
  for (const user of users) {
    if (!user || typeof user !== 'object' || typeof user.login !== 'string' || !user.login || user.login !== user.login.trim() || user.login.length > 200 || /[\x00-\x1f\x7f]/.test(user.login) || names.has(user.login) ||
      !/^scrypt\$32768\$8\$3\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(user.passwordHash || '') ||
      user.role !== undefined && user.role !== 'user' || user.enabled !== undefined && typeof user.enabled !== 'boolean' ||
      user.sections !== undefined && (!Array.isArray(user.sections) || !user.sections.length || user.sections.length>9 || new Set(user.sections).size !== user.sections.length || user.sections.some(s => !['overview','cash','opiu','balance','sales','goods','logistics','debt','plan'].includes(s))) || user.revision !== undefined && (typeof user.revision !== 'string' || user.revision.length>100)) fail('invalid_registry');
    names.add(user.login);
    if (user.login === env.ADMIN_LOGIN) fail('admin_login_collision');
    if (user.login === env.USER_LOGIN && (user.enabled === false || user.passwordHash !== env.USER_PASSWORD_HASH)) fail('legacy_user_collision');
  }
  const ids = new Set(backup.tables.mart_connections.map(c => c.id));
  if (backup.tables.mart_source_links.some(l => !ids.has(l.connection_id))) fail('orphan_binding');
}
function emptySecrets(key, id) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  cipher.setAAD(Buffer.from(id));
  const data = Buffer.concat([cipher.update('{}'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.');
}
function recoveryQueries(sql, backup, env, migrations) {
  validate(backup, env);
  const queries = [sql.query(`DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_tables WHERE schemaname='public') THEN RAISE EXCEPTION 'target_not_empty'; END IF;
  END $$`)];
  // All schema changes and restored rows are atomic. Never run these against the source.
  for (const text of migrations) {
    const clean = text.replace(/--[^\n]*/g, '').replace(/\b(?:BEGIN|COMMIT)\s*;/g, '');
    for (const statement of clean.split(';').map(s => s.trim()).filter(Boolean)) queries.push(sql.query(statement));
  }
  for (const c of backup.tables.mart_connections) queries.push(sql.query(
    `INSERT INTO mart_connections(id,name,type,enabled,revision,write_token,config,secrets,secret_fields,status,last_error,created_at)
     VALUES($1,$2,$3,false,$4,$5,$6::jsonb,$7,'[]'::jsonb,'disabled',$8,$9)`,
    [c.id,c.name,c.type,Number(c.revision)+1,crypto.randomUUID(),JSON.stringify(c.config),emptySecrets(env.CONNECTIONS_ENCRYPTION_KEY,c.id),'Повторно укажите реквизиты, проверьте подключение и включите источник.',c.created_at]));
  for (const l of backup.tables.mart_source_links) queries.push(sql.query(
    'INSERT INTO mart_source_links(connection_id,section,dataset,definition) VALUES($1,$2,$3,$4::jsonb)', [l.connection_id,l.section,l.dataset,JSON.stringify(l.definition)]));
  for (const w of backup.tables.mart_wallet_percentage) queries.push(sql.query(
    'INSERT INTO mart_wallet_percentage(effective_from,percent,updated_at) VALUES($1,$2,$3)', [w.effective_from,w.percent,w.updated_at]));
  const r = backup.tables.mart_user_registry[0];
  queries.push(sql.query('INSERT INTO mart_user_registry(id,value,revision,updated_at) VALUES(1,$1,$2,$3)', [r.value,r.revision,r.updated_at]));
  // Keep active rate limits so recovery cannot bypass a login lockout. Write leases expire and are not imported.
  for (const a of backup.tables.mart_login_attempts.filter(a => Date.parse(a.expires_at) > Date.now())) queries.push(sql.query(
    'INSERT INTO mart_login_attempts(bucket,attempts,expires_at) VALUES($1,$2,$3)', [a.bucket,a.attempts,a.expires_at]));
  return queries;
}
async function main() {
  const [command, envFile, backupFile, reportFile] = process.argv.slice(2);
  if (!['export','plan','import'].includes(command) || !envFile || !backupFile) fail('usage_export_plan_import_env_file_backup_file_optional_report');
  const env = load(envFile);
  if (command === 'export') {
    const { postgres } = require('./lib/postgres.cjs');
    if (!env.DATABASE_URL) fail('source_database_required');
    const sql = postgres(env.DATABASE_URL, { env, statementTimeoutMs: 60000 });
    const backup = await exportBackup(sql, env.DATABASE_URL);
    privateWrite(backupFile, backup);
    const result = summary(backup);
    if (reportFile) privateWrite(reportFile, result);
    console.log(JSON.stringify(result));
    return;
  }
  const backup = load(backupFile);
  validate(backup, env);
  const result = { ...summary(backup), targetSeparate: true, restore: ['disabled_connections','source_bindings','user_hashes_and_permissions','wallet_percentage_history','active_login_limits'], quarantineOnly: ['encrypted_credentials','source_snapshots','report_archives','source_input_archives','old_sync_logs'], productionModified: false };
  if (command === 'plan') { console.log(JSON.stringify(result)); return; }
  if (env.RECOVERY_CONFIRM_EMPTY_TARGET !== 'new-isolated-timeweb-storage') fail('empty_target_confirmation_required');
  const { postgres } = require('./lib/postgres.cjs');
  const sql = postgres(env.DATABASE_URL, { env, statementTimeoutMs: 60000 });
  const dir = path.join(__dirname, '../migrations');
  const migrations = fs.readdirSync(dir).filter(n => /^\d+.*\.sql$/.test(n)).sort().map(n => fs.readFileSync(path.join(dir,n),'utf8'));
  await sql.transaction(recoveryQueries(sql, backup, env, migrations), { isolationLevel: 'Serializable' });
  console.log(JSON.stringify({ ...result, imported: true, sourcesEnabled: false }));
}
module.exports = { identity, privateWrite, summary, exportBackup, validate, emptySecrets, recoveryQueries };
if (require.main === module) main().finally(() => require('./lib/postgres.cjs').closePools()).catch(e => { console.log(JSON.stringify({ ready:false, code:e.safeCode || 'recovery_failed_no_details_logged' })); process.exitCode=1; });
