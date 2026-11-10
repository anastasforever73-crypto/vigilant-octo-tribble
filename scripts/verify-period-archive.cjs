/* eslint-disable @typescript-eslint/no-require-imports */
// Read actual sources without editing them. Only the new archive is written.
const fs = require('node:fs'), Module = require('node:module'), ts = require('typescript');
const assert = require('node:assert/strict');
require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const original = Module._load;
Module._load = function(name, parent, main) {
  if (name === 'server-only') return {};
  if (name.startsWith('@/')) name = require('node:path').join(process.cwd(), name.slice(2));
  return original.call(this, name, parent, main);
};
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, f);
const { readOpiu } = require('../app/lib/read-opiu.ts');
const { loadDashboard } = require('../app/lib/load-dashboard.ts');
const { archiveStatus } = require('../app/lib/period-archive.ts');
async function check(name, load) {
  const t = performance.now(), normal = await load(true), t1 = performance.now(), cached = await load(false), t2 = performance.now();
  const { archive: a, ...first } = normal, { archive: b, ...second } = cached;
  if (b.mode === 'archive') assert.deepEqual(JSON.parse(JSON.stringify(first)), second);
  return { name, normalMs: Math.round(t1 - t), secondMs: Math.round(t2 - t1), mode: b.mode, equal: b.mode === 'archive', message: a.message, sources: normal.sources ? Object.values(normal.sources).map(s => ({ available: s.available, status: s.status })) : undefined };
}
(async () => {
  const results = [];
  for (const [name, load] of [ ['opiu', force => readOpiu(force)], ['dashboard', force => loadDashboard(new URLSearchParams({ start: '2026-08-01', end: '2026-08-31' }), force, false)] ]) {
    try { results.push(await check(name, load)); } catch { results.push({ name, error: 'Проверка источника или равенства не прошла' }); }
  }
  const entries = await archiveStatus();
  const report = { checkedAt: new Date().toISOString(), results, archiveEntries: entries.length };
  fs.mkdirSync('artifacts/period-archive', { recursive: true });
  fs.writeFileSync('artifacts/period-archive/live-check.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch(() => { console.error('Проверка недоступна: проверьте сеть и хранилище.'); process.exitCode = 1; });
