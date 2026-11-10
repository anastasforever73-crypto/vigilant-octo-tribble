const test=require('node:test'), assert=require('node:assert/strict'), crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {identity,validate,emptySecrets,recoveryQueries,exportBackup,privateWrite}=require('../scripts/timeweb-recovery.cjs');
const source='postgres://source:never-log@ep-original-pooler.example.test/db';
function fixture(){
 const tables=Object.fromEntries(['mart_connections','mart_source_links','mart_source_snapshots','mart_source_runs','mart_dashboard_archive','mart_source_input_archive','mart_wallet_percentage','mart_user_write_lock','mart_login_attempts','mart_user_registry'].map(t=>[t,[]]));
 const hash='scrypt$32768$8$3$'+'a'.repeat(32)+'$'+'b'.repeat(128);
 tables.mart_connections=[{id:crypto.randomUUID(),name:'Test source',type:'googleSheets',enabled:true,revision:2,config:{spreadsheetId:'fixture-sheet'},secrets:'unreadable-old-ciphertext',created_at:'2026-10-01T00:00:00Z'}];
 tables.mart_source_links=[{connection_id:tables.mart_connections[0].id,section:'cash',dataset:'cash',definition:{section:'cash',dataset:'cash',sheet:'Test',columns:{date:0,amount:1},confirmed:true}}];
 tables.mart_source_snapshots=[{payload:'old-source-ciphertext'}];tables.mart_dashboard_archive=[{payload:'old-report-ciphertext'}];tables.mart_source_input_archive=[{payload:'old-input-ciphertext'}];
 tables.mart_user_registry=[{id:1,value:JSON.stringify([{login:'viewer',passwordHash:hash,enabled:true,sections:['debt']}]),revision:'preserve-revision',updated_at:'2026-10-01T00:00:00Z'}];
 return {backup:{format:'mart-timeweb-recovery-v1',sourceIdentity:identity(source),tables}, env:{DATABASE_URL:'postgres://new:never-log@ep-new.example.test/db',CONNECTIONS_ENCRYPTION_KEY:crypto.randomBytes(32).toString('hex'),AUTH_SECRET:crypto.randomBytes(48).toString('hex'),ADMIN_LOGIN:'existing-admin',ADMIN_PASSWORD_HASH:hash,USER_LOGIN:'existing-timeweb-viewer',USER_PASSWORD_HASH:hash}};
}
test('recovery refuses original endpoint and its pooler alias, and preserves account restrictions',()=>{
 const {backup,env}=fixture();
 for(const host of ['ep-original-pooler','ep-original']) assert.throws(()=>validate(backup,{...env,DATABASE_URL:`postgres://different:password@${host}.example.test/db`}),/target_must_be_separate/);
 assert.throws(()=>validate(backup,{...env,ADMIN_LOGIN:'viewer'}),/admin_login_collision/);
 assert.throws(()=>validate(backup,{...env,USER_LOGIN:'viewer',USER_PASSWORD_HASH:'changed'}),/legacy_user_collision/);
 backup.tables.mart_user_registry[0].value=JSON.stringify([{login:'viewer',passwordHash:env.USER_PASSWORD_HASH,enabled:false,sections:['debt']}]);
 assert.throws(()=>validate(backup,{...env,USER_LOGIN:'viewer'}),/legacy_user_collision/);
});
test('import starts with an empty-database guard and never restores unreadable payloads or enabled sources',()=>{
 const {backup,env}=fixture();const sql={query:(text,params=[])=>({text,params})};const migrations=fs.readdirSync('migrations').sort().map(n=>fs.readFileSync(path.join('migrations',n),'utf8'));
 const q=recoveryQueries(sql,backup,env,migrations);assert.match(q[0].text,/target_not_empty/);
 const writes=q.filter(x=>/^INSERT/.test(x.text));assert.ok(writes.length);
 assert.ok(writes.every(x=>!/(?:source_snapshots|dashboard_archive|source_input_archive|source_runs)/.test(x.text)));
 const c=writes.find(x=>x.text.includes('mart_connections'));assert.match(c.text,/false/);assert.equal(c.params[3],3);
 assert.ok(!JSON.stringify(q).includes('unreadable-old-ciphertext'));assert.ok(!JSON.stringify(q).includes('old-report-ciphertext'));
 const [,iv,tag,data]=c.params[6].split('.');const decipher=crypto.createDecipheriv('aes-256-gcm',Buffer.from(env.CONNECTIONS_ENCRYPTION_KEY,'hex'),Buffer.from(iv,'base64'));decipher.setAAD(Buffer.from(backup.tables.mart_connections[0].id));decipher.setAuthTag(Buffer.from(tag,'base64'));assert.equal(Buffer.concat([decipher.update(Buffer.from(data,'base64')),decipher.final()]).toString(),'{}');
 const registry=writes.find(x=>x.text.includes('mart_user_registry'));assert.equal(registry.params[0],backup.tables.mart_user_registry[0].value);assert.equal(registry.params[1],'preserve-revision');
});
test('new empty credentials use authenticated encryption bound to the original connection identity',()=>{
 const key=crypto.randomBytes(32).toString('hex'), encrypted=emptySecrets(key,'source-a');const [,iv,tag,data]=encrypted.split('.');const d=crypto.createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),Buffer.from(iv,'base64'));d.setAAD(Buffer.from('source-b'));d.setAuthTag(Buffer.from(tag,'base64'));assert.throws(()=>Buffer.concat([d.update(Buffer.from(data,'base64')),d.final()]));
});
test('backup uses READ ONLY and aborts if production changes while pages are read',async()=>{
 let captures=0;const transactions=[];const sql={query:(text,params)=>({text,params}),transaction:async(q,opts)=>{
  transactions.push({q,opts});if(q.length===10){captures++;return q.map(x=>x.text.includes('mart_user_registry')?[{value:captures===1?'first':'changed'}]:[]);}throw Error('unexpected');
 }};
 await assert.rejects(exportBackup(sql,source),/source_changed_retry_export/);assert.ok(transactions.every(t=>t.opts.readOnly===true&&t.q.every(q=>q.text.startsWith('SELECT'))));
});
test('private backup cannot overwrite an existing file and has owner-only permissions',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mart-recovery-test-'));const p=path.join(dir,'backup.json');try{privateWrite(p,{fixture:true});assert.equal(fs.statSync(p).mode&0o777,0o600);assert.throws(()=>privateWrite(p,{overwrite:true}));assert.deepEqual(JSON.parse(fs.readFileSync(p)),{fixture:true});}finally{fs.rmSync(dir,{recursive:true});}
});
