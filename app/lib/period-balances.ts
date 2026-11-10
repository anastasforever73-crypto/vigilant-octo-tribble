import type { DashboardData } from './dashboard-data';
import { sectionData } from './connections/compose';
import { missingMetric, type Metric } from './operational';
import { moscowToday } from './receivables';
const metricDay = (metric: Metric) => metric.date?.includes('T') ? moscowToday(new Date(metric.date)) : metric.date;
/** Period stocks use end date. A current FinTablo account snapshot cannot stand in for history. */
export function withPeriodBalances(data: DashboardData, end: string): DashboardData {
  if (!data.operational) return data;
  const current = data.operational;
  if (['account', 'wallet', 'total'].every(key => metricDay(current[key as 'account' | 'wallet' | 'total']) === end)) return data;
  const cash = sectionData(data, 'cash');
  const balances = cash.balances.date === end ? cash.balances : undefined;
  const source = 'Подключённые источники · остатки на конец выбранного периода';
  const absent = missingMetric(`Подтверждённого остатка на ${end} нет. Текущий остаток FinTablo относится к другой дате и не используется вместо исторического. Подключите источник с историей остатков.`, source);
  const metric = (value: number | undefined, label: string): Metric => value == null ? { ...absent, date: end } : { value, date: end, source, reason: `${label} на ${end}: последняя подтверждённая запись не позже конца выбранного периода.` };
  const account = metric(balances?.account, 'Расчётный счёт'), wallet = metric(balances?.wallet, 'Кошелёк');
  const total: Metric = account.value == null || wallet.value == null ? { ...absent, date: end } : { value: (Math.round(account.value * 100) + Math.round(wallet.value * 100)) / 100, date: end, source, reason: `Расчётный счёт + кошелёк на ${end} по историческому источнику. Отдельный депозит этим источником не подтверждён и в сумму не включён.` };
  return { ...data, operational: { ...current, account, wallet, total, deposit: { ...absent, date: end, reason: `Отдельный остаток депозита на ${end} не подтверждён историческим источником.` }, walletConversion: undefined } };
}
