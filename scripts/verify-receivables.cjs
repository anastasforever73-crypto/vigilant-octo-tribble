/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS verification of server modules. */
// Read-only verification. Never prints credentials, workbook IDs or debtor names.
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
require('@next/env').loadEnvConfig(process.cwd());
const original = Module._load;
Module._load = function(name, parent, main) { if (name === 'server-only') return {}; return original.call(this, name, parent, main); };
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
(async () => {
  const { readReceivables } = require('../app/lib/read-receivables.ts');
  const report = await readReceivables();
  const summary = { checkedAt: new Date().toISOString(), asOf: report.asOf, complete: Boolean(report.current && !report.current.partial), partial: report.current?.partial ?? false, configurationError: report.configurationError, errors: report.errors, totalCents: report.current?.totalCents, sources: Object.fromEntries(Object.entries(report.sources).map(([source, data]) => [source, { complete: data.complete, headerRow: data.headerRow, totalCents: data.totalCents, advancesCents: data.advancesCents, categories: data.categories, detailRows: data.details.length, excludedRows: data.excludedRows.length, weeklyShipmentCents: data.weeklyShipmentCents, diagnostics: data.diagnostics }])), archive: { status: report.archive.status, message: report.archive.message, snapshots: report.archive.snapshots.length, diagnostics: report.archive.diagnostics } };
  fs.mkdirSync('artifacts/verification', { recursive: true });
  fs.writeFileSync('artifacts/verification/receivables-source-check.json', JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
})().catch(() => { console.error('Проверка источника не завершена; детали с реквизитами не выводятся.'); process.exitCode = 1; });
