/* eslint-disable @typescript-eslint/no-require-imports */
require('./date-cache-register.cjs');
const fs=require('node:fs'),assert=require('node:assert/strict');
const source=require('../app/lib/source-input-archive.ts'),original=source.sourceInput;
let imports=0;source.sourceInput=(identity,load,complete)=>original(identity,async()=>{imports++;throw Error('Unexpected source import during warm period switch');},complete);
const probe=require('../app/lib/archive-source-probe.ts');let probes=0;probe.probeArchiveSources=async()=>{probes++;throw Error('Unexpected source probe')};
const {loadDashboard}=require('../app/lib/load-dashboard.ts');
const {buildLive}=require('../app/lib/live-data.ts');
(async()=>{
 const results=[];
 for(let round=0;round<2;round++)for(const[start,end]of[['2026-08-01','2026-08-31'],['2026-07-01','2026-07-31'],['2026-04-01','2026-06-30'],['2026-01-01','2026-12-31'],['2026-03-12','2026-04-19']]){
  const began=performance.now(),d=await loadDashboard(new URLSearchParams({start,end})),loaded=performance.now();
  const json=JSON.stringify(d),serialized=performance.now();buildLive(d,start,end,true);const calculated=performance.now();
  assert.ok(d.archive.createdAt,'Complete archive required');assert.equal(imports,0);assert.equal(probes,0);
  results.push({round,start,end,loadMs:loaded-began,serializeMs:serialized-loaded,calculationMs:calculated-serialized,bytes:Buffer.byteLength(json),cash:d.cash.length,orders:d.orders.length,mode:d.archive.mode,cacheVersion:d.archive.cacheVersion});
 }
 fs.writeFileSync('artifacts/date-cache/warm-server.json',JSON.stringify({imports,probes,results},null,2));console.log(JSON.stringify({imports,probes,results},null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1});
