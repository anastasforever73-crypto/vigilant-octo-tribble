import type { LucideIcon } from 'lucide-react';
import { shortRub, rub } from './lib/live-data';
export default function ReferenceMetric({ title, value, plan, icon: Icon, note, tone = 'green', emphasis = false }: { title: string; value?: number | null; plan?: number | null; icon: LucideIcon; note?: string; tone?: 'green' | 'amber' | 'blue'; emphasis?: boolean }) {
  const ratio = plan != null && plan > 0 && value != null ? value / plan * 100 : null;
  return <article className={`reference-metric reference-metric-${tone}${emphasis ? ' reference-metric-emphasis' : ''}${value == null ? ' metric-unavailable' : value < 0 ? ' metric-negative' : ''}`}>
    <div className="reference-metric-top"><strong title={value == null ? 'Нет данных' : rub(value)}>{shortRub(value ?? undefined)}</strong><span className="reference-metric-icon"><Icon size={18}/></span></div>
    <span className="reference-metric-title">{title}</span>{value != null && value < 0 && <span className="metric-status">Отрицательное значение</span>}
    {ratio != null && <div className="reference-metric-track" role={ratio == null ? undefined : 'progressbar'} aria-label={`Выполнение плана: ${title}`} aria-valuenow={ratio == null ? undefined : Math.min(100, Math.max(0, ratio))} aria-valuemin={0} aria-valuemax={100} aria-valuetext={ratio == null ? undefined : `${ratio.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`}><i style={{ width: ratio == null ? '0%' : `${Math.min(100, Math.max(0, ratio))}%` }}/></div>}
    <div className="reference-metric-foot"><small>{plan == null ? note || 'План не задан' : `План ${rub(plan)}`}</small>{ratio != null && <small>{ratio.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%</small>}</div>
  </article>;
}
