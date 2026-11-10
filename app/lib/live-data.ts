import type { DashboardData } from './dashboard-data';
const rubFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
export const rub = (value: number) => rubFormatter.format(value) + ' ₽';
export const shortRub = (value: number | undefined) => value == null || !Number.isFinite(value) ? 'Нет данных' : Math.abs(value) >= 1000000 ? (value / 1000000).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' млн ₽' : rub(value);
export function buildLive(data: DashboardData, start: string, end: string, compare: boolean) {
  const day = 86400000;
  const previousStart = new Date(Date.parse(start) - (Date.parse(end) - Date.parse(start) + day)).toISOString().slice(0, 10);
  const curCash = data.cash.filter(x => x.date >= start && x.date <= end);
  const oldCash = data.cash.filter(x => x.date >= previousStart && x.date < start);
  const orders = data.orders.filter(x => x.date >= start && x.date <= end);
  const oldOrders = data.orders.filter(x => x.date >= previousStart && x.date < start);
  const incoming = (rows: typeof curCash) => rows.filter(x => x.amount > 0).reduce((s, x) => s + x.amount, 0);
  const outgoing = (rows: typeof curCash) => -rows.filter(x => x.amount < 0).reduce((s, x) => s + x.amount, 0);
  const inc = incoming(curCash), out = outgoing(curCash), oldInc = incoming(oldCash), oldOut = outgoing(oldCash);
  const delta = (a: number, b: number, available: boolean) => !compare ? 'Сравнение выключено' : !available || !b ? 'Нет данных для сравнения' : `${a >= b ? '+' : '−'}${Math.abs((a / b - 1) * 100).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`;
  const chart = new Map<string, { m: string; inc: number; out: number; revenue: number }>();
  for (const row of curCash) {
    const entry = chart.get(row.date) || { m: row.date, inc: 0, out: 0, revenue: 0 };
    if (row.amount >= 0) entry.inc += row.amount / 1e6; else entry.out += -row.amount / 1e6;
    chart.set(row.date, entry);
  }
  const managers = new Map<string, number>();
  const debtors = new Map<string, { name: string; value: number }>();
  for (const row of orders) {
    if (row.manager) managers.set(row.manager, (managers.get(row.manager) || 0) + row.revenue);
    // Group each order row exactly once by debtor; payment methods must not reassign earlier rows.
    if (row.debt > 0) { const name = row.client || row.payer || 'Не указан в источнике'; debtors.set(name, { name, value: (debtors.get(name)?.value || 0) + row.debt }); }
  }
  const revenue = orders.reduce((s, x) => s + x.revenue, 0);
  const account = data.balances.account, wallet = data.balances.wallet;
  const balance = account == null || wallet == null ? undefined : account + wallet;
  const hasCash = Boolean(data.fields?.cash), hasOrders = Boolean(data.fields?.orders);
  const factoryRows = curCash.filter(x => x.amount < 0 && /завод|поставщик/i.test(`${x.article} ${x.counterparty}`));
  return {
    hasCash, hasOrders, transactions: curCash, orderCount: new Set(orders.map(row => row.order).filter(Boolean)).size,
    incoming: hasCash ? inc : undefined, outgoing: hasCash ? out : undefined, net: hasCash ? inc - out : undefined,
    revenue: hasOrders ? revenue : undefined, revenueDelta: delta(revenue, oldOrders.reduce((s, x) => s + x.revenue, 0), oldOrders.length > 0),
    incomingDelta: delta(inc, oldInc, oldCash.length > 0), outgoingDelta: delta(out, oldOut, oldCash.length > 0), netDelta: delta(inc - out, oldInc - oldOut, oldCash.length > 0),
    balance, balanceDelta: 'Нет исторического остатка для сравнения',
    moneySources: [{ name: 'Расчётный счёт', value: account }, { name: 'Кошелёк', value: wallet }].filter((x): x is { name: string; value: number } => x.value != null),
    chart: [...chart.values()].sort((a, b) => a.m.localeCompare(b.m)), end, rows: curCash.length,
    managers: [...managers].sort((a,b) => b[1]-a[1]).map(([name, value]) => ({ name, value: shortRub(value) })),
    totalDebt: data.debtor.total, debtDate: data.debtor.date, factoryDebt: data.creditor.factory, factoryDate: data.creditor.date,
    factoryPayments: hasCash ? outgoing(factoryRows) : undefined,
    debtors: [...debtors.values()].sort((a,b) => b.value-a.value).slice(0,5),
    alerts: hasCash && inc < out ? [['Отрицательный денежный поток', shortRub(inc-out), 'Выплаты превышают поступления за выбранный период']] : [],
  };
}
export type LiveData = ReturnType<typeof buildLive>;
