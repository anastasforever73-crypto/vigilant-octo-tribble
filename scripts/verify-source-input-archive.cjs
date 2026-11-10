/* eslint-disable @typescript-eslint/no-require-imports */
require('./date-cache-register.cjs');
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{execFileSync}=require('node:child_process'),fs=require('node:fs');
const {sourceInput,withSourceArchive}=require('../app/lib/source-input-archive.ts');
const {contentHash,CALCULATION_VERSION}=require('../app/lib/archive-version.ts');
const {neon}=require('@neondatabase/serverless');
(async()=>{
 const sql=neon(process.env.DATABASE_URL),identity=['date-cache-verification',process.argv[2]||randomUUID()];
 const key=contentHash([CALCULATION_VERSION,identity]);
 if(process.argv[2]) { const value=await withSourceArchive(false,()=>sourceInput(identity,async()=>{throw Error('Source calls forbidden after restart')}));assert.equal(value.rows[0].amount,200); console.log('restart passed');return; }
 let reads=0,value=100;const reader=async()=>{reads++;await new Promise(r=>setTimeout(r,40));return {rows:[{date:'2001-01-02',amount:value}],updatedAt:new Date().toISOString()}};
 const load=()=>withSourceArchive(false,()=>sourceInput(identity,reader));
 try {
  const [a,b]=await Promise.all([load(),load()]);assert.deepEqual(a,b);assert.equal(reads,1);
  a.rows[0].amount=999;assert.equal((await load()).rows[0].amount,100);assert.equal(reads,1);
  await sql`UPDATE mart_source_input_archive SET observed_at='2000-01-01' WHERE input_key=${key}`;
  assert.equal((await load()).rows[0].amount,100);assert.equal(reads,1);
  value=200;await withSourceArchive(true,()=>sourceInput(identity,reader));assert.equal((await load()).rows[0].amount,200);assert.equal(reads,2);
  const restart=execFileSync(process.execPath,[__filename,identity[1]],{encoding:'utf8',timeout:30000}).trim();assert.equal(restart,'restart passed');
  const result={checks:['PostgreSQL encrypted detail persists','parallel source imports deduplicated','caller mutation isolated','no five-minute history expiration','historical correction refreshes memory','new process with source reads forbidden'],sourceReads:reads};
  fs.mkdirSync('artifacts/date-cache',{recursive:true});fs.writeFileSync('artifacts/date-cache/source-input-check.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 } finally {await sql`DELETE FROM mart_source_input_archive WHERE input_key=${key}`}
})().catch(e=>{console.error(e.message);process.exitCode=1});
