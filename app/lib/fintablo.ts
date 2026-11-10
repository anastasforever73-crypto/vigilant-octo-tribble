import { date as sourceDate } from './source-values';
import { accountAnchor, periodAccountBalances } from './fintablo-period-balances';
import { sourceInput, hasSourceArchive } from './source-input-archive';
import 'server-only';
import { getFintabloSettings, type FintabloSettings } from "@/app/lib/source-settings";

export type FintabloItem = Record<string, unknown>;
export type FintabloAccount = {
  id: number;
  name: string;
  type: string;
  number: string;
  currency: string;
  balance: number;
  balanceAvailable?: boolean;
  surplus: number;
  groupId: number;
  archived: boolean;
  hideInTotal: boolean;
};
export type FintabloTransaction = {
  id: number;
  date: string;
  amount: number;
  value: number;
  valueAvailable?: boolean;
  group: string;
  description: string;
  accountId: number;
  account: string;
  accountType: string;
  targetAccountId: number;
  targetAccount: string;
  targetValue: number;
  categoryId: number;
  category: string;
  partnerId: number;
  partner: string;
  directionId: number;
};
export type FintabloSnapshot = { source: "fintablo"; updatedAt: string; balanceDate?: string; balanceReason?: string; period: { start: string; end: string }; accounts: FintabloAccount[]; transactions: FintabloTransaction[]; pnl: FintabloItem[]; dictionaries: { pnlCategories: FintabloItem[]; transactionCategories: FintabloItem[]; partners: FintabloItem[] } };
export type FintabloErrorCode = "not_configured" | "invalid_url" | "auth" | "response_format" | "network" | "api";
export class FintabloError extends Error { constructor(public code: FintabloErrorCode, message: string) { super(message); this.name = "FintabloError"; } }
const text = (value: unknown) => (value == null ? "" : String(value).trim());
const hasNumber = (value: unknown) => value != null && text(value) !== '' && Number.isFinite(Number(text(value).replace(/\s/g, '').replace(',', '.')));
const number = (value: unknown) => { const parsed = typeof value === "number" ? value : Number(text(value).replace(/\s/g, "").replace(",", ".")); return Number.isFinite(parsed) ? parsed : 0; };
function requiredBaseUrl(settings: FintabloSettings) {
  const value = settings.fintabloBaseUrl.trim();
  if (!value) throw new FintabloError("not_configured", "Не задан URL API Финтабло");
  try { const url = new URL(value); if (url.protocol !== "https:" || url.hostname !== "api.fintablo.ru" || url.username || url.password || (url.port && url.port !== "443") || !["", "/"].includes(url.pathname) || url.search || url.hash) throw new Error(); return url.origin; }
  catch { throw new FintabloError("invalid_url", "Используйте базовый URL https://api.fintablo.ru"); }
}
function requiredToken(settings: FintabloSettings) { const value = settings.fintabloToken.trim(); if (!value) throw new FintabloError("not_configured", "Не задан токен Финтабло"); return value; }
const toRussianDate = (iso: string) => { const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/); return match ? `${match[3]}.${match[2]}.${match[1]}` : iso; };
async function api(settings: FintabloSettings, path: string, params: Record<string, string | number | undefined> = {}) {
  const url = new URL(path, `${requiredBaseUrl(settings)}/`); Object.entries(params).forEach(([key, value]) => { if (value !== undefined && value !== "") url.searchParams.set(key, String(value)); });
  const authorization = `Bearer ${requiredToken(settings)}`;
  let response: Response; try { response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000), headers: { Accept: "application/json", Authorization: authorization } }); } catch { throw new FintabloError("network", "Не удалось связаться с API Финтабло"); }
  if (response.status === 401 || response.status === 403) throw new FintabloError("auth", "Финтабло отклонило авторизацию");
  if (!response.ok) throw new FintabloError("api", `API Финтабло вернул HTTP ${response.status}`);
  let payload: unknown; try { payload = await response.json(); } catch { throw new FintabloError("response_format", "API Финтабло вернул не JSON"); }
  if (!payload || typeof payload !== "object" || (payload as { status?: unknown }).status !== 200 || !Array.isArray((payload as { items?: unknown }).items)) throw new FintabloError("response_format", "Ответ API Финтабло не соответствует формату status/items");
  return (payload as { items: FintabloItem[] }).items;
}
async function paged(settings: FintabloSettings, path: string, params: Record<string, string | number | undefined>) { const result: FintabloItem[] = []; for (let page = 1; page <= 100; page += 1) { const items = await api(settings, path, { ...params, page, pageSize: 1000 }); result.push(...items); if (items.length < 1000) return result; } throw new FintabloError("api", "Достигнут лимит загрузки; сократите период"); }
function monthsBetween(start: string, end: string) { const months: string[] = []; const cursor = new Date(`${start.slice(0, 7)}-01T00:00:00Z`); const limit = new Date(`${end.slice(0, 7)}-01T00:00:00Z`); while (cursor <= limit && months.length < 120) { months.push(`${String(cursor.getUTCMonth() + 1).padStart(2, "0")}.${cursor.getUTCFullYear()}`); cursor.setUTCMonth(cursor.getUTCMonth() + 1); } return months; }
async function readFintabloLive(start: string, end: string, settings = getFintabloSettings()): Promise<FintabloSnapshot> {
  const [moneybags, transactions, pnlCategories, transactionCategories, partners] = await Promise.all([api(settings, "/v1/moneybag"), paged(settings, "/v1/transaction", { dateFrom: toRussianDate(start), dateTo: toRussianDate(end) }), api(settings, "/v1/pnl-category"), api(settings, "/v1/category"), api(settings, "/v1/partner")]);
  const pnl = (await Promise.all(monthsBetween(start, end).map((month) => paged(settings, "/v1/pnl-item", { date: month })))).flat();
  const moneybagById = new Map(moneybags.map((item) => [number(item.id), item])); const categoryById = new Map(transactionCategories.map((item) => [number(item.id), text(item.name)])); const partnerById = new Map(partners.map((item) => [number(item.id), text(item.name)])); const pnlCategoryById = new Map(pnlCategories.map((item) => [number(item.id), item]));
  const accounts: FintabloAccount[] = moneybags.map((item) => ({ id: number(item.id), name: text(item.name), type: text(item.type), number: text(item.number), currency: text(item.currency) || "RUB", balance: number(item.balance), balanceAvailable: hasNumber(item.balance), surplus: number(item.surplus), groupId: number(item.groupId), archived: Boolean(number(item.archived)), hideInTotal: Boolean(number(item.hideInTotal)) })).filter((item) => !item.archived);
  const transactionsResult: FintabloTransaction[] = transactions.map((item) => { const group = text(item.group); const accountId = number(item.moneybagId); const targetAccountId = number(item.moneybag2Id); const rawValue = number(item.value); return { id: number(item.id), date: text(item.date).split(".").reverse().join("-"), amount: group === "outcome" ? -Math.abs(rawValue) : group === "income" ? Math.abs(rawValue) : 0, value: rawValue, valueAvailable: hasNumber(item.value), group, description: text(item.description), accountId, account: text(moneybagById.get(accountId)?.name), accountType: text(moneybagById.get(accountId)?.type), targetAccountId, targetAccount: text(moneybagById.get(targetAccountId)?.name), targetValue: number(item.value2), categoryId: number(item.categoryId), category: categoryById.get(number(item.categoryId)) || "", partnerId: number(item.partnerId), partner: partnerById.get(number(item.partnerId)) || "", directionId: number(item.directionId) }; });
  return { source: "fintablo", updatedAt: new Date().toISOString(), period: { start, end }, accounts, transactions: transactionsResult, pnl: pnl.map((item) => { const category = pnlCategoryById.get(number(item.categoryId)); return { id: number(item.id), date: text(item.date), value: number(item.value), nds: number(item.nds), categoryId: number(item.categoryId), category: text(category?.name), type: text(category?.type), pnlType: text(category?.pnlType), directionId: number(item.directionId), comment: text(item.comment) }; }), dictionaries: { pnlCategories, transactionCategories, partners } };
}

export async function inspectFintablo(settings: FintabloSettings) {
  const items = await api(settings, '/v1/moneybag');
  return items.filter(item => !number(item.archived)).map(item => ({ id: number(item.id), name: text(item.name) }));
}

export async function readFintablo(start: string, end: string, settings = getFintabloSettings()): Promise<FintabloSnapshot> {
  if (!hasSourceArchive()) return readFintabloLive(start, end, settings);
  // Archive calendar-month detail, never monthly balances or precomputed percentages.
  const months: { start: string; end: string }[] = [];
  const cursor = new Date(`${start.slice(0, 7)}-01T00:00:00Z`);
  while (cursor.toISOString().slice(0, 10) <= end) {
    const from = cursor.toISOString().slice(0, 10);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1, 0);
    months.push({ start: from, end: cursor.toISOString().slice(0, 10) });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (months.length > 25) throw new FintabloError('api', 'Сократите период загрузки');
  }
  const snapshots: FintabloSnapshot[] = new Array(months.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, months.length) }, async () => {
    while (next < months.length) {
      const index = next++, month = months[index];
      snapshots[index] = await sourceInput(['fintablo-month', settings, month], () => readFintabloLive(month.start, month.end, settings));
    }
  }));
  // Accounts are observations at read time, not historical month-end balances.
  const latest = snapshots.reduce((a, b) => a.updatedAt > b.updatedAt ? a : b);
  return { ...latest, period: { start, end },
    transactions: snapshots.flatMap(s => s.transactions).filter(row => row.date >= start && row.date <= end),
    pnl: snapshots.flatMap(s => s.pnl),
  };
}

/** Read documented fixed balances and factual movements to derive each account on selected end date. */
export async function readFintabloPeriodBalances(end: string, settings = getFintabloSettings(), ids: number[] = []): Promise<FintabloSnapshot> {
  const input = await sourceInput(['fintablo-period-balances-v1', settings, end, ids], async () => {
    const items = await api(settings, '/v1/moneybag');
    const observedAt = new Date().toISOString();
    const selected = items.filter(a => !Number(a.archived) && (!ids.length || ids.includes(Number(a.id))));
    const dates = [end, ...selected.map(item => accountAnchor(item, observedAt).date)];
    const start = [...dates].sort()[0], last = [...dates].sort().at(-1)!;
    const transactions = start === last ? [] : await paged(settings, '/v1/transaction', { dateFrom: toRussianDate(start), dateTo: toRussianDate(last), isPlan: 0 });
    return { items, transactions, observedAt };
  });
  return { source: 'fintablo', updatedAt: input.observedAt, balanceDate: end, balanceReason: `Остатки FinTablo на ${end}: фиксированные остатки счетов и фактические движения до выбранной даты; переводы учтены по обоим счетам, плановые операции исключены.`, period: { start: end, end }, accounts: periodAccountBalances(input.items, input.transactions, end, input.observedAt, ids), transactions: [], pnl: [], dictionaries: { pnlCategories: [], transactionCategories: [], partners: [] } };
}

export async function readFintabloPlans(start: string, end: string, settings = getFintabloSettings(), ids: number[] = []) {
  const input = await sourceInput(['fintablo-plans-v1', settings, start, end, ids], async () => {
    const [transactions, categories, partners, accounts] = await Promise.all([
      paged(settings, '/v1/transaction', { dateFrom: toRussianDate(start), dateTo: toRussianDate(end), isPlan: 1 }),
      api(settings, '/v1/category'), api(settings, '/v1/partner'), api(settings, '/v1/moneybag'),
    ]);
    return { transactions, categories, partners, accounts };
  });
  const categories = new Map(input.categories.map(r => [Number(r.id), text(r.name)]));
  const partners = new Map(input.partners.map(r => [Number(r.id), text(r.name)]));
  const unique = new Map(input.transactions.map(r => [Number(r.id), r]));
  const parents = new Set([...unique.values()].filter(r => Number(r.parentId)).map(r => Number(r.parentId)));
  const rows = [...unique.values()].filter(r => Number(r.isPlan) === 1 && !parents.has(Number(r.id)) && (!ids.length || ids.includes(Number(r.moneybagId))));
  const plans = { planReceipts: [] as import('./planning').PlanRow[], planPayments: [] as import('./planning').PlanRow[] };
  for (const row of rows) {
    if (!['income', 'outcome'].includes(text(row.group))) continue;
    const plannedDate = sourceDate(row.date);
    const account = input.accounts.find(a => Number(a.id) === Number(row.moneybagId));
    if (!account || !/^(RUB|RUR|643|₽)$/i.test(text(account.currency) || 'RUB')) throw new FintabloError('response_format', 'Валюта плановой операции FinTablo не подтверждена как рублёвая.');
    if (plannedDate < start || plannedDate > end) continue;
    if (!hasNumber(row.value)) throw new FintabloError('response_format', 'Нет суммы плановой операции FinTablo.');
    plans[row.group === 'income' ? 'planReceipts' : 'planPayments'].push({ date: plannedDate, amount: Math.abs(number(row.value)), category: categories.get(Number(row.categoryId)) || 'Без статьи', counterparty: partners.get(Number(row.partnerId)) || '', note: text(row.description) });
  }
  return plans;
}
