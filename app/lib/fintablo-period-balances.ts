import type { FintabloAccount, FintabloItem } from './fintablo';
import { date, number, text } from './source-values';
import { moscowToday } from './receivables';
export function accountAnchor(item: FintabloItem, observedAt: string) {
  const timestamp = Number(item.surplusTimestamp);
  const fixed = item.surplus != null && text(item.surplus) !== '' && Number.isFinite(timestamp) && timestamp > 0;
  return { date: fixed ? moscowToday(new Date(timestamp * 1000)) : moscowToday(new Date(observedAt)), value: fixed ? number(item.surplus) : item.balance == null || text(item.balance) === '' ? undefined : number(item.balance), fixed };
}
/** Fixed amounts are end-of-day anchors; operations on that same date are already included. */
export function periodAccountBalances(items: FintabloItem[], transactions: FintabloItem[], end: string, observedAt: string, ids: number[] = []): FintabloAccount[] {
  const selected = items.filter(a => !Number(a.archived) && (!ids.length || ids.includes(Number(a.id))));
  if (ids.some(id => !selected.some(a => Number(a.id) === id))) throw new Error('Выбранный счёт FinTablo недоступен.');
  const unique = new Map(transactions.map(t => [Number(t.id), t]));
  const parents = new Set([...unique.values()].filter(t => Number(t.parentId)).map(t => Number(t.parentId)));
  const rows = [...unique.values()].filter(t => !Number(t.isPlan) && !parents.has(Number(t.id)));
  return selected.map(item => {
    const anchor = accountAnchor(item, observedAt), id = number(item.id);
    let cents = anchor.value == null ? undefined : Math.round(anchor.value * 100);
    if (cents !== undefined) for (const row of rows) {
      const day = date(row.date);
      // Moving backward subtracts all factual movements AFTER requested end through anchor.
      if (!(day > (end < anchor.date ? end : anchor.date) && day <= (end < anchor.date ? anchor.date : end))) continue;
      const outgoing = Number(row.moneybagId) === id, incoming = Number(row.moneybag2Id) === id;
      if (!outgoing && !incoming) continue;
      if (!['income', 'outcome', 'transfer'].includes(text(row.group))) throw new Error('Неизвестный тип движения FinTablo.');
      let movement = 0;
      if (outgoing) {
        if (row.value == null || text(row.value) === '') throw new Error('Нет суммы операции FinTablo.');
        const value = Math.round(Math.abs(number(row.value)) * 100);
        movement += row.group === 'income' ? value : -value;
      }
      if (incoming && row.group === 'transfer') {
        if (row.value2 == null || text(row.value2) === '') throw new Error('Нет суммы поступления перевода FinTablo.');
        movement += Math.round(Math.abs(number(row.value2)) * 100);
      }
      cents += end < anchor.date ? -movement : movement;
    }
    return { id, name: text(item.name), type: text(item.type), number: text(item.number), currency: text(item.currency) || 'RUB', balance: cents == null ? 0 : cents / 100, balanceAvailable: cents != null, surplus: number(item.surplus), groupId: number(item.groupId), archived: Boolean(Number(item.archived)), hideInTotal: Boolean(Number(item.hideInTotal)) };
  });
}
