'use client';
import { useEffect, useRef, useState } from 'react';
import { RefreshCw, ExternalLink } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { aggregateRow, monthLabel, previousMonths, segments, type OpiuCell, type OpiuReport, type Segment } from './lib/opiu';
import './opiu.css';
import ExcelExportButton from './excel-export-button';

const display = (cell: OpiuCell) => cell.state === 'blank' ? cell.text || 'Нет данных' : cell.text;
const exact = (cell: OpiuCell) => `${cell.address}${cell.value == null ? '' : `: ${cell.value.toLocaleString('ru-RU', { maximumFractionDigits: 12 })}`}`;
const articleLabel = (label: string) => label.replace(/^\s*\d+\s*[.)]\s*/, '');
function KpiAmount({ cell, id }: { cell: OpiuCell; id: number }) {
  const container = useRef<HTMLElement>(null);
  const measure = useRef<HTMLSpanElement>(null);
  const [compact, setCompact] = useState(false);
  const full = display(cell);
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
  const visible = compact && amount != null ? `${(amount / unit.divisor).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ${unit.label} ₽` : full;
  return <strong ref={container} data-kpi={id} data-value={amount ?? undefined} data-numeric={amount != null} title={exact(cell)} tabIndex={0} aria-label={amount == null ? full : `${amount.toLocaleString('ru-RU', { maximumFractionDigits: 12 })} руб.`}>
    <span ref={measure} className="opiu-amount-measure" aria-hidden="true">{full}</span>
    <span className="opiu-amount-value">{visible}</span>
    <span className="opiu-amount-tooltip" aria-hidden="true">{exact(cell)}</span>
  </strong>;
}
export default function OpiuPanel({ canRefresh = true }: { canRefresh?: boolean }) {
  const [report, setReport] = useState<OpiuReport | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [selection, setSelection] = useState({ start: '', end: '' });
  const [mode, setMode] = useState('month');
  const [segment, setSegment] = useState<Segment>('ИТОГО');
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
      <p className="source-note">{report.archive?.mode === 'archive' ? 'Архив' : 'Данные источника'} · По состоянию на {new Date(report.archive?.observedAt || report.updatedAt).toLocaleString('ru-RU')}. {report.archive?.message}</p>
      <div className="opiu-controls">
        <div className="opiu-modes" role="group" aria-label="Период ОПиУ">{[['month', 'Месяц'], ['range', 'Диапазон']].map(([value, label]) => <button key={value} aria-pressed={mode === value} onClick={() => setMode(value)}>{label}</button>)}</div>
        <label>{mode === 'month' ? 'Месяц' : 'С месяца'}<select aria-label="Начальный месяц ОПиУ" value={start} onChange={e => setSelection({ start: e.target.value, end: end < e.target.value ? e.target.value : end })}>{report.months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}</select></label>
        {mode === 'range' && <label>По месяц<select aria-label="Конечный месяц ОПиУ" value={end} onChange={e => setSelection({ start, end: e.target.value })}>{report.months.filter(m => m >= start).map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}</select></label>}
        <label>Блок<select aria-label="Блок ОПиУ" value={segment} onChange={e => setSegment(e.target.value as Segment)}>{segments.map(s => <option key={s}>{s}</option>)}</select></label>
        <label className="opiu-check"><input type="checkbox" checked={compare} onChange={e => setCompare(e.target.checked)}/>Предыдущий период</label>
      </div>
      <ExcelExportButton disabled={loading} options={{ section: 'opiu', start: start + '-01', end: new Date(Date.UTC(Number(end.slice(0, 4)), Number(end.slice(5, 7)), 0)).toISOString().slice(0, 10), compare, segment }}/>
      <p className="opiu-period">{monthLabel(start)}{end !== start ? ` — ${monthLabel(end)}` : ''} · {segment} · руб.</p>
      {compare && <p>{previous.length ? `Сравнение: ${monthLabel(previous[0])}${previous.length > 1 ? ` — ${monthLabel(previous.at(-1)!)}` : ''}` : 'Нет полного предыдущего периода для сравнения'}</p>}
      <div className="opiu-kpis">{[6, 40, 56, 64].map(id => { const row = report.rows.find(r => r.row === id); if (!row) return null; const cell = aggregateRow(row, months, segment); return <article key={id}><span>{articleLabel(row.label)}</span><KpiAmount cell={cell} id={id}/></article>; })}</div>
      {months.length >= 2 && <div className="opiu-chart"><label>Динамика по месяцам<select aria-label="Показатель графика ОПиУ" value={metric} onChange={e => setMetric(Number(e.target.value))}>{report.rows.filter(r => r.label && !r.percent).map(r => <option key={r.row} value={r.row}>{articleLabel(r.label)}</option>)}</select></label>
        <div className="opiu-plot">{chart.some(c => c.value != null) ? <ResponsiveContainer width="100%" height="100%"><LineChart data={chart} margin={{ top: 20, right: 25, bottom: 12, left: 10 }}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="month" tick={{ fontSize: 12 }}/><YAxis width={65} tickFormatter={v => `${(v / 1000000).toLocaleString('ru-RU')} млн`} tick={{ fontSize: 12 }}/><Tooltip formatter={v => typeof v === 'number' ? `${v.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} руб.` : 'Нет данных'}/><Line name={articleLabel(selectedMetric?.label || '')} dataKey="value" stroke="#16847b" strokeWidth={2} dot={{ r: 4 }} connectNulls={false} isAnimationActive={false}/></LineChart></ResponsiveContainer> : <p>Нет числовых значений за выбранный период</p>}</div>
      </div>}
      <div className="opiu-table-wrap" tabIndex={0} aria-label="Статьи ОПиУ"><table className="opiu-table"><thead><tr><th scope="col">Статья</th>{months.map(m => <th scope="col" key={m}>{monthLabel(m)}</th>)}{months.length > 1 && <th scope="col">За период</th>}{compare && <><th scope="col">Предыдущий период</th><th scope="col">Изменение, руб.</th></>}</tr></thead><tbody>{report.rows.map(row => {
        const total = aggregateRow(row, months, segment), prior = aggregateRow(row, previous, segment);
        return <tr key={row.row} data-row={row.row} className={row.bold ? 'opiu-total' : ''}><th scope="row" title={`A${row.row}`}>{articleLabel(row.label) || (Object.values(row.cells).some(c => Object.values(c).some(v => v.state !== 'blank')) ? `Строка ${row.row} (без названия)` : '\u00a0')}</th>{months.map(m => { const cell = aggregateRow(row, [m], segment); return <td key={m} title={exact(cell)} data-cell={cell.address} data-state={cell.state}>{display(cell)}</td>; })}{months.length > 1 && <td title={exact(total)}>{display(total)}</td>}{compare && <><td>{display(prior)}</td><td>{!row.percent && total.value != null && prior.value != null ? (total.value - prior.value).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) : 'Нет данных'}</td></>}</tr>;
      })}</tbody></table></div>
      <p className="opiu-provenance"><a href={report.url} target="_blank" rel="noreferrer">{report.sheet}<ExternalLink size={14}/></a><span>Обновлено: {new Date(report.updatedAt).toLocaleString('ru-RU')}</span></p>
      <p className="opiu-note">Суммы в рублях, округление как в источнике. Итог за период — сумма одной статьи по месяцам; при пропусках полного итога нет. Проценты за несколько месяцев не суммируются. Плановые показатели в источнике не выделены.</p>
    </>}
  </div>;
}
