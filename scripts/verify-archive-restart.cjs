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
const { archivedLoad } = require('../app/lib/period-archive.ts');
archivedLoad({ kind: process.argv[2], start: '2001-01-01', end: '2001-01-31', load: async () => { throw new Error('Source reads forbidden in restarted process'); }, complete: d => typeof d.value === 'number' }).then(data => console.log(JSON.stringify({ mode: data.archive.mode, createdAt: data.archive.createdAt }))).catch(() => { process.exitCode = 1; });
