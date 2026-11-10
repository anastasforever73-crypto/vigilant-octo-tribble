const test=require('node:test'),assert=require('node:assert/strict');
const {poolConfig,makeSql}=require('../scripts/lib/postgres.cjs');
const url='postgres://test-user:test-pass@db.example.test/reporting?sslmode=require';
test('TLS always verifies the CA and hostname; disabling is restricted to loopback tests',()=>{
 const config=poolConfig(url,{},{});assert.equal(config.ssl.rejectUnauthorized,true);assert.equal(config.ssl.servername,'db.example.test');assert.equal(config.host,'db.example.test');assert.ok(!config.connectionString);
 assert.throws(()=>poolConfig(url,{}, {DATABASE_SSL_MODE:'disable'}),/configuration/);
 assert.throws(()=>poolConfig(url.replace('require','no-verify'),{},{}),/configuration/);
 assert.throws(()=>poolConfig(url,{}, {DATABASE_SSL_CA:'not-a-certificate'}),/configuration/);
 const privateConfig=poolConfig(url,{}, {DATABASE_HOSTADDR:'10.2.0.5',DATABASE_TLS_SERVERNAME:'db.example.test'});
 assert.equal(privateConfig.host,'10.2.0.5');assert.equal(privateConfig.ssl.servername,'db.example.test');assert.equal(privateConfig.ssl.rejectUnauthorized,true);
 assert.equal(poolConfig('postgres://test:test@127.0.0.1/test?sslmode=disable',{},{}).ssl,false);
});
test('tagged queries remain lazy and put malicious text only into bound values',async()=>{
 const calls=[];const sql=makeSql({query:async(text,values)=>(calls.push({text,values}),{rows:[{ok:true}]})});
 const malicious="'; DROP TABLE mart_user_registry;--";const query=sql`SELECT ${malicious}::text AS value,${42}::int AS n`;
 assert.equal(calls.length,0);assert.deepEqual(await query,[{ok:true}]);assert.equal(calls[0].text,'SELECT $1::text AS value,$2::int AS n');assert.deepEqual(calls[0].values,[malicious,42]);await query;assert.equal(calls.length,1);
});
test('transactions pin one client, enforce isolation/read-only and do not start queries on the pool',async()=>{
 const calls=[];const client={query:async(text,values)=>(calls.push({text,values}),{rows:text.startsWith('SELECT')?[{ok:true}]:[]}),release:value=>calls.push({release:value})};
 const sql=makeSql({query:()=>{throw Error('pool query inside transaction');},connect:async()=>client});
 const queries=[sql`SELECT ${1}`,sql`SELECT ${2}`];assert.deepEqual(await sql.transaction(queries,{isolationLevel:'Serializable',readOnly:true,deferrable:true}),[[{ok:true}],[{ok:true}]]);
 assert.equal(calls[0].text,'BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE');assert.equal(calls.at(-2).text,'COMMIT');assert.deepEqual(calls.at(-1),{release:false});await assert.rejects(Promise.resolve(queries[0]),/configuration/);
});
test('failed transactions roll back before release and discard connections if rollback fails',async()=>{
 for(const failRollback of [false,true]){
 const calls=[];const client={query:async text=>{calls.push(text);if(text.startsWith('INSERT')||failRollback&&text==='ROLLBACK')throw Error('fixture failure');return {rows:[]};},release:value=>calls.push({release:value})};
 const sql=makeSql({connect:async()=>client});await assert.rejects(sql.transaction([sql`INSERT INTO test VALUES(${1})`]),/fixture failure/);assert.equal(calls.at(-2),'ROLLBACK');assert.deepEqual(calls.at(-1),{release:failRollback});assert.ok(!calls.includes('COMMIT'));
 }
});
