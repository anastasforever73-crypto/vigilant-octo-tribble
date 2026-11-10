'use client';
import { useEffect, useState } from 'react';
import { moscowToday } from './lib/receivables';
import type { WalletPercentageRule } from './lib/wallet-percentage';
import type { Operational } from './lib/operational';
const money = (value?: number | null) => value == null ? 'Нет данных' : `${value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;
export default function WalletPercentageSettings({ refresh, financial, compact = false }: { compact?: boolean; refresh: () => Promise<void>; financial?: Operational }) {
  const [rules, setRules] = useState<WalletPercentageRule[]>([]);
  const [percent, setPercent] = useState('0');
  const [effectiveFrom, setEffectiveFrom] = useState(moscowToday);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    fetch('/api/settings/wallet-percentage', { cache: 'no-store' }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Настройки недоступны.');
      if (active) { setRules(result.rules); const latest = result.rules.at(-1); if (latest) { setPercent(String(latest.percent)); setEffectiveFrom(latest.effectiveFrom); } }
    }).catch(error => { if (active) setMessage(error instanceof Error ? error.message : 'Настройки недоступны.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMessage('');
    try {
      const response = await fetch('/api/settings/wallet-percentage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ percent: Number(percent.replace(',', '.')), effectiveFrom }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Сохранение не выполнено.');
      setRules(result.rules); setMessage('Процент сохранён. Пересчитываем остатки…'); await refresh(); setMessage('Процент сохранён. Остатки пересчитаны.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Сохранение не выполнено.'); }
    finally { setSaving(false); }
  }
  const content = <section className={compact ? "panel wallet-rate-compact" : "panel"} id="wallet-percentage-settings" aria-label="Ставка приведения кошелька к безналу">
    <h3>{compact ? "Кошелёк → безнал · ставка" : "Ставка приведения кошелька к безналу"}</h3>{!compact && <p>Безналичный эквивалент кошелька = исходный остаток × (1 + процент / 100). Общий и операционный остатки используют эту сумму. Ставка применяется с указанной даты включительно; до неё действует предыдущая ставка. Для отмены надбавки сохраните 0% с нужной даты.</p>}
    <form className="settings-form" onSubmit={save}><label>Ставка надбавки, %<input type="number" min="0" max="100" step="0.01" required value={percent} onChange={e => setPercent(e.target.value)} disabled={loading || saving}/></label><label>Действует с<input type="date" required value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} disabled={loading || saving}/></label><button className="primary" type="submit" disabled={loading || saving}>{saving ? 'Сохраняем…' : compact ? 'Сохранить' : 'Сохранить процент'}</button></form>
    <p role="status">{loading ? 'Загружаем настройки…' : message}</p>
    {!compact && <p>Текущие рассчитанные суммы: кошелёк — {money(financial?.wallet.value)}; общий остаток — {money(financial?.total.value)}; операционный остаток — {money(financial?.operationalBalance?.value)}.</p>}
    {rules.length > 0 && <details><summary>История ставок</summary><ul>{rules.map(rule => <li key={rule.effectiveFrom}><button type="button" onClick={() => { setPercent(String(rule.percent)); setEffectiveFrom(rule.effectiveFrom); }}>{rule.effectiveFrom.split('-').reverse().join('.')} — {rule.percent}%</button></li>)}</ul></details>}
  </section>;
  return compact ? <details className="wallet-rate-control"><summary>Ставка кошелька</summary>{content}</details> : content;
}
