/* eslint-disable @typescript-eslint/no-require-imports */
// Explicit operator commands. Never print connection strings, ciphertext or raw driver errors.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const crypto = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
require('./lib/operator-env.cjs').operatorEnv();
// Load exactly the application's server modules outside Next's bundler.
const originalLoad = Module._load;
Module._load = function(name, parent, main) {
  if (name === 'server-only') return {};
  if (name.startsWith('@/')) name = path.join(root, name.slice(2));
  return originalLoad.call(this, name, parent, main);
};
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
(async()=>{
const {postgres}=require('./lib/postgres.cjs');
const sql=postgres(process.env.DATABASE_URL);
if(process.argv[2] !== '--apply') throw new Error('Use --apply explicitly after review');
const [connectionsBefore,linksBefore]=await sql.transaction([sql`SELECT id,name,type,enabled,revision,config,status,last_success FROM mart_connections ORDER BY created_at`,sql`SELECT connection_id,section,dataset,definition FROM mart_source_links`]);
fs.mkdirSync('artifacts/source-recovery',{recursive:true});
fs.writeFileSync(`artifacts/source-recovery/connections-${Date.now()}.json`,JSON.stringify({at:new Date().toISOString(),connections:connectionsBefore,links:linksBefore},null,2),{mode:0o600});
const source=fs.readFileSync('migrations/002-multiple-source-links.sql','utf8');
const statements=source.split(';').map(s=>s.trim()).filter(s=>s&&!/^(BEGIN|COMMIT)$/i.test(s));
await sql.transaction(statements.map(s=>sql.query(s,[])));
const store=require('../app/lib/connections/store.ts');
const settings=require('../app/lib/source-settings.ts').getSourceSettings();
let connections=await store.listConnections();
const fin=connections.find(c=>c.type==='fintablo'&&c.enabled);
if(fin&&!fin.bindings.some(b=>b.dataset==='pnl')){
const {secrets}=await store.getConnection(fin.id);
await store.saveConnection({...fin,bindings:[...fin.bindings,{section:'opiu',dataset:'pnl',sheet:'/v1/pnl-item',columns:{},headerRow:1,confirmed:true,mode:'primary',priority:50}]},secrets,fin.id,fin.revision);
}
if(!connections.some(c=>c.type==='debt')) await store.saveConnection({name:'Google Sheets — дебиторка / кредиторка',type:'debt',enabled:true,config:{spreadsheetId:settings.debtGoogleSheetId,debtTransitSheet:settings.debtTransitSheet,debtStockSheet:settings.debtStockSheet},bindings:[]},{serviceAccountEmail:settings.googleServiceAccountEmail,privateKey:settings.googlePrivateKey});
connections=await store.listConnections();
console.log('Migration completed; connections preserved:',connections.map(c=>({type:c.type,bindings:c.bindings.map(b=>b.dataset)})));
const {loadDashboard}=require('../app/lib/load-dashboard.ts');
const result=await loadDashboard(new URLSearchParams({start:'2026-09-01',end:'2026-09-21'}),true);
console.log(JSON.stringify({sources:result.sources,cashRows:result.sections?.cash?.cash.length,pnlRows:result.sections?.opiu?.pnl?.length,debtCents:result.receivables?.current?.totalCents,top:require('../app/lib/receivables.ts').topDebtors(result.receivables.current).length,errors:result.receivables.errors},null,2));
})().catch(e=>{console.error('Recovery failed',e.code||e.name);process.exitCode=1});
