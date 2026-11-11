const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), Module = require('node:module'), ts = require('typescript');
const original = Module._load;
Module._load = function(name, ...rest) { if (name === 'server-only') return {}; return original.call(this, name, ...rest); };
require.extensions['.ts'] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
test('environment Google source preserves order amounts when optional delivery date contains text', async () => {
  const sheets = require('../app/lib/google-sheets.ts');
  const archive = require('../app/lib/source-input-archive.ts');
  const previous = { inspect: sheets.inspectSheets, client: sheets.sheetsClient, input: archive.sourceInput };
  let orderDate = '2026-11-01', revenue = 150;
  sheets.inspectSheets = async () => ({ mapping: [{ valid: true }] });
  sheets.sheetsClient = () => ({ spreadsheets: { values: { batchGet: async () => {
    const order = []; order[0] = orderDate; order[1] = 'test-order'; order[11] = revenue; order[14] = 'Уточняется';
    return { data: { valueRanges: [[], [order], [], [], [], []].map(values => ({ values })) } };
  } } } });
  archive.sourceInput = async (_key, load) => load();
  try {
    const { readGoogleSheets } = require('../app/lib/google-dashboard.ts');
    const settings = { googleEnabled: true, googleSheetId: 'test', cashSheet:'cash', ordersSheet:'orders', debtorSheet:'debt', factorySheet:'factory', walletSheet:'wallet', accountSheet:'account' };
    const report = await readGoogleSheets('2026-11-11', settings);
    assert.equal(report.orders.length, 1);
    assert.equal(report.orders[0].revenue, 150);
    assert.equal(report.orders[0].delivery, '');
    assert.equal(report.orders[0].date, '2026-11-01');
    orderDate = '2026-09-01'; revenue = 'неизвестно';
    assert.equal((await readGoogleSheets('2026-11-11', settings, '2026-10-21')).orders.length, 0);
    await assert.rejects(readGoogleSheets('2026-11-11', settings, '2026-09-01'), /Некорректное число/);
    orderDate = '2026-02-30';
    await assert.rejects(readGoogleSheets('2026-11-11', settings), /Некорректная дата/);
  } finally { sheets.inspectSheets = previous.inspect; sheets.sheetsClient = previous.client; archive.sourceInput = previous.input; }
});
