import type { DashboardData } from './dashboard-data';
import { date } from './source-values';
import { moscowToday } from './receivables';
export type WalletPercentageRule = { percent: number; effectiveFrom: string };
export function parseWalletPercentage(value: unknown): WalletPercentageRule {
  if (!value || typeof value !== 'object') throw new Error('Укажите процент и дату начала действия.');
  const input = value as Record<string, unknown>;
  if (typeof input.percent !== 'number' || !Number.isFinite(input.percent) || input.percent < 0 || input.percent > 100 || Math.abs(Math.round(input.percent * 100) - input.percent * 100) > 1e-8) throw new Error('Процент должен быть от 0 до 100, не более двух знаков после запятой.');
  if (typeof input.effectiveFrom !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom) || date(input.effectiveFrom) !== input.effectiveFrom) throw new Error('Укажите корректную дату начала действия.');
  return { percent: input.percent, effectiveFrom: input.effectiveFrom };
}
export function adjustedWallet(amount: number, rules: WalletPercentageRule[], asOf: string) {
  const rule = [...rules].filter(r => r.effectiveFrom <= asOf).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)).at(-1);
  return { value: rule ? Math.round(Math.round(amount * 100) * (10000 + Math.round(rule.percent * 100)) / 10000) / 100 : amount, rule };
}
/** Applied to raw archive facts, once per read; source balances are never overwritten. */
export function withWalletPercentage(data: DashboardData, rules: WalletPercentageRule[], end: string, today = moscowToday()): DashboardData {
  const balances = { ...data.balances };
  if (balances.wallet != null) balances.wallet = adjustedWallet(balances.wallet, rules, balances.date || end).value;
  let operational = data.operational;
  if (operational) {
    const asOf = operational.wallet.date?.includes('T') ? moscowToday(new Date(operational.wallet.date)) : operational.wallet.date || today;
    const raw = operational.wallet.value;
    const adjustment = raw == null ? undefined : adjustedWallet(raw, rules, asOf);
    const activeRule = [...rules].filter(r => r.effectiveFrom <= asOf).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)).at(-1);
    operational = { ...operational, walletConversion: { raw, converted: adjustment?.value ?? null, percent: activeRule?.percent ?? null, effectiveFrom: activeRule?.effectiveFrom, asOf } };
    if (adjustment?.rule) {
      const { rule, value } = adjustment;
      const explanation = ` Надбавка ${rule.percent}% к кошельку с ${rule.effectiveFrom}; исходный кошелёк ${raw} ₽, после надбавки ${value} ₽.`;
      operational = { ...operational, wallet: { ...operational.wallet, value, reason: operational.wallet.reason + explanation }, total: { ...operational.total, value: operational.total.value == null ? null : (Math.round(operational.total.value * 100) - Math.round(raw! * 100) + Math.round(value * 100)) / 100, reason: operational.total.reason + explanation } };
    } else if (raw == null && rules.some(r => r.effectiveFrom <= asOf && r.percent !== 0)) {
      operational = { ...operational, total: { ...operational.total, value: null, reason: 'Для начисления процента нужен подтверждённый остаток кошелька.' } };
    }
  }
  const sections = data.sections && Object.fromEntries(Object.entries(data.sections).map(([key, value]) => [key, value && withWalletPercentage(value, rules, end, today)]));
  return { ...data, balances, operational, sections };
}
