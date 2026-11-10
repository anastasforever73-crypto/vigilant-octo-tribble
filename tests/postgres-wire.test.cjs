// Real TCP/TLS suite. Requires an explicitly configured loopback-only test server.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {postgres,closePools}=require('../scripts/lib/postgres.cjs');
const {recoveryQueries,exportBackup}=require('../scripts/timeweb-recovery.cjs');
const env=JSON.parse(fs.readFileSync(process.env.MART_PG_TEST_ENV,'utf8'));
assert.equal(env.DATABASE_HOSTADDR,'127.0.0.1','Wire tests are restricted to loopback.');
assert.equal(env.DATABASE_SSL_MODE,'verify-full');
const sql=postgres(env.DATABASE_URL,{env});
test.after(closePools);
test('real PostgreSQL TLS checks CA and hostname, and transactions pin one backend',async()=>{
 const rows=await sql`SELECT ssl,version FROM pg_stat_ssl WHERE pid=pg_backend_pid()`;assert.equal(rows[0].ssl,true);assert.match(rows[0].version,/TLSv1\.[23]/);
 const result=await sql.transaction([sql`SELECT pg_backend_pid() AS pid`,sql`SELECT pg_backend_pid() AS pid`],{isolationLevel:'RepeatableRead',readOnly:true});assert.equal(result[0][0].pid,result[1][0].pid);
 const wrongName=postgres(env.DATABASE_URL,{env:{...env,DATABASE_TLS_SERVERNAME:'wrong.mart.test'}});await assert.rejects(Promise.resolve(wrongName`SELECT 1`));
 const wrongCa=postgres(env.DATABASE_URL,{env:{...env,DATABASE_SSL_CA_FILE:undefined}});await assert.rejects(Promise.resolve(wrongCa`SELECT 1`));
});
test('real TCP transport preserves rollback and READ ONLY enforcement',async()=>{
 const table='wire_atomic_'+crypto.randomBytes(6).toString('hex');
 await sql.query(`CREATE TABLE ${table}(id integer PRIMARY KEY)`);
 await assert.rejects(sql.transaction([sql.query(`INSERT INTO ${table} VALUES($1)`,[1]),sql.query(`INSERT INTO ${table} VALUES($1)`,[1])]),e=>e.code==='23505');
 assert.equal((await sql.query(`SELECT COUNT(*)::int AS n FROM ${table}`))[0].n,0);
 await assert.rejects(sql.transaction([sql.query(`INSERT INTO ${table} VALUES($1)`,[2])],{readOnly:true}),e=>e.code==='25006');
 assert.equal((await sql.query(`SELECT COUNT(*)::int AS n FROM ${table}`))[0].n,0);
});
test('empty real PostgreSQL restores all schema migrations through the pg transport and refuses a nonempty target',async()=>{
 const name='mart_wire_'+crypto.randomBytes(6).toString('hex');await sql.query(`CREATE DATABASE ${name}`);
 const u=new URL(env.DATABASE_URL);u.pathname='/'+name;const target={...env,DATABASE_URL:u.href,AUTH_SECRET:'a'.repeat(96),ADMIN_LOGIN:'fixture-admin',ADMIN_PASSWORD_HASH:'fixture-hash',CONNECTIONS_ENCRYPTION_KEY:crypto.randomBytes(32).toString('hex')};
 const db=postgres(target.DATABASE_URL,{env:target});
 const tables=Object.fromEntries(['mart_connections','mart_source_links','mart_source_snapshots','mart_source_runs','mart_dashboard_archive','mart_source_input_archive','mart_wallet_percentage','mart_user_write_lock','mart_login_attempts','mart_user_registry'].map(t=>[t,[]]));
 tables.mart_user_registry=[{id:1,value:'[]',revision:'fixture-original',updated_at:new Date().toISOString()}];
 const backup={format:'mart-timeweb-recovery-v1',sourceIdentity:'f'.repeat(64),tables};const migrations=fs.readdirSync('migrations').sort().map(n=>fs.readFileSync('migrations/'+n,'utf8'));
 await db.transaction(recoveryQueries(db,backup,target,migrations),{isolationLevel:'Serializable'});
 assert.equal((await db`SELECT revision FROM mart_user_registry`)[0].revision,'fixture-original');
 assert.equal((await db`SELECT COUNT(*)::int AS n FROM pg_tables WHERE schemaname='public'`)[0].n,10);
 await assert.rejects(db.transaction(recoveryQueries(db,backup,target,migrations)),/target_not_empty/);
 await db`INSERT INTO mart_dashboard_archive(archive_key,kind,period_start,period_end,payload) VALUES(${'fixture'},${'dashboard'},${'2026-10-01'},${'2026-10-02'},${'fixture-ciphertext'})`;
 const exported=await exportBackup(db,target.DATABASE_URL);assert.equal(exported.tables.mart_dashboard_archive[0].payload,'fixture-ciphertext');
});
