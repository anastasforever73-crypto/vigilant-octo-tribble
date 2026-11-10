'use client';
import { ArrowDownLeft, ArrowUpRight, TrendingUp } from 'lucide-react';
import ReferenceMetric from './reference-metric';
import { useMemo } from 'react';
import type { DashboardData } from './lib/dashboard-data';
import { previousPlanPeriod, summarizePlan, type PlanRow } from './lib/planning';
import './planning.css';
const money = (value: number) => `${value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;
const dateLabel = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' });
const emptyRows: PlanRow[] = [];
function PlanCategories({ title, rows, start, end, compare }: { title: string; rows?: PlanRow[]; start: string; end: string; compare: boolean }) {
  const summary = useMemo(() => summarizePlan(rows || emptyRows, start, end), [rows, start, end]);
  const priorPeriod = previousPlanPeriod(start, end);
  const prior = summarizePlan(rows || emptyRows, priorPeriod.start, priorPeriod.end);
  const categories = [...new Set([...summary.categories.map(r => r.category), ...(compare ? prior.categories.map(r => r.category) : [])])];
  const currentAmounts = new Map(summary.categories.map(r => [r.category, r.amount]));
  const priorAmounts = new Map(prior.categories.map(r => [r.category, r.amount]));
  return <section className="panel planning-categories"><div className="panel-head"><h3>{title}</h3><small>₽ · по категориям</small></div>
    {rows === undefined ? <p role="status">Источник плана не подключён или данные недоступны.</p> : <>
      {!summary.count && <p role="status">На выбранный период плановых операций нет.</p>}
      {categories.length > 0 && <div className="planning-table" tabIndex={0} role="region" aria-label={`${title} по категориям`}><table><thead><tr><th scope="col">Категория</th><th scope="col">План</th><th scope="col">Доля</th>{compare && <><th scope="col">Предыдущий период</th><th scope="col">Изменение</th></>}</tr></thead><tbody>{categories.map(category => {
        const amount = currentAmounts.get(category) || 0, previous = priorAmounts.get(category) || 0;
        return <tr key={category}><th scope="row">{category}</th><td>{money(amount)}</td><td>{summary.total ? `${(amount / summary.total * 100).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%` : '—'}</td>{compare && <><td>{money(previous)}</td><td>{money((Math.round(amount * 100) - Math.round(previous * 100)) / 100)}</td></>}</tr>;
      })}</tbody><tfoot><tr><th scope="row">Итого</th><td>{money(summary.total)}</td><td>{summary.total ? '100%' : '—'}</td>{compare && <><td>{money(prior.total)}</td><td>{money((Math.round(summary.total * 100) - Math.round(prior.total * 100)) / 100)}</td></>}</tr></tfoot></table></div>}
      {summary.count > 0 && <details><summary>Плановые операции ({summary.count})</summary><div className="planning-table" tabIndex={0} role="region" aria-label={`${title}: операции`}><table><thead><tr><th scope="col">Дата</th><th scope="col">Категория</th><th scope="col">Контрагент</th><th scope="col">Сумма</th><th scope="col">Комментарий</th></tr></thead><tbody>{summary.rows.map((row, index) => <tr key={index}><td>{dateLabel(row.date)}</td><th scope="row">{row.category}</th><td>{row.counterparty || '—'}</td><td>{money(row.amount)}</td><td>{row.note || '—'}</td></tr>)}</tbody></table></div></details>}
    </>}
  </section>;
}
export default function PlanningPanel({ data, start, end, compare, loading, canConfigure, onConfigure }: { data: DashboardData; start: string; end: string; compare: boolean; loading: boolean; canConfigure: boolean; onConfigure: () => void }) {
  const receipts = useMemo(() => data.planReceipts === undefined ? undefined : summarizePlan(data.planReceipts, start, end), [data.planReceipts, start, end]);
  const payments = useMemo(() => data.planPayments === undefined ? undefined : summarizePlan(data.planPayments, start, end), [data.planPayments, start, end]);
  const net = receipts && payments ? (Math.round(receipts.total * 100) - Math.round(payments.total * 100)) / 100 : undefined;
  const previous = previousPlanPeriod(start, end);
  if (loading) return <section className="panel planning" aria-busy="true"><h2>Планы поступлений и списаний</h2><p role="status">Загружаем планы за выбранный период…</p></section>;
  return <div className="planning" aria-busy={loading}>
    <section className="planning-intro"><h2>Планы поступлений и списаний</h2>{data.planningSource && <p>Источник планов: {data.planningSource}</p>}<p>{dateLabel(start)} — {dateLabel(end)} · суммы в рублях</p><p>Выберите начало и конец периода в фильтре сверху: показатели и категории пересчитываются для этих дат.</p>{canConfigure && receipts !== undefined && payments !== undefined && <button type="button" onClick={onConfigure}>Настроить источники планов</button>}{compare && <p>Сравнение с планом за {dateLabel(previous.start)} — {dateLabel(previous.end)}.</p>}
      {(receipts === undefined || payments === undefined) && <div className="planning-empty"><p>Для каждого направления добавьте связь Google Sheets с разделом «Планирование»: набор «План поступлений» или «План списаний». Обязательные поля: плановая дата, категория и сумма.</p>{canConfigure && <button type="button" className="primary" onClick={onConfigure}>Настроить источники планов</button>}</div>}
    </section>
    <div className="planning-kpis">
      <ReferenceMetric title="План поступлений" value={receipts?.total} icon={ArrowUpRight} note="За выбранный период"/>
      <ReferenceMetric title="План списаний" value={payments?.total} icon={ArrowDownLeft} note="За выбранный период"/>
      <ReferenceMetric title="Плановый денежный поток" value={net} icon={TrendingUp} note="Поступления минус списания"/>
    </div>
    <section className="panel balance-hero"><ReferenceMetric title="Плановый остаток денежных средств" value={data.plannedBalance?.value} icon={TrendingUp} note="Остаток на конец периода + план поступлений − план списаний"/></section>
    <section className="panel"><div className="panel-head"><h3>План движения денег по месяцам</h3></div><div className="planning-table" tabIndex={0} role="region" aria-label="Планы по месяцам"><table><thead><tr><th scope="col">Месяц</th><th scope="col">Поступления</th><th scope="col">Списания</th><th scope="col">Поток</th></tr></thead><tbody>{[...new Set([...(receipts?.rows || []), ...(payments?.rows || [])].map(row => row.date.slice(0, 7)))].sort().map(month => {
      const sum = (rows: PlanRow[] | undefined) => rows === undefined ? undefined : rows.filter(row => row.date.startsWith(month)).reduce((total, row) => total + Math.round(row.amount * 100), 0) / 100;
      const incoming = sum(receipts?.rows), outgoing = sum(payments?.rows);
      return <tr key={month}><th scope="row">{new Date(`${month}-01T00:00:00Z`).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' })}</th><td>{incoming == null ? 'Нет данных' : money(incoming)}</td><td>{outgoing == null ? 'Нет данных' : money(outgoing)}</td><td>{incoming == null || outgoing == null ? 'Нет данных' : money((Math.round(incoming * 100) - Math.round(outgoing * 100)) / 100)}</td></tr>;
    })}</tbody></table></div>{!receipts?.count && !payments?.count && <p>{receipts === undefined || payments === undefined ? 'Подключите планы поступлений и списаний.' : 'На выбранный период плановых операций нет.'}</p>}</section>
    <div className="planning-grid"><PlanCategories title="План поступлений" rows={data.planReceipts} start={start} end={end} compare={compare}/><PlanCategories title="План списаний" rows={data.planPayments} start={start} end={end} compare={compare}/></div>
  </div>;
}
