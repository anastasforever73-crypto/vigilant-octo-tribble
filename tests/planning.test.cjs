const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { parsePlanRows, summarizePlan, previousPlanPeriod } = require('../app/lib/planning.ts');
const { parseConnection } = require('../app/lib/connections/model.ts');
const { composeConnections } = require('../app/lib/connections/compose.ts');
const { visibleDashboard } = require('../app/lib/dashboard-access.ts');
const { canView } = require('../app/lib/user-access.ts');
const { bindingKey } = require('../app/lib/connections/merge.ts');
const base = { source: '', cash: [], orders: [], debtor: {}, creditor: {}, balances: {} };
const binding = dataset => ({ section: 'plan', dataset, sheet: dataset, headerRow: 1, columns: { date: 0, category: 1, amount: 2 }, headers: { date: 'Дата', category: 'Категория', amount: 'Сумма' }, confirmed: true });
const connection = (dataset, overrides = {}) => ({ name: dataset, type: 'googleSheets', enabled: true, config: { spreadsheetId: 'test' }, bindings: [binding(dataset)], ...overrides });
test('planning mappings require date, category, amount and target planning', () => {
  for (const dataset of ['planReceipts', 'planPayments']) {
    assert.equal(parseConnection(connection(dataset)).bindings[0].section, 'plan');
    const input = connection(dataset); delete input.bindings[0].columns.category;
    assert.throws(() => parseConnection(input), /Категория/);
    const wrong = connection(dataset); wrong.bindings[0].section = 'cash';
    assert.throws(() => parseConnection(wrong), /не поддерживается/);
    assert.throws(() => parseConnection(connection(dataset, { type: 'fintablo' })), /не поддерживается/);
  }
});
test('plans validate source rows, preserve zero and reject missing, negative, invalid data', () => {
  assert.equal(parsePlanRows([{ date: '06.10.2026', category: 'Продажи', amount: '1 234,56' }])[0].amount, 1234.56);
  assert.equal(parsePlanRows([{ date: '2026-10-06', category: 'Продажи', amount: 0 }])[0].amount, 0);
  for (const row of [{ amount: '' }, { amount: -1 }, { amount: 'bad' }, { category: '' }, { date: '2026-02-30' }]) {
    assert.throws(() => parsePlanRows([{ date: '2026-10-06', category: 'Продажи', amount: 1, ...row }]));
  }
});
test('period totals include both boundaries, add cents exactly and group categories', () => {
  const rows = parsePlanRows([
    { date: '2026-09-30', category: 'Продажи', amount: 999 },
    { date: '2026-10-01', category: 'Продажи', amount: 0.1 },
    { date: '2026-10-31', category: 'Продажи', amount: 0.2 },
    { date: '2026-10-15', category: 'Прочие', amount: 5 },
    { date: '2026-11-01', category: 'Продажи', amount: 999 },
  ]);
  const summary = summarizePlan(rows, '2026-10-01', '2026-10-31');
  assert.equal(summary.total, 5.3); assert.equal(summary.count, 3);
  assert.equal(summary.categories.find(r => r.category === 'Продажи').amount, 0.3);
  assert.equal(summarizePlan(rows, '2027-01-01', '2027-01-01').total, 0);
  assert.deepEqual(previousPlanPeriod('2026-10-01', '2026-10-31'), { start: '2026-08-31', end: '2026-09-30' });
});
test('source composition keeps plans separate and distinguishes missing from empty', () => {
  const receipts = connection('planReceipts', { id: 'income', status: 'connected' });
  const payments = connection('planPayments', { id: 'expenses', status: 'connected' });
  const rows = parsePlanRows([{ date: '2026-10-06', category: 'Продажи', amount: 100 }]);
  const data = composeConnections(base, [receipts, payments], new Map([
    ['income', { byBinding: { [bindingKey(receipts.bindings[0])]: rows } }], ['expenses', { planPayments: [] }],
  ]));
  assert.deepEqual(data.sections.plan.planReceipts, rows);
  assert.deepEqual(data.sections.plan.planPayments, []);
  assert.equal(composeConnections(base, [receipts], new Map()).sections.plan.planReceipts, undefined);
  const partial = composeConnections(base, [receipts, connection('planReceipts', { id: 'other', status: 'sync_error', bindings: [{ ...binding('planReceipts'), mode: 'merge' }] })], new Map());
  assert.equal(partial.sections.plan.planReceipts, undefined);
});
test('planning has independent access; viewer payload exposes only permitted plan fields', () => {
  assert.equal(canView({ role: 'user', sections: ['plan'] }, 'plan'), true);
  assert.equal(canView({ role: 'user', sections: ['opiu'] }, 'plan'), false);
  const rows = parsePlanRows([{ date: '2026-10-06', category: 'Продажи', amount: 100 }]);
  const data = { ...base, sections: { plan: { ...base, planReceipts: rows, planPayments: [], cash: [{ sensitive: true }] } } };
  const visible = visibleDashboard(data, { role: 'user', sections: ['plan'] });
  assert.deepEqual(visible.sections.plan.planReceipts, rows);
  assert.deepEqual(visible.sections.plan.cash, []);
  assert.equal(visibleDashboard(data, { role: 'user', sections: ['cash'] }).sections.plan, undefined);
});
require.extensions['.tsx'] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, file);
require.extensions['.css'] = () => {};
test('planning renders totals, categories, comparison, missing and loading states', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const Panel = require('../app/planning-panel.tsx').default;
  const props = { start: '2026-10-01', end: '2026-10-31', compare: true, loading: false, canConfigure: true, onConfigure() {} };
  const rows = parsePlanRows([{ date: '2026-10-06', category: 'Продажи', amount: 100 }]);
  const render = data => renderToStaticMarkup(React.createElement(Panel, { ...props, data }));
  const complete = render({ ...base, planReceipts: rows, planPayments: [], plannedBalance: { value: 150 } });
  assert.match(complete, /Продажи/); assert.match(complete, /100,00 ₽/);
  assert.match(complete, /Плановый денежный поток/); assert.match(complete, /Предыдущий период/);
  assert.doesNotMatch(complete, /Нет данных/);
  const missing = render({ ...base, planReceipts: rows });
  assert.match(missing, /Нет данных/); assert.match(missing, /Настроить источники планов/);
  const loading = renderToStaticMarkup(React.createElement(Panel, { ...props, data: base, loading: true }));
  assert.match(loading, /Загружаем планы/); assert.doesNotMatch(loading, /не подключён/);
});
test('Google Sheets adapter loads both plan datasets with mappings and inclusive period filtering', async () => {
  const Module = require('node:module');
  const originalLoad = Module._load;
  Module._load = function(name, parent, main) {
    if (name === 'server-only') return {};
    if (name.startsWith('@/')) name = require('node:path').join(process.cwd(), name.slice(2));
    if (name === '../source-input-archive') return { sourceInput: async (_key, read) => read() };
    return originalLoad.call(this, name, parent, main);
  };
  try {
    const sheets = require('../app/lib/google-sheets.ts');
    const original = { discoverSheets: sheets.discoverSheets, sheetsClient: sheets.sheetsClient };
    sheets.discoverSheets = async () => ({ headers: [{ index: 0, label: 'Дата' }, { index: 1, label: 'Категория' }, { index: 2, label: 'Сумма' }] });
    sheets.sheetsClient = () => ({ spreadsheets: { values: { get: async ({ range }) => ({ data: { values: range.includes('planReceipts') ? [['2026-09-30', 'До периода', 999], ['2026-10-01', 'Продажи', 100], ['2026-10-31', 'Продажи', 200], ['2026-11-01', 'После периода', 999]] : [['2026-10-15', 'Аренда', 50]] } }) } } });
    try {
      const { adapters } = require('../app/lib/connections/adapters.ts');
      const c = connection('planReceipts', { bindings: [binding('planReceipts'), binding('planPayments')] });
      const data = await adapters.googleSheets.read(c, {}, '2026-10-01', '2026-10-31');
      assert.equal(data.planReceipts.length, 2);
      assert.equal(summarizePlan(data.planReceipts, '2026-10-01', '2026-10-31').total, 300);
      assert.equal(data.planPayments[0].category, 'Аренда');
      assert.equal(data.byBinding[bindingKey(c.bindings[1])][0].amount, 50);
    } finally { Object.assign(sheets, original); }
  } finally { Module._load = originalLoad; }
});
const { parseNlpkPayables, nlpkTotal } = require('../app/lib/nlpk-payables.ts');
const { planningSummary, operationalBalance, withPlanningIndicators } = require('../app/lib/planning-indicators.ts');
test('operational balance uses current funds plus selected plans with cents and missing-source semantics', () => {
  const plan = { start: '2026-10-01', end: '2026-10-31', receipts: 100.1, payments: 20.2, net: 79.9, daily: [] };
  assert.equal(operationalBalance({ value: 50.3, date: '2026-10-06' }, plan).value, 130.2);
  assert.equal(operationalBalance({ value: 0 }, { ...plan, receipts: 0, payments: 0 }).value, 0);
  assert.equal(operationalBalance({ value: 0 }, { ...plan, receipts: 0, payments: 100 }).value, -100);
  assert.equal(operationalBalance({ value: 100 }, { ...plan, receipts: null }).value, null);
  assert.equal(operationalBalance({ value: null }, plan).value, null);
  const rows = parsePlanRows([{ date: '2026-09-01', category: 'До периода', amount: 10000 }, { date: '2026-10-06', category: 'Продажи', amount: 100 }]);
  const data = { ...base, operational: { total: { value: 500, date: '2026-10-06' } }, sections: { plan: { ...base, planReceipts: rows, planPayments: [] } } };
  const derived = withPlanningIndicators(data, '2026-10-01', '2026-10-31');
  assert.equal(derived.operational.operationalBalance.value, 600);
  assert.equal(derived.planningSummary.receipts, 100);
  assert.deepEqual(derived.operational.planningMonths, [{ month: '2026-10', receipts: 100, payments: 0 }]);
  assert.equal(data.operational.operationalBalance, undefined);
  assert.equal(planningSummary(base, '2026-10-01', '2026-10-31').receipts, null);
});
test('NLПК uses latest complete snapshot before end, keeps zero and does not add history', () => {
  const rows = [{ date: '2026-09-30', balance: 1000 }, { date: '2026-10-06', balance: '200,10', document: 'A' }, { date: '2026-10-06', balance: 50.2, document: 'B' }, { date: '2026-11-01', balance: 999 }];
  const current = parseNlpkPayables(rows, '2026-10-31');
  assert.equal(current.length, 2); assert.equal(nlpkTotal(current), 250.3);
  assert.equal(nlpkTotal(parseNlpkPayables([{ date: '2026-10-01', balance: 0 }], '2026-10-31')), 0);
  assert.equal(nlpkTotal(parseNlpkPayables(rows, '2026-09-01')), null);
  assert.throws(() => parseNlpkPayables([{ date: '2026-10-01', balance: '' }], '2026-10-31'));
  const input = connection('nlpkPayables', { bindings: [{ ...binding('nlpkPayables'), section: 'overview', columns: { date: 0, balance: 1 }, headers: { date: 'Дата', balance: 'Остаток' } }] });
  assert.equal(parseConnection(input).bindings[0].section, 'overview');
  const { conflictIssues } = require('../app/lib/connections/model.ts');
  assert.ok(conflictIssues([{ ...input, bindings: [{ ...input.bindings[0], mode: 'merge' }] }]).length);
});
test('NLПК appears in operational KPI and debt allowlist but never leaks plan details', () => {
  const rows = parseNlpkPayables([{ date: '2026-10-06', balance: 120, document: 'A' }], '2026-10-31');
  const input = { ...base, operational: { total: { value: 10 } }, sections: { overview: { ...base, nlpkPayables: rows, nlpkConfigured: true }, plan: { ...base, planReceipts: [], planPayments: [] } } };
  const data = withPlanningIndicators(input, '2026-10-01', '2026-10-31');
  assert.equal(data.operational.payables.value, 120);
  const overview = visibleDashboard(data, { role: 'user', sections: ['overview'] });
  assert.equal(overview.operational.operationalBalance.value, 10);
  assert.equal(overview.sections.plan, undefined); assert.equal(overview.nlpkPayables, undefined);
  const debt = visibleDashboard(data, { role: 'user', sections: ['debt'] });
  assert.deepEqual(debt.sections.debt.nlpkPayables, rows);
  assert.equal(debt.sections.debt.creditor.factory, 120);
  const cash = visibleDashboard(data, { role: 'user', sections: ['cash'] });
  assert.equal(cash.sections.cash.planningSummary.receipts, 0);
  assert.equal(cash.sections.cash.planReceipts, undefined);
  const missing = withPlanningIndicators({ ...input, sections: { overview: { ...base, nlpkConfigured: true } } }, '2026-10-01', '2026-10-31');
  assert.equal(missing.operational.payables.value, null);
});
test('Excel plans, operational balance and NLПК roundtrip as numeric amounts', async () => {
  const { dashboardReport, writeExcel, RUB } = require('../app/lib/excel-report.ts');
  const ExcelJS = require('exceljs');
  const receiptRows = parsePlanRows([{ date: '2026-10-01', category: 'Продажи', amount: 100.1 }, { date: '2026-09-01', category: 'Продажи', amount: 40 }]);
  const paymentRows = parsePlanRows([{ date: '2026-10-15', category: 'Аренда', amount: 20.2 }]);
  const nlpk = parseNlpkPayables([{ date: '2026-10-06', balance: 250.3, document: 'A' }], '2026-10-31');
  const data = withPlanningIndicators({ ...base, operational: { total: { value: 50.3 } }, sections: { plan: { ...base, planReceipts: receiptRows, planPayments: paymentRows }, debt: { ...base, nlpkPayables: nlpk, nlpkConfigured: true } } }, '2026-10-01', '2026-10-31');
  const options = { section: 'plan', start: '2026-10-01', end: '2026-10-31', compare: true };
  const plan = dashboardReport(data, options);
  assert.equal(plan.tables[0].rows[0][1], 100.1); assert.equal(plan.tables[0].rows[0][2], 40);
  assert.equal(plan.tables[0].rows[2][1], 79.9);
  const overview = dashboardReport(data, { ...options, section: 'overview' });
  assert.equal(overview.tables[0].rows.find(r => r[0] === 'Оперативный остаток'), undefined);
  assert.equal(plan.tables.find(t => t.title === 'Плановый остаток денежных средств').rows[0][1], 130.2);
  const debt = dashboardReport(data, { ...options, section: 'debt' });
  assert.equal(debt.details.find(t => t.title === 'Кредиторская задолженность НЛПК').rows[0][3], 250.3);
  for (const report of [plan, overview, debt]) {
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await writeExcel(report));
    assert.equal(workbook.worksheets.length, 2);
    let count = 0;
    workbook.worksheets.forEach(sheet => sheet.eachRow(row => row.eachCell(cell => { if ([100.1, 130.2, 250.3].includes(cell.value)) { assert.equal(cell.numFmt, RUB); count++; } })));
    assert.ok(count > 0);
  }
});
test('period coverage cannot reuse an operational forecast or plan totals for another start date', () => {
  const { coveredDashboard } = require('../app/lib/dashboard-query-cache.ts');
  const data = { ...base, period: { start: '2026-10-01', end: '2026-10-31', comparisonStart: '2026-08-31' }, planningSummary: { start: '2026-10-01', end: '2026-10-31', receipts: 100, payments: 20 } };
  assert.equal(coveredDashboard(data, '2026-10-15', '2026-10-31'), undefined);
  assert.equal(coveredDashboard({ ...data, planningSummary: undefined, operational: { planningPeriod: { start: '2026-10-01', end: '2026-10-31' } } }, '2026-10-15', '2026-10-31'), undefined);
});
test('operational UI and Excel contain facts; planning UI and Excel own plans and forecast',()=>{
  const React=require('react'), {renderToStaticMarkup}=require('react-dom/server');
  const {dashboardReport}=require('../app/lib/excel-report.ts');
  const input=withPlanningIndicators({...base, operational:{total:{value:500,date:'2026-10-06'},payables:{value:100}},sections:{plan:{...base,planReceipts:[{date:'2026-10-06',category:'Продажи',amount:100}],planPayments:[]}}},'2026-10-01','2026-10-31');
  const Operational=require('../app/operational-panel.tsx').default;
  const Planning=require('../app/planning-panel.tsx').default;
  const fact=renderToStaticMarkup(React.createElement(Operational,{data:input.operational}));
  assert.match(fact,/Общий остаток денежных средств/);
  assert.doesNotMatch(fact,/План поступлений|План списаний|План движения|Оперативный остаток|С учётом планов/);
  const plan=renderToStaticMarkup(React.createElement(Planning,{data:input.sections.plan,start:'2026-10-01',end:'2026-10-31',compare:false,loading:false,canConfigure:false,onConfigure(){}}));
  assert.match(plan,/Плановый остаток денежных средств/);assert.match(plan,/План движения денег по месяцам/);
  const visible=visibleDashboard(input,{role:'user',sections:['plan']});
  assert.equal(visible.sections.plan.plannedBalance.value,600);assert.equal(visible.operational,undefined);
  const report=dashboardReport(input,{section:'overview',start:'2026-10-01',end:'2026-10-31',compare:false});
  assert.doesNotMatch(JSON.stringify(report),/План поступлений|План списаний|Оперативный остаток/);
});
