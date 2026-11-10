import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, randomInt, scryptSync } from 'node:crypto';
import { cpSync, symlinkSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const binary = process.env.AGENT_BROWSER_BIN;
if (!binary) throw Error('AGENT_BROWSER_BIN is required');
const root = mkdtempSync(join(tmpdir(), 'planning-reference-'));
const login = randomBytes(12).toString('hex'), pin = String(randomInt(10000)).padStart(4, '0'), salt = randomBytes(16);
const hash = `scrypt$32768$8$3$${salt.toString('hex')}$${scryptSync(pin, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }).toString('hex')}`;
for (const name of ['app', 'public', 'proxy.ts', 'package.json', 'tsconfig.json', 'next.config.ts', 'next-env.d.ts', 'postcss.config.mjs', 'shadcn-tailwind-4.13.0.css']) cpSync(join(process.cwd(), name), join(root, name), { recursive: true });
symlinkSync(join(process.cwd(), 'node_modules'), join(root, 'node_modules'), 'dir');
writeFileSync(join(root, '.env.local'), 'ADMIN_PASSWORD_HASH=\nUSER_PASSWORD_HASH=\n', { mode: 0o600 });
// Synthetic fixtures in a disposable checkout; no real credentials, source reads or source writes.
writeFileSync(join(root, 'app/lib/load-dashboard.ts'), `
import { withPlanningIndicators } from './planning-indicators';
import { period } from './source-values';
import type { DashboardData } from './dashboard-data';
export function dashboardArchiveSpec() { return { kind: 'dashboard', start: 'all', end: 'all', load: async () => ({}) }; }
export async function loadDashboard(params: URLSearchParams) {
 const p = period(params), metric = (value: number) => ({ value, reason: 'Контрольные данные проверки', source: 'Тестовая фикстура', date: '2026-10-06' });
 const base: DashboardData = { source: 'fixture', updatedAt: '2026-10-06T10:00:00Z', cash: [{ date: '2026-10-01', amount: 300000, article: 'Выручка', flow: 'Поступление', source: 'Счёт', counterparty: 'Покупатель' }, { date: '2026-10-05', amount: -100000, article: 'Аренда', flow: 'Выбытие', source: 'Счёт', counterparty: 'Арендодатель' }], orders: [], debtor: {}, creditor: {}, balances: { account: 1000000, wallet: 200000 }, fields: { cash: true, orders: false, balances: true }, period: p, sources: { fixture: { name: 'Контрольная фикстура', configured: true, available: true, status: 'connected', freshness: 'Тест' } }, operational: { day: '2026-10-05', account: metric(1000000), wallet: metric(200000), deposit: metric(0), total: metric(1200000), debt: metric(900000), payables: metric(0), shipments: metric(600000), receipts: metric(300000) } };
 base.sections = { plan: { ...base, planReceipts: [{ date: '2026-10-01', category: 'Выручка', amount: 500000, counterparty: 'Покупатель', note: 'Контрольный план' }], planPayments: [{ date: '2026-10-05', category: 'Аренда', amount: 200000, counterparty: 'Арендодатель', note: 'Контрольный план' }] }, overview: { ...base, nlpkConfigured: true, nlpkPayables: [{ date: '2026-10-06', balance: 250000, document: 'НЛПК-001', dueDate: '2026-10-20', note: 'Контрольный остаток' }] } };
 return withPlanningIndicators(base, p.start, p.end);
}
`);
writeFileSync(join(root, 'app/api/connections/readiness/route.ts'), `
import { guard, json } from '@/app/lib/auth';
import { NextRequest } from 'next/server';
export async function GET(request: NextRequest) { const denied = await guard(request, 'admin'); return denied || json({ available: true, message: 'Контрольная готовность', checks: { database: 'ready', migration: 'ready', encryption: 'ready' } }); }
`);
writeFileSync(join(root, 'app/api/connections/route.ts'), `
import { guard, json } from '@/app/lib/auth';
import { NextRequest } from 'next/server';
export async function GET(request: NextRequest) { const denied = await guard(request, 'admin'); return denied || json({ connections: [], storage: { available: true, message: 'Контрольная готовность' } }); }
`);
const env = { ...process.env, AUTH_SECRET: randomBytes(48).toString('hex'), ADMIN_LOGIN: login, ADMIN_PASSWORD_HASH: hash.replaceAll('$', '\\$'), USER_LOGIN: '', USER_PASSWORD_HASH: '', DATABASE_URL: '', CONNECTIONS_ENCRYPTION_KEY: '', FINTABLO_ENABLED: 'false', GOOGLE_SHEETS_ENABLED: 'false', DEBT_ENABLED: 'false', DASHBOARD_USERS_JSON: '[]' };
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', '3211'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; server.stdout.on('data', c => logs += c); server.stderr.on('data', c => logs += c);
const session = 'planning-reference-check';
const browserEnv = { ...process.env, AGENT_BROWSER_DEFAULT_TIMEOUT: '60000' };
const run = (...args) => execFileSync(binary, ['--session', session, ...args], { encoding: 'utf8', timeout: 90000, env: browserEnv, stdio: ['pipe', 'pipe', 'pipe'] });
const evaluate = code => { const result = JSON.parse(execFileSync(binary, ['--session', session, 'eval', '--stdin', '--json'], { input: code, encoding: 'utf8', timeout: 90000, env: browserEnv })); if (!result.success) throw Error('Browser evaluation failed'); return result.data.result; };
const screenshotDir = join(process.cwd(), 'artifacts/reference-update'); mkdirSync(screenshotDir, { recursive: true });
let stage = 'startup';
try {
 let ready = false;
 for (let i = 0; i < 90; i++) { try { if ((await fetch('http://127.0.0.1:3211/login')).ok) { ready = true; break; } } catch {} await new Promise(r => setTimeout(r, 1000)); }
 assert.ok(ready, 'isolated server ready');
 stage = 'login'; run('open', 'http://127.0.0.1:3211/login'); run('wait', '--load', 'networkidle');
 run('fill', 'input[name=login]', login); run('fill', 'input[name=password]', pin); run('click', 'button[type=submit],form button');
 run('wait', '--fn', "location.pathname === '/' && !!document.querySelector('nav')");
 run('wait', '--fn', "!document.querySelector('.content[aria-busy=true]')");
 stage = 'period';
 const changeDate = (index, value) => evaluate(`(() => { const input = document.querySelectorAll('.dates input')[${index}]; const props = input[Object.keys(input).find(k => k.startsWith('__reactProps'))]; props.onChange({ target: { value: ${JSON.stringify(value)} } }); return true; })()`);
 changeDate(1, '2026-10-31'); changeDate(0, '2026-10-01');
 run('wait', '--fn', "document.querySelector('.operational-balance .reference-metric-foot').innerText.includes('31.10.2026') && document.querySelector('.content')?.getAttribute('aria-busy') === 'false'");
 stage = 'operational'; run('set', 'viewport', '1400', '990');
 assert.equal(evaluate("document.querySelector('.operational-balance .reference-metric-top strong').getAttribute('title')"), '1 500 000 ₽');
 run('screenshot', join(screenshotDir, 'operational-desktop.png'));
 changeDate(0, '2026-10-06'); run('wait', '--fn', "document.querySelector('.operational-balance .reference-metric-top strong').getAttribute('title') === '1 200 000 ₽'");
 changeDate(0, '2026-10-01'); run('wait', '--fn', "document.querySelector('.operational-balance .reference-metric-top strong').getAttribute('title') === '1 500 000 ₽'");
 stage = 'plans'; run('open', 'http://127.0.0.1:3211/?tab=plan'); run('wait', '--fn', "document.querySelector('.planning-kpis') !== null");
 assert.ok(evaluate("document.querySelector('.planning-grid').innerText.includes('Выручка')"));
 assert.equal(evaluate("document.querySelector('.page-toolbar .excel-export-button') !== null"), true);
 const exportStatus = evaluate("(async () => { const r = await fetch('/api/export?section=plan&start=2026-10-01&end=2026-10-31&compare=1'); return { status: r.status, type: r.headers.get('content-type'), bytes: (await r.arrayBuffer()).byteLength }; })()");
 assert.equal(exportStatus.status, 200); assert.ok(exportStatus.bytes > 3000); assert.ok(exportStatus.type.includes('spreadsheetml'));
 run('screenshot', join(screenshotDir, 'plans-desktop.png'));
 stage = 'cash'; run('open', 'http://127.0.0.1:3211/?tab=cash'); run('wait', '--fn', "document.querySelector('.reference-metric-grid') !== null");
 assert.ok(evaluate("document.querySelector('.reference-metric-grid').innerText.includes('План')"));
 assert.equal(evaluate("document.querySelector('.page-toolbar .excel-export-button') !== null"), true);
 const exportRect = evaluate("(() => { const b = document.querySelector('.page-toolbar .excel-export-button'); const r = b.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, display: getComputedStyle(b).display, visibility: getComputedStyle(b).visibility }; })()");
 console.log('Cash Excel button:', JSON.stringify(exportRect));
 assert.ok(exportRect.width > 0 && exportRect.height > 0 && exportRect.x + exportRect.width <= 1400, 'Excel button visible in desktop viewport');
 run('screenshot', join(screenshotDir, 'cash-desktop.png'));
 stage = 'mobile'; run('set', 'viewport', '390', '844');
 assert.equal(evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
 run('screenshot', join(screenshotDir, 'cash-mobile.png'));
 stage = 'source-options'; run('set', 'viewport', '1400', '990'); run('open', 'http://127.0.0.1:3211/?tab=settings'); run('wait', '--fn', "document.querySelector('.admin-sources') !== null");
 run('wait', '--fn', "Array.from(document.querySelectorAll('button')).some(b => b.textContent === 'Добавить подключение')");
 evaluate("(() => { Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Добавить подключение').click(); return true; })()");
 run('wait', '--fn', "document.querySelector('.source-editor') !== null");
 evaluate("(() => { Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Добавить связь с разделом').click(); return true; })()");
 run('wait', '--fn', "document.querySelector('.binding-editor') !== null");
 run('select', '.binding-editor label:first-of-type select', 'nlpkPayables');
 assert.ok(evaluate("document.querySelector('.binding-editor').innerText.includes('Остаток долга НЛПК')"));
 assert.equal(evaluate("document.querySelector('.binding-editor option[value=merge]').disabled"), true);
 const optionLabels = evaluate("Array.from(document.querySelector('.binding-editor label:first-of-type select').options).map(o => o.textContent)");
 assert.ok(optionLabels.includes('План поступлений')); assert.ok(optionLabels.includes('План списаний'));
 evaluate("(() => { document.querySelector('.source-editor').scrollIntoView({ block: 'start' }); return true; })()");
 run('screenshot', join(screenshotDir, 'nlpk-source-editor.png'));
 assert.equal(evaluate("document.querySelector('[data-nextjs-dialog]') !== null"), false);
 console.log('PASS: authenticated operational forecast, plan categories, plan XLSX API, cash plan UI, mobile width, NLПК source options, period recalculation');
 console.log('Screenshots: artifacts/reference-update (synthetic control fixtures only)');
} catch {
 console.error('FAIL at stage: ' + stage);
 try { run('screenshot', join(screenshotDir, 'failure.png')); } catch {}
 process.exitCode = 1;
} finally {
 try { run('close'); } catch {}
 server.kill('SIGTERM');
 await new Promise(resolve => { server.once('exit', resolve); setTimeout(resolve, 2000); });
 rmSync(root, { recursive: true, force: true });
}
