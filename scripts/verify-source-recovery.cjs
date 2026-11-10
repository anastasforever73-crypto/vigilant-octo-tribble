/* eslint-disable @typescript-eslint/no-require-imports */
// Explicit operator commands. Never print connection strings, ciphertext or raw driver errors.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const crypto = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
require('@next/env').loadEnvConfig(root, false, { info() {}, error() { console.error('Не удалось прочитать файл окружения. Проверьте синтаксис локально.'); } });
// Load exactly the application's server modules outside Next's bundler.
const originalLoad = Module._load;
Module._load = function(name, parent, main) {
  if (name === 'server-only') return {};
  if (name.startsWith('@/')) name = path.join(root, name.slice(2));
  return originalLoad.call(this, name, parent, main);
};
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
(async()=>{
const store=require('../app/lib/connections/store.ts');
const settings=require('../app/lib/source-settings.ts').getSourceSettings();
if(process.argv.includes('--restore-sheet-names')) {
 const c=(await store.listConnections()).find(c=>c.type==='debt'&&c.enabled);
 const {secrets}=await store.getConnection(c.id);
 await store.saveConnection({...c,config:{...c.config,debtTransitSheet:settings.debtTransitSheet,debtStockSheet:settings.debtStockSheet}},secrets,c.id,c.revision);
}
// Emulate production's database-only Google settings in this process; never edit env files.
for(const key of ['GOOGLE_SERVICE_ACCOUNT_EMAIL','GOOGLE_PRIVATE_KEY','DEBT_GOOGLE_SHEET_ID','DEBT_TRANSIT_SHEET','DEBT_STOCK_SHEET']) delete process.env[key];
const r=await require('../app/lib/read-receivables.ts').readReceivables();
if(!r.current||r.current.partial) throw new Error('Incomplete receivables');
console.log(JSON.stringify({databaseOnly:true,sheets:r.sourceSheets,totalCents:r.current.totalCents,top:require('../app/lib/receivables.ts').topDebtors(r.current).length,errors:r.errors}));
})().catch(()=>{console.error('Source verification failed');process.exitCode=1});
