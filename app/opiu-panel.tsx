'use client';
import { createPortal } from 'react-dom';
import { Fragment, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { aggregateReportRow, opiuKpis, rowKind, monthLabel, previousMonths, segments, type OpiuCell, type OpiuReport, type Segment } from './lib/opiu';
import './opiu.css';
import ExcelExportButton from './excel-export-button';

const display = (cell: OpiuCell) => cell.state === 'blank' ? cell.text || 'Нет данных' : cell.text;
const exact = (cell: OpiuCell) => `${cell.address}${cell.value == null ? '' : `: ${cell.value.toLocaleString('ru-RU', { maximumFractionDigits: 12 })}`}`;
const articleLabel = (label: string) => label.replace(/^\s*\d+\s*[.)]\s*/, '');
function KpiAmount({ cell, id }: { cell: OpiuCell; id: number }) {
  const container = useRef<HTMLElement>(null);
  const measure = useRef<HTMLSpanElement>(null);
  const [compact, setCompact] = useState(false);
  const full = cell.value == null ? display(cell) : cell.value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2, ...(cell.text.includes('%') ? { style: 'percent' as const } : {}) });
  useEffect(() => {
    const update = () => setCompact(Boolean(container.current && measure.current && measure.current.getBoundingClientRect().width > container.current.clientWidth));
    const observer = new ResizeObserver(update);
    if (container.current) observer.observe(container.current);
    if (measure.current) observer.observe(measure.current);
    update();
    return () => observer.disconnect();
  }, [full]);
  const amount = cell.value;
  const unit = amount != null && Math.abs(amount) >= 1e9 ? { divisor: 1e9, label: 'млрд' } : amount != null && Math.abs(amount) >= 1e6 ? { divisor: 1e6, label: 'млн' } : { divisor: 1e3, label: 'тыс.' };
  const visible = compact && amount != null && !cell.text.includes('%') ? `${(amount / unit.divisor).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${unit.label} ₽` : full;
  return <strong ref={container} data-kpi={id} data-value={amount ?? undefined} data-numeric={amount != null} title={exact(cell)} tabIndex={0} aria-label={amount == null ? full : `${amount.toLocaleString('ru-RU', { maximumFractionDigits: 12 })}${cell.text.includes('%') ? '' : ' руб.'}`}>
    <span ref={measure} className="opiu-amount-measure" aria-hidden="true">{full}</span>
    <span className="opiu-amount-value">{visible}</span>
    <span className="opiu-amount-tooltip" aria-hidden="true">{exact(cell)}</span>
  </strong>;
}
export default function OpiuPanel({ canRefresh = true, controlsTarget }: { canRefresh?: boolean; controlsTarget?: HTMLElement | null }) {
  const [report, setReport] = useState<OpiuReport | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [selection, setSelection] = useState({ start: '', end: '' });
  const [mode, setMode] = useState('month');
  const [selectedSegments, setSelectedSegments] = useState<Segment[]>([...segments]);
  const [draftSegments, setDraftSegments] = useState<Segment[]>([...segments]);
  const [directionsOpen, setDirectionsOpen] = useState(false);
  const segment = selectedSegments.length === 1 ? selectedSegments[0] : 'ИТОГО';
  const [metric, setMetric] = useState(6);
  const [compare, setCompare] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/opiu', { method: refresh && canRefresh ? 'POST' : 'GET', cache: 'no-store', credentials: 'same-origin', signal: controller.signal }).then(async response => {
      if (response.status === 401) { window.location.replace('/login'); throw new Error('Сессия завершена'); }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'ОПиУ недоступен');
      if (!controller.signal.aborted) { setReport(data); setLoading(false); setError(''); }
    }).catch(e => { if (!controller.signal.aborted) { setError(e.message); setLoading(false); } });
    return () => controller.abort();
  }, [refresh, canRefresh]);
  function reload() { setLoading(true); setError(''); setRefresh(n => n + 1); }
  const start = report?.months.includes(selection.start) ? selection.start : report?.defaultMonth || '';
  const end = mode === 'month' ? start : report?.months.includes(selection.end) && selection.end >= start ? selection.end : start;
  const months = report?.months.filter(m => m >= start && m <= end) || [];
  const previous = previousMonths(months, report?.months || []);
  const selectedMetric = report?.rows.find(r => r.row === metric);
  const chart = months.map(month => ({ month: monthLabel(month), value: selectedMetric?.cells[month]?.[segment]?.value ?? null }));
  return <div className="opiu" aria-busy={loading}>
    <div className="opiu-heading"><h2>Отчёт о прибылях и убытках</h2>{canRefresh && <button type="button" onClick={reload} disabled={loading}><RefreshCw size={17}/>{loading ? 'Обновляем' : 'Обновить ОПиУ'}</button>}</div>
    {error && <p role="alert" className="opiu-error">{error}{report ? ' Показано последнее успешное чтение.' : ''}</p>}
    {!report && <p role="status">{loading ? 'Загрузка ОПиУ…' : 'Нет доступных данных ОПиУ'}</p>}
    {report && <>
      {controlsTarget && createPortal(<div className="opiu opiu-controls opiu-toolbar" aria-label="Управление отчётом по направлениям">
        <div className="opiu-modes" role="group" aria-label="Период ОПиУ">{[['month', 'Месяц'], ['range', 'Диапазон']].map(([value, label]) => <button key={value} aria-pressed={mode === value} onClick={() => setMode(value)}>{label}</button>)}</div>
        <label>{mode === 'month' ? 'Месяц' : 'С месяца'}<select aria-label="Начальный месяц ОПиУ" value={start} onChange={e => setSelection({ start: e.target.value, end: end < e.target.value ? e.target.value : end })}>{report.months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}</select></label>
        {mode === 'range' && <label>По месяц<select aria-label="Конечный месяц ОПиУ" value={end} onChange={e => setSelection({ start, end: e.target.value })}>{report.months.filter(m => m >= start).map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}</select></label>}
        <div className="opiu-directions" onKeyDown={e => { if (e.key === 'Escape') setDirectionsOpen(false); }}><button aria-expanded={directionsOpen} onClick={() => { setDraftSegments([...selectedSegments]); setDirectionsOpen(!directionsOpen); }}>Направления: {selectedSegments.length} из {segments.length} ▾</button>{directionsOpen && <div className="opiu-direction-menu" role="group" aria-label="Выбор направлений">{segments.map(item => <label key={item}><input type="checkbox" checked={draftSegments.includes(item)} onChange={e => setDraftSegments(e.target.checked ? [...draftSegments, item] : draftSegments.filter(s => s !== item))}/>{item}</label>)}<div><button onClick={() => setDraftSegments([...segments])}>Выбрать все</button><button onClick={() => setDraftSegments([])}>Сбросить</button><button disabled={!draftSegments.length} onClick={() => { setSelectedSegments(segments.filter(s => draftSegments.includes(s))); setDirectionsOpen(false); }}>Готово</button></div></div>}</div>
        <label className="opiu-check"><input type="checkbox" checked={compare} onChange={e => setCompare(e.target.checked)}/>Предыдущий период</label>
      </div>, controlsTarget)}
      <ExcelExportButton disabled={loading} options={{ section: 'opiu', start: start + '-01', end: new Date(Date.UTC(Number(end.slice(0, 4)), Number(end.slice(5, 7)), 0)).toISOString().slice(0, 10), compare, segment, selectedSegments }}/>
      <p className="opiu-period">{monthLabel(start)}{end !== start ? ` — ${monthLabel(end)}` : ''} · {selectedSegments.join(' / ')} · руб.</p>
      {compare && <p>{previous.length ? `Сравнение: ${monthLabel(previous[0])}${previous.length > 1 ? ` — ${monthLabel(previous.at(-1)!)}` : ''}` : 'Нет полного предыдущего периода для сравнения'}</p>}
      <div className="opiu-kpis">{opiuKpis(report.rows, months, segment).map(({ label, cell }, id) => <article key={label}><span>{label}</span><KpiAmount cell={cell} id={id}/><small>{segment}</small></article>)}</div>
      {months.length >= 2 && <div className="opiu-chart"><label>Динамика по месяцам<select aria-label="Показатель графика ОПиУ" value={metric} onChange={e => setMetric(Number(e.target.value))}>{report.rows.filter(r => r.label && !r.percent).map(r => <option key={r.row} value={r.row}>{articleLabel(r.label)}</option>)}</select></label>
        <div className="opiu-plot">{chart.some(c => c.value != null) ? <ResponsiveContainer width="100%" height="100%"><LineChart data={chart} margin={{ top: 20, right: 25, bottom: 12, left: 10 }}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="month" tick={{ fontSize: 12 }}/><YAxis width={65} tickFormatter={v => `${(v / 1000000).toLocaleString('ru-RU')} млн`} tick={{ fontSize: 12 }}/><Tooltip formatter={v => typeof v === 'number' ? `${v.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} руб.` : 'Нет данных'}/><Line name={articleLabel(selectedMetric?.label || '')} dataKey="value" stroke="#16847b" strokeWidth={2} dot={{ r: 4 }} connectNulls={false} isAnimationActive={false}/></LineChart></ResponsiveContainer> : <p>Нет числовых значений за выбранный период</p>}</div>
      </div>}
      <div className="opiu-table-wrap" tabIndex={0} aria-label="Статьи ОПиУ"><table className="opiu-table"><thead><tr><th scope="col">Статья</th>{selectedSegments.map(s => <th scope="col" colSpan={compare ? 3 : 1} key={s}>{s}</th>)}</tr>{compare && <tr><th scope="col">Показатель</th>{selectedSegments.map(s => <Fragment key={s}><th scope="col">Выбранный период</th><th scope="col">Предыдущий период</th><th scope="col">Изменение, руб.</th></Fragment>)}</tr>}</thead><tbody>{report.rows.filter(row => articleLabel(row.label).trim()).map(row => <tr key={row.row} data-row={row.row} className={`opiu-${rowKind(row)}${row.bold ? ' opiu-emphasis' : ''}`}><th scope="row" title={`A${row.row}`}>{articleLabel(row.label)}</th>{selectedSegments.map(s => {
        const total = aggregateReportRow(report.rows, row, months, s), prior = aggregateReportRow(report.rows, row, previous, s);
        return <Fragment key={s}><td title={exact(total)} data-cell={total.address} data-state={total.state} data-negative={total.value != null && total.value < 0}>{display(total)}</td>{compare && <><td title={exact(prior)}>{display(prior)}</td><td>{!row.percent && total.value != null && prior.value != null ? (total.value - prior.value).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) : '—'}</td></>}</Fragment>;
      })}</tr>)}</tbody></table></div>
    </>}
  </div>;
}
