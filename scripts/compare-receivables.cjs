/* eslint-disable @typescript-eslint/no-require-imports -- Read-only standalone verification. */
const fs = require('node:fs');
const vm = require('node:vm');
const Module = require('node:module');
const ts = require('typescript');
process.env.TZ = 'Europe/Moscow';
require('@next/env').loadEnvConfig(process.cwd());
const load = Module._load;
Module._load = function(name, parent, main) { return name === 'server-only' ? {} : load.call(this, name, parent, main); };
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);

async function main() {
  const r = require('../app/lib/receivables.ts');
  const { getSourceSettings, debtSourceSheets } = require('../app/lib/source-settings.ts');
  const { sheetsClient, spreadsheetId } = require('../app/lib/google-sheets.ts');
  const snapshotPath = process.argv[2];
  if (!snapshotPath?.startsWith('/tmp/')) throw new Error('Use a private snapshot path under /tmp');
  let snapshot;
  if (fs.existsSync(snapshotPath)) snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  else {
    const settings = getSourceSettings(), mapping = debtSourceSheets(settings);
    const response = await sheetsClient(settings).spreadsheets.values.batchGet({ spreadsheetId: spreadsheetId(settings.debtGoogleSheetId), ranges: r.debtSources.map(source => `'${mapping[source].replace(/'/g, "''")}'`), valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' }, { timeout: 30000, retry: false });
    snapshot = { asOf: r.moscowToday(), capturedAt: new Date().toISOString(), mapping, rows: Object.fromEntries(r.debtSources.map((source, i) => [source, response.data.valueRanges[i].values || []])) };
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot), { mode: 0o600, flag: 'wx' });
  }
  const script = vm.createContext({ Date });
  vm.runInContext(fs.readFileSync('scripts/Otchet_DZ.gs', 'utf8'), script, { timeout: 1000 });
  const date = iso => new Date(iso + 'T00:00:00+03:00');
  const week = r.reportWeek(snapshot.asOf);
  const report = { asOf: snapshot.asOf, capturedAt: snapshot.capturedAt, snapshotSha256: require('node:crypto').createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'), week, sources: {} };
  for (const source of r.debtSources) {
    const rows = snapshot.rows[source], cfg = script.CONFIG.SOURCES.find(s => s.key === source);
    const expected = script.collectSource(rows, cfg, date(snapshot.asOf), date(week.start), date(week.end));
    const actual = r.collectReceivables(rows, source, snapshot.asOf);
    const expectedCents = { total: r.cents(expected.total), advances: r.cents(expected.advance), shipment: r.cents(expected.shipment), ...Object.fromEntries(r.debtCategories.map(c => [c, r.cents(expected.buckets[c])])) };
    const actualCents = { total: actual.totalCents, advances: actual.advancesCents, shipment: actual.weeklyShipmentCents, ...actual.categories };
    const names = r.sourceColumns[source], headers = r.findHeaders(rows, Object.values(names), cfg.headerRow);
    let blankMappedRows = 0, adjacentOnlyRows = 0;
    const totalLikeRows = [], ignoredRows = new Set();
    rows.slice(headers.rowIndex + 1).forEach((row, index) => {
      const mapped = Object.values(names).map(n => row[headers.columns[n]]);
      if (!mapped.some(v => String(v ?? '').trim())) {
        blankMappedRows++;
        ignoredRows.add(headers.rowIndex + index + 2);
        if (row.some(v => String(v ?? '').trim())) adjacentOnlyRows++;
      }
      if (row.some(v => typeof v === 'string' && /^(итого|всего|общий итог)(?:\s|:|$)/i.test(v.trim()))) {
        const d = script.toDate(row[headers.columns[names.date]]), b = script.toNumber(row[headers.columns[names.balance]]);
        totalLikeRows.push({ row: headers.rowIndex + index + 2, debtCents: r.cents(b), entersDebt: Boolean(b && d && d <= date(snapshot.asOf)) });
      }
    });
    const ignoredRowsReported = actual.excludedRows.filter(row => ignoredRows.has(row.row)).length;
    report.sources[snapshot.mapping[source]] = { headerRow: actual.headerRow, lastUsedRow: rows.length, columns: Object.fromEntries(Object.entries(names).map(([key, name]) => [key, headers.columns[name] + 1])), blankMappedRows, adjacentOnlyRows, ignoredRowsReported, totalLikeRows, scriptCents: expectedCents, dashboardCents: actualCents, deltaCents: Object.fromEntries(Object.keys(expectedCents).map(key => [key, actualCents[key] - expectedCents[key]])), scriptWarnings: Array.from(expected.warnings), diagnostics: actual.diagnostics, excludedCount: actual.excludedRows.length, complete: actual.complete };
  }
  fs.mkdirSync('artifacts/verification', { recursive: true });
  fs.writeFileSync('artifacts/verification/receivables-parity.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (Object.values(report.sources).some(s => !s.complete || s.ignoredRowsReported || Object.values(s.deltaCents).some(delta => delta !== 0))) process.exitCode = 1;
}
main().catch(() => { console.error('Read-only comparison failed; raw errors omitted to protect credentials.'); process.exitCode = 1; });
