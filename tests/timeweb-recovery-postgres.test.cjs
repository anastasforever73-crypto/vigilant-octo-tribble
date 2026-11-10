// Optional local integration suite. No network or production credentials are used.
// MART_PGLITE_MODULE points to @electric-sql/pglite installed in a temporary directory.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {PGlite}=require(process.env.MART_PGLITE_MODULE || '@electric-sql/pglite');
const {identity,recoveryQueries,exportBackup}=require('../scripts/timeweb-recovery.cjs');
const migrations=fs.readdirSync('migrations').filter(n=>n.endsWith('.sql')).sort().map(n=>fs.readFileSync('migrations/'+n,'utf8'));
function adapter(db){return {query:(text,params=[])=>({text,params}),transaction:(q,options={})=>db.transaction(async tx=>{
 if(options.readOnly)await tx.query('SET TRANSACTION READ ONLY');
 const result=[];for(const query of q)result.push((await tx.query(query.text,query.params)).rows);return result;
})};}
function fixture(){
 const tables=Object.fromEntries(['mart_connections','mart_source_links','mart_source_snapshots','mart_source_runs','mart_dashboard_archive','mart_source_input_archive','mart_wallet_percentage','mart_user_write_lock','mart_login_attempts','mart_user_registry'].map(t=>[t,[]]));
 const id=crypto.randomUUID(),hash='scrypt$32768$8$3$'+'a'.repeat(32)+'$'+'b'.repeat(128),now=new Date().toISOString();
 tables.mart_connections=[{id,name:'Fixture',type:'googleSheets',revision:2,config:{spreadsheetId:'fixture-id'},created_at:now}];
 tables.mart_source_links=[{connection_id:id,section:'cash',dataset:'cash',definition:{section:'cash',dataset:'cash',sheet:'fixture',confirmed:true}}];
 tables.mart_wallet_percentage=[{effective_from:'2026-10-01',percent:17,updated_at:now}];
 tables.mart_user_registry=[{id:1,value:JSON.stringify([{login:'restricted',passwordHash:hash,enabled:true,sections:['debt']}]),revision:'original-revision',updated_at:now}];
 return {backup:{format:'mart-timeweb-recovery-v1',sourceIdentity:identity('postgres://s:p@source.test/db'),tables},env:{DATABASE_URL:'postgres://t:p@target.test/db',AUTH_SECRET:'a'.repeat(96),ADMIN_LOGIN:'admin',ADMIN_PASSWORD_HASH:hash,CONNECTIONS_ENCRYPTION_KEY:crypto.randomBytes(32).toString('hex')}};
}
test('actual PostgreSQL applies all migrations and restricted users, rejects nonempty targets, and exports through READ ONLY',async()=>{
 const db=new PGlite();try{
 const {backup,env}=fixture(),sql=adapter(db);
 await sql.transaction(recoveryQueries(sql,backup,env,migrations));
 assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM mart_connections WHERE enabled=true')).rows[0].n,0);
 assert.equal((await db.query('SELECT value FROM mart_user_registry')).rows[0].value,backup.tables.mart_user_registry[0].value);
 assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM mart_dashboard_archive')).rows[0].n,0);
 assert.equal((await db.query('SELECT percent FROM mart_wallet_percentage')).rows[0].percent,'17.00');
 await db.query("INSERT INTO mart_dashboard_archive(archive_key,kind,period_start,period_end,payload) VALUES('cash:fixture','cash','2026-10-01','2026-10-02','fixture-ciphertext')");
 const exported=await exportBackup(sql,env.DATABASE_URL);
 assert.equal(exported.tables.mart_dashboard_archive[0].payload,'fixture-ciphertext');
 assert.equal(exported.tables.mart_connections.length,1);
 await assert.rejects(sql.transaction(recoveryQueries(sql,backup,env,migrations)),/target_not_empty/);
 assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM mart_connections')).rows[0].n,1);
 }finally{await db.close();}
});
test('actual PostgreSQL rolls back schema and restored rows on any import failure',async()=>{
 const db=new PGlite();try{
 const {backup,env}=fixture();backup.tables.mart_wallet_percentage[0].percent=101;
 await assert.rejects(adapter(db).transaction(recoveryQueries(adapter(db),backup,env,migrations)));
 assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM pg_tables WHERE schemaname='public'")).rows[0].n,0);
 }finally{await db.close();}
});
