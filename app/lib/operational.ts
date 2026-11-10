import type { FintabloSnapshot } from './fintablo';
import { debtSources, moscowToday, type ReceivablesReport } from './receivables';

export type AccountBalanceDetail = { id: number; name: string; number?: string; value: number };
export type Metric = { breakdown?: AccountBalanceDetail[]; comparison?: { value: number | null; date?: string; end: string };  value: number | null; reason: string; source: string; date?: string };
export type OperationalFinancial = { account: Metric; wallet: Metric; deposit: Metric; total: Metric; receipts: Metric };
export type Operational = OperationalFinancial & { planningSource?: string; walletConversion?: { raw: number | null; converted: number | null; percent: number | null; effectiveFrom?: string; asOf: string }; operationalBalance?: Metric; plannedReceipts?: Metric; plannedPayments?: Metric; planningMonths?: { month: string; receipts: number | null; payments: number | null }[]; planningPeriod?: { start: string; end: string }; day: string; debt: Metric; payables: Metric; shipments: Metric };
export const missingMetric = (reason: string, source: string): Metric => ({ value: null, reason, source });
export const yesterdayMoscow = (now = new Date()) => new Date(Date.parse(moscowToday(now)) - 86400000).toISOString().slice(0, 10);

/** Separate presentation of existing accounts; does not change the legacy cash calculation. */
export function operationalFinancial(snapshot: FintabloSnapshot, day: string): OperationalFinancial {
  const accounts = snapshot.accounts.filter(a => !a.archived && !a.hideInTotal);
  const kind = (a: typeof accounts[number]) => /депозит|deposit|вклад/i.test(`${a.name} ${a.type}`) ? 'deposit' : /кош|касс|налич|wallet|cash/i.test(`${a.name} ${a.type}`) ? 'wallet' : /расч[её]т|сч[её]т|банк|bank|account/i.test(`${a.name} ${a.type}`) ? 'account' : 'unknown';
  function balance(key: 'account' | 'wallet' | 'deposit' | 'total'): Metric {
    const rows = key === 'total' ? accounts : accounts.filter(a => kind(a) === key);
    const result = missingMetric('В FinTablo нет доступного счёта этой категории.', 'FinTablo · /v1/moneybag');
    if (!rows.length) return result;
    if (rows.some(a => a.balanceAvailable === false || !Number.isFinite(a.balance))) return { ...result, reason: 'FinTablo не передал числовой остаток для одного из счетов.' };
    if (rows.some(a => !/^(RUB|RUR|643|₽)$/i.test(a.currency))) return { ...result, reason: 'Есть счета в другой валюте; подтверждённого пересчёта в рубли нет.' };
    return { ...result, value: rows.reduce((sum, a) => sum + Math.round(a.balance * 100), 0) / 100, breakdown: key === 'account' ? rows.map(a => ({ id: a.id, name: a.name, number: a.number || undefined, value: Math.round(a.balance * 100) / 100 })) : undefined, reason: snapshot.balanceReason || 'Текущие остатки видимых активных счетов FinTablo.', date: snapshot.balanceDate || snapshot.updatedAt };
  }
  // Revenue is identified by an explicit category, never by all positive cash flow.
  const rows = snapshot.transactions.filter(t => t.date === day && t.group === 'income' && /выручк|оплат[аы] (?:от )?(?:покупател|клиент)|поступлени[ея] от (?:покупател|клиент)|продаж/i.test(t.category) && !/возврат|займ|кредит|внутрен|перевод/i.test(t.category));
  const receipts: Metric = rows.length && rows.every(t => t.valueAvailable !== false && Number.isFinite(t.amount) && accounts.some(a => a.id === t.accountId && /^(RUB|RUR|643|₽)$/i.test(a.currency)))
    ? { value: rows.reduce((sum, t) => sum + Math.round(t.amount * 100), 0) / 100, source: 'FinTablo · /v1/transaction · статьи выручки', date: day, reason: 'Входящие операции со статьёй выручки, продаж или оплаты покупателей; внутренние переводы исключены.' }
    : missingMetric('За этот день нет подтверждённых рублёвых поступлений со статьёй выручки / оплаты покупателей. Все поступления не приравниваются к выручке.', 'FinTablo · /v1/transaction');
  return { account: balance('account'), wallet: balance('wallet'), deposit: balance('deposit'), total: balance('total'), receipts };
}

export function operationalDebt(report: ReceivablesReport, day: string): Pick<Operational, 'debt' | 'payables' | 'shipments'> {
  const source = `Google Sheets · ${debtSources.map(s => report.sourceSheets?.[s] || s).join(' + ')}`;
  const debt = report.current && !report.current.partial ? { value: report.current.totalCents / 100, date: report.asOf, source, reason: 'Действующий расчёт ДЗ после зачёта внутри источника и ключа.' } : missingMetric('Полный итог ДЗ не подтверждён: один или несколько исходных листов недоступны.', source);
  const payables = report.payables ? { value: report.payables.factory, date: report.payables.date, source: `Google Sheets · ${report.payables.sheet} · A / G`, reason: 'Остаток по заводу из действующей схемы кредиторки, на последнюю доступную дату.' } : missingMetric(report.payablesError || 'В действующем источнике нет подтверждённого остатка кредиторки НЛПК.', 'Google Sheets · кредиторка по заводу');
  const daily = debtSources.map(s => report.sources[s]?.dailyShipment);
  const valid = daily.every(d => d?.date === day && d.amountCents != null);
  const shipments = valid ? { value: daily.reduce((sum, d) => sum + d!.amountCents!, 0) / 100, date: day, source, reason: 'Суммы отгрузок, включая оплаченные, по дате УПД / отгрузки. Повторные строки учтены один раз.' } : missingMetric('За предыдущий календарный день нет подтверждённых сумм отгрузок по обоим исходным листам; пустые или нечисловые суммы не считаются нулём.', source);
  return { debt, payables, shipments };
}
