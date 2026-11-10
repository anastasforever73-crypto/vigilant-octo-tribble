'use client';
import WalletPercentageSettings from './wallet-percentage-settings';
import { DashboardQueryCache, neighbourMonths } from './lib/dashboard-query-cache';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DashboardData, SourceStatus } from './lib/dashboard-data';
import type { Role } from './lib/auth';
import { buildLive, rub, shortRub, type LiveData } from './lib/live-data';
import ExcelExportButton from './excel-export-button';
import type { ReportSection } from './lib/excel-report';
import ArchivePanel from './archive-panel';
import SourcesPanel from './sources-panel';
import ReceivablesPanel from './receivables-panel';
import NlpkPayablesPanel from './nlpk-payables-panel';
import ReferenceMetric from './reference-metric';
import type { PlanningSummary } from './lib/planning-indicators';
import PlanningPanel from './planning-panel';
import OpiuPanel from './opiu-panel';
import InfoTip from './info-tip';
import OperationalPanel from './operational-panel';
import UsersPanel from './users-panel';
import { allSections, canView } from './lib/user-access';
import type { Section } from './lib/connections/model';
import { sectionData } from './lib/connections/compose';
import { ArrowUpRight, Banknote, Boxes, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Download, Filter, Info, LayoutDashboard, Menu, Search, Settings2, Truck, Type, Users, WalletCards, X, type LucideIcon } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
export type Tab = "movements" | "salary" | "projects" | "plan" | "overview" | "goods" | "cash" | "logistics" | "sales" | "debt" | "opiu" | "balance" | "settings" | "users";
type Tone = "good" | "warn" | "bad";
const groups = [
  { label: "Оперативные", ids: ["overview", "movements", "salary", "debt"] },
  { label: "Аналитические", ids: ["cash", "projects", "opiu", "balance", "sales"] },
  { label: "План", ids: ["plan"] },
  { label: "Товары и логистика", ids: ["goods", "logistics"] },
  { label: "Администрирование", ids: ["settings", "users"] },
];
const tabs = [
  { id: 'movements' as Tab, label: 'Поступления и выплаты', icon: Banknote },
  { id: 'salary' as Tab, label: 'Заработная плата', icon: Users },
  { id: 'projects' as Tab, label: 'Потоки по проектам', icon: Filter },
  { id: 'plan' as Tab, label: 'Планирование', icon: CalendarDays },
  {
    id: "overview" as Tab,
    label: "Остатки и резервы",
    icon: LayoutDashboard,
  },
  { id: "cash" as Tab, label: "Деньги", icon: WalletCards },
  { id: "sales" as Tab, label: "Продажи по менеджерам", icon: Users },
  { id: "goods" as Tab, label: "Управление товаром", icon: Boxes },
  { id: "logistics" as Tab, label: "Логистика", icon: Truck },
  { id: "debt" as Tab, label: "Дебиторская задолженность", icon: Banknote },
  { id: "opiu" as Tab, label: "Прибыль и фонды", icon: Filter },
  { id: "balance" as Tab, label: "Баланс", icon: Banknote },
  { id: "settings" as Tab, label: "Источники и архив", icon: Settings2 },
  { id: "users" as Tab, label: "Пользователи", icon: Users },
];
const Pill = ({
  tone = "good",
  children,
}: {
  tone?: Tone;
  children: React.ReactNode;
}) => <span className={`pill ${tone}`}>{children}</span>;
function Panel({
  title,
  sub,
  note,
  children,
}: {
  title: string;
  sub?: string;
  note?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>{title}{note && <InfoTip>{note}</InfoTip>}</h3>
          {sub && <p>{sub}</p>}
        </div>
        <Info size={15} />
      </div>
      {children}
    </section>
  );
}
type KpiRow = readonly [string, string, string, string, Tone, LucideIcon];
function Kpi({ x, open }: { x: KpiRow; open: (s: string) => void }) {
  const I = x[5];
  return (
    <button className={`kpi ${x[4]}`} onClick={() => open(x[0])}>
      <div className="kpi-head">
        <span>{x[0]}</span>
        <I size={17} />
      </div>
      <strong>{x[1]}</strong>
      <div className="kpi-foot">
        <b>{x[2]}</b>
        <span>{x[3]}</span>
      </div>
    </button>
  );
}
const Tip = ({ active, payload, label }: { active?: boolean; payload?: readonly { dataKey?: string | number; color?: string; name?: string; value?: string | number }[]; label?: string | number }) =>
  active && payload?.length ? (
    <div className="tip">
      <b>{label}</b>
      {payload.map((p) => (
        <span key={p.dataKey} style={{ color: p.color }}>
          {p.name}: {p.value} млн ₽
        </span>
      ))}
    </div>
  ) : null;
function Table({
  title,
  heads,
  rows,
}: {
  title: string;
  heads: string[];
  rows: string[][];
}) {
  const [q, setQ] = useState("");
  const shown = rows.filter((r) =>
    r.join(" ").toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <Panel title={title} sub={`${shown.length} строк в текущем представлении`}>
      <div className="tools">
        <label>
          <Search size={14} />
          <input
            placeholder="Поиск по таблице"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <button>
          <Download size={14} />
          Выгрузить
        </button>
      </div>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              {heads.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j}>
                    {j === r.length - 1 ? (
                      <Pill
                        tone={
                          /разрыв|риск|задерж|дефицит|неликвид/i.test(c)
                            ? "bad"
                            : /внимание|избыток|пути/i.test(c)
                              ? "warn"
                              : "good"
                        }
                      >
                        {c}
                      </Pill>
                    ) : (
                      c
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
function Heading({
  eye,
  title,
  status,
  tone = "warn",
}: {
  eye: string;
  title: string;
  status?: string;
  tone?: Tone;
}) {
  return (
    <div className="heading">
      <div>
        <span>{eye}</span>
        <h2>{title}</h2>
      </div>
      {status && <Pill tone={tone}>{status}</Pill>}
    </div>
  );
}
// Retained for restoring the previous overview; the active tab renders OperationalPanel directly.
function Overview({ open, live, sources, operational }: { open: (s: string) => void; live: LiveData; sources: Record<string, SourceStatus>; operational?: DashboardData['operational'] }) {
  const cards = [
    { name: 'Продажи', value: shortRub(live.revenue), detail: live.revenueDelta },
    { name: 'Заказов с номером', value: live.hasOrders ? String(live.orderCount) : 'Нет данных', detail: 'Уникальные номера за выбранный период' },
    { name: 'Менеджеров с продажами', value: live.hasOrders ? String(live.managers.length) : 'Нет данных', detail: 'По подтверждённым строкам заказов' },
  ];
  const errors = Object.values(sources).filter(source => source.error);
  return <>
    <div className="operational-cards">{cards.map(card => <button key={card.name} onClick={() => open(card.name)}><span>{card.name}<Info size={16}/></span><strong>{card.value}</strong><small>{card.detail}</small></button>)}</div>
    <OperationalPanel data={operational}/>
    <Panel title="Состояние деятельности" sub="Показатели за выбранный период">
      {errors.length ? <p className="attention">Есть ошибки обновления источников. Проверьте их статус перед принятием решений.</p> : <p>{live.hasOrders ? 'Данные заказов доступны за выбранный период.' : 'Нет подтверждённых данных заказов. Требуется подключённый источник продаж.'}</p>}
      {live.alerts.length > 0 && <p className="attention">Обнаружено финансовое отклонение. Подробности доступны в разделе «ДДС».</p>}
    </Panel>
  </>;
}
function MoneyMovement({ live, planning }: { live: LiveData; planning?: PlanningSummary }) {
  const dates = [...new Set([...live.chart.map(r => r.m), ...(planning?.daily || []).map(r => r.date)])].sort();
  const actual = new Map(live.chart.map(r => [r.m, r]));
  const planned = new Map((planning?.daily || []).map(r => [r.date, r]));
  const chart = dates.map(m => ({ m, inc: actual.get(m)?.inc ?? 0, out: actual.get(m)?.out ?? 0, planInc: planning?.receipts == null ? null : (planned.get(m)?.receipts ?? 0) / 1e6, planOut: planning?.payments == null ? null : (planned.get(m)?.payments ?? 0) / 1e6 }));
  // Presentation grouping only: same negative transaction rows as the existing outgoing metric.
  const amounts = new Map<string, number>();
  for (const row of live.transactions) if (row.amount < 0) amounts.set(row.article || 'Статья не указана', (amounts.get(row.article || 'Статья не указана') || 0) - row.amount);
  const expenses = [...amounts].map(([name, value]) => ({ name, value })).sort((a,b) => b.value-a.value);
  const colors = ['#19835f', '#389a77', '#6eb49a', '#a1cdb7', '#c9dc8b', '#e4d468', '#77bfc0'];
  return <>
    <div className="reference-columns money-charts">
      <Panel title="Структура выплат" sub="по статьям · за выбранный период">
        {expenses.length ? <div className="expense-structure"><div className="expense-donut"><ResponsiveContainer width="100%" height={250} minWidth={1}><PieChart><Pie data={expenses} dataKey="value" nameKey="name" innerRadius="68%" outerRadius="88%" paddingAngle={1} isAnimationActive={false}>{expenses.map((row,i) => <Cell key={row.name} fill={colors[i % colors.length]}/>)}</Pie><Tooltip formatter={value => rub(Number(value))}/></PieChart></ResponsiveContainer><div className="pie-total"><b>{shortRub(live.outgoing)}</b><small>Всего выплат</small></div></div><div className="expense-legend">{expenses.map((row,i) => <div key={row.name} style={{ borderLeftColor: colors[i % colors.length] }}><span>{row.name}<small>{rub(row.value)}</small></span><b>{live.outgoing ? (row.value / live.outgoing * 100).toLocaleString('ru-RU', {maximumFractionDigits:1}) : '0'}%</b></div>)}</div></div> : <p className="reference-empty">За выбранный период нет выплат.</p>}
      </Panel>
      <Panel title="Динамика поступлений и выплат" sub="Факт и план · млн ₽">
        {chart.length ? <ResponsiveContainer minWidth={1} minHeight={1} width="100%" height={280}><AreaChart data={chart}><defs><linearGradient id="flowFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#208d68" stopOpacity={0.23}/><stop offset="100%" stopColor="#208d68" stopOpacity={0.015}/></linearGradient></defs><CartesianGrid stroke="#edf1ef" vertical={false}/><XAxis dataKey="m" axisLine={false} tickLine={false} tick={{fontSize:10}} tickFormatter={value => String(value).slice(5).split('-').reverse().join('.')}/><YAxis width={42} axisLine={false} tickLine={false} tick={{fontSize:10}}/><Tooltip content={<Tip/>}/><Area isAnimationActive={false} dataKey="inc" name="Поступления" stroke="#208d68" fill="url(#flowFill)" strokeWidth={2}/><Area isAnimationActive={false} dataKey="out" name="Выплаты" stroke="#bc8a42" fill="transparent" strokeWidth={1.5}/><Area isAnimationActive={false} dataKey="planInc" name="План поступлений" stroke="#7e9389" strokeDasharray="5 4" fill="transparent" strokeWidth={1.5} connectNulls={false}/><Area isAnimationActive={false} dataKey="planOut" name="План списаний" stroke="#d8b278" strokeDasharray="5 4" fill="transparent" strokeWidth={1.5} connectNulls={false}/></AreaChart></ResponsiveContainer> : <p className="reference-empty">Нет операций за выбранный период.</p>}
        <div className="chart-key"><span><i style={{background:'#208d68'}}/>Поступления</span><span><i style={{background:'#bc8a42'}}/>Выплаты</span><span><i className="chart-plan-key"/>План</span></div>
      </Panel>
    </div>
    <details className="panel account-disclosure"><summary>Структура денежных средств <small>{shortRub(live.balance)}</small></summary>{live.moneySources.length ? <table><tbody>{live.moneySources.map(row => <tr key={row.name}><td>{row.name}</td><td className="numeric">{rub(row.value)}</td></tr>)}</tbody></table> : <p>Нет подтверждённых остатков по счетам.</p>}</details>
  </>;
}
function SourceUnavailable({ title, fields }: { title: string; fields: string }) {
  return (
    <>
      <Heading eye="Источник данных" title={title} status="Нет подтверждённых данных" tone="warn" />
      <Panel title="Источник не подключён">
        <p className="hint">
          В подключённых источниках не найдено поле {fields}. Значения не подставляются, чтобы не смешивать факты с оценками.
        </p>
      </Panel>
    </>
  );
}
function Cash({ live, planning }: { live: LiveData; open: (s: string) => void; planning?: PlanningSummary }) {
  if (!live.hasCash) return <SourceUnavailable title="Денежные средства" fields="операции ДДС"/>;
  return (
    <>
      <Heading eye="Факт" title="Движение денежных средств" status={live.hasCash ? "Данные источника" : "Источник не подключён"} tone={live.hasCash ? "good" : "warn"} />
      <div className="reference-metric-grid">
        <ReferenceMetric title="Поступления" value={live.incoming} plan={planning?.receipts} icon={ArrowUpRight}/>
        <ReferenceMetric title="Списания" value={live.outgoing} plan={planning?.payments} icon={Download}/>
        <ReferenceMetric title="Денежный поток" value={live.net} plan={planning?.net} icon={Filter}/>
        <ReferenceMetric title="Фактический остаток" value={live.balance} icon={WalletCards} note="Остаток по подключённым счетам" tone="amber"/>
      </div>
      <MoneyMovement live={live} planning={planning}/>
      <p className="table-context">Операций за выбранный период: {live.rows}</p><Table title="Детализация движения денег" heads={['Дата', 'Счёт', 'Контрагент', 'Статья', 'Сумма']} rows={live.transactions.slice(0, 500).map(row => [row.date, row.source, row.counterparty, row.article, rub(row.amount)])}/>
      {live.transactions.length > 500 && <p className="hint">Показаны первые 500 операций. Итоги рассчитаны по всем операциям периода.</p>}
    </>
  );
}
function Sales({ live }: { live: LiveData }) {
  const rows = live.managers.map((manager: { name: string; value: string }) => [manager.name, manager.value]);
  return (
    <>
      <Heading eye="Заказы" title="Продажи по менеджерам" status={live.hasOrders ? "Данные источника" : "Источник не подключён"} tone={live.hasOrders ? "good" : "warn"} />
      <Panel title="Выручка по менеджерам" sub="только строки с заполненным менеджером">
        {rows.length ? <Table title="Рейтинг менеджеров" heads={["Менеджер", "Выручка"]} rows={rows} /> : <p className="hint">В выбранном периоде нет подтверждённых данных по менеджерам.</p>}
      </Panel>
    </>
  );
}
const iso = (d: Date) => d.toISOString().slice(0, 10),
  parse = (s: string) => new Date(`${s}T12:00:00`),
  dayMs = 86400000;
function rangeLabel(start: string, end: string) {
  const f = (x: string) =>
    parse(x)
      .toLocaleDateString("ru-RU", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
      .replace(" г.", "");
  return start === end ? f(start) : `${f(start)} — ${f(end)}`;
}
function previousRange(start: string, end: string) {
  const a = parse(start),
    b = parse(end),
    days = Math.round((b.getTime() - a.getTime()) / dayMs) + 1;
  b.setDate(a.getDate() - 1);
  a.setDate(a.getDate() - days);
  return [iso(a), iso(b)];
}
function shiftRange(start: string, end: string, step: number) {
  const days =
      Math.round((parse(end).getTime() - parse(start).getTime()) / dayMs) + 1,
    a = parse(start),
    b = parse(end);
  a.setDate(a.getDate() + step * days);
  b.setDate(b.getDate() + step * days);
  return [iso(a), iso(b)];
}
function DateControl({
  mode,
  setMode,
  start,
  setStart,
  end,
  setEnd,
  compare,
  setCompare,
}: {
  mode: string;
  setMode: (x: string) => void;
  start: string;
  setStart: (x: string) => void;
  end: string;
  setEnd: (x: string) => void;
  compare: boolean;
  setCompare: (x: boolean) => void;
}) {
  const prev = previousRange(start, end),
    apply = (m: string) => {
      setMode(m);
      if (m === "day") {
        setStart(end);
        setEnd(end);
      }
      if (m === "week") {
        const weekEnd = parse(end);
        const weekStart = parse(end);
        weekStart.setDate(weekStart.getDate() - 6);
        setStart(iso(weekStart));
        setEnd(iso(weekEnd));
      }
    };
  return (
    <div className="period-panel">
      <div className="period-modes">
        <button
          className={mode === "day" ? "active" : ""}
          onClick={() => apply("day")}
        >
          День
        </button>
        <button
          className={mode === "week" ? "active" : ""}
          onClick={() => apply("week")}
        >
          Неделя
        </button>
        <button
          className={mode === "range" ? "active" : ""}
          onClick={() => setMode("range")}
        >
          Диапазон
        </button>
      </div>
      <button
        className="period-arrow"
        onClick={() => {
          const r = shiftRange(start, end, -1);
          setStart(r[0]);
          setEnd(r[1]);
        }}
      >
        <ChevronLeft size={18} />
      </button>
      <div className="dates">
        <CalendarDays size={18} />
        <label>
          <small>С</small>
          <input
            type="date"
            value={start}
            onChange={(e) => {
              if (!e.target.value || e.target.value > end) return;
              setStart(e.target.value);
              setMode("range");
            }}
          />
        </label>
        <span>—</span>
        <label>
          <small>По</small>
          <input
            type="date"
            value={end}
            min={start}
            onChange={(e) => {
              if (!e.target.value || e.target.value < start) return;
              setEnd(e.target.value);
              setMode("range");
            }}
          />
        </label>
      </div>
      <button
        className="period-arrow"
        onClick={() => {
          const r = shiftRange(start, end, 1);
          setStart(r[0]);
          setEnd(r[1]);
        }}
      >
        <ChevronRight size={18} />
      </button>
      <label className="compare">
        <input
          type="checkbox"
          checked={compare}
          onChange={(e) => setCompare(e.target.checked)}
        />
        <span>
          <b>Сравнить</b>
          <small>{rangeLabel(prev[0], prev[1])}</small>
        </span>
      </label>
    </div>
  );
}
const emptyData: DashboardData = { source: '', cash: [], orders: [], debtor: {}, creditor: {}, balances: {} };
const emptySources: Record<string, SourceStatus> = Object.fromEntries([['fintablo', 'Финтабло'], ['googleSheets', 'Google Sheets'], ['debt', 'Таблица задолженности']].map(([key, name]) => [key, { name, configured: false, available: false, status: 'loading', freshness: 'Подключение ещё не проверено' }]));
function Balance({ data, loading, error }: { data: DashboardData; loading: boolean; error?: string }) {
  const balance = data.sections?.balance;
  if (loading) return <Panel title="Загружаем баланс"><p role="status">Проверяем данные за выбранный период.</p></Panel>;
  if (error || data.sources?.connections?.status === 'storage_unavailable') return <Panel title="Баланс временно недоступен"><p>Не удалось получить данные. Повторите обновление позже.</p></Panel>;
  if (!balance) return <Panel title="Источник баланса не подключён"><p>Нет подтверждённых данных баланса. Администратор может привязать источник в разделе «Источники данных», выбрав набор «Бухгалтерский баланс» и вкладку «Баланс».</p></Panel>;
  if (!balance.balanceSheet) return <Panel title="Данные баланса недоступны"><p>Источник привязан, но подтверждённых данных за выбранный период нет. Администратору нужно проверить состояние подключения и синхронизацию.</p></Panel>;
  if (!balance.balanceSheet.length) return <Panel title="Нет данных на выбранную дату"><p>В подключённом источнике нет строк баланса на дату окончания периода или ранее.</p></Panel>;
  return <Table title="Баланс на отчётную дату" heads={['Дата', 'Раздел', 'Статья', 'Сумма']} rows={balance.balanceSheet.map(r => [r.date, r.category, r.article, rub(r.amount)])}/>;
}
export default function Dashboard({ cacheScope, role, initialTab = 'overview', allowedSections = allSections }: { cacheScope: string; role: Role; initialTab?: Tab; allowedSections?: Section[] }) {
  const canAccess = (section: string) => canView({ role, sections: allowedSections }, section);
  const visibleGroups = groups.filter(group => !group.ids.includes("settings")).map(group => ({ ...group, key: group.ids[0], ids: group.ids.filter(canAccess) })).filter(group => group.ids.length);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => Object.fromEntries(groups.map(g => [g.ids[0], g.ids.includes(initialTab)])));
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  useEffect(() => {
    const restore = () => {
      const requested = location.pathname === '/balance' ? 'balance' : new URLSearchParams(location.search).get('tab') || 'overview';
      const selected = tabs.some(t => t.id === requested) && canView({ role, sections: allowedSections }, requested) ? requested as Tab : initialTab;
      setTab(selected);
      setExpanded(previous => {
        let saved = previous;
        try { saved = { ...previous, ...JSON.parse(sessionStorage.getItem('dashboard-menu-v1') || '{}') }; } catch {}
        const group = groups.find(g => g.ids.includes(selected));
        return { ...saved, ...(group ? { [group.ids[0]]: true } : {}) };
      });
      setMenuOpen(false);
    };
    restore();
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [role, allowedSections, initialTab]);
  useEffect(() => {
    if (!menuOpen) return;
    const trigger = menuButton.current;
    const old = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sidebar.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
      if (event.key === 'Tab') {
        const items = Array.from(sidebar.current?.querySelectorAll<HTMLElement>('button, a[href]') || []).filter(el => el.getClientRects().length);
        const first = items[0], last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    const media = window.matchMedia('(min-width: 751px)');
    const closeOnDesktop = () => { if (media.matches) setMenuOpen(false); };
    media.addEventListener('change', closeOnDesktop);
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = old; document.removeEventListener('keydown', onKey); media.removeEventListener('change', closeOnDesktop); trigger?.focus(); };
  }, [menuOpen]);
  function saveGroups(next: Record<string, boolean>) {
    setExpanded(next);
    try { sessionStorage.setItem('dashboard-menu-v1', JSON.stringify(next)); } catch {}
  }
  const [opiuVisited, setOpiuVisited] = useState(initialTab === 'opiu');
  function navigate(next: Tab) {
    if (next === 'opiu') setOpiuVisited(true);
    if (!canAccess(next)) return;
    const group = groups.find(g => g.ids.includes(next));
    if (group) saveGroups({ ...expanded, [group.ids[0]]: true });
    window.history.pushState(null, '', next === 'balance' ? '/balance' : next === 'overview' ? '/' : `/?tab=${next}`);
    setTab(next); setDetail(null); setMenuOpen(false);
  }
  const [detail, setDetail] = useState<string | null>(null);
  const [mode, setMode] = useState('week');
  const [start, setStart] = useState(() => new Date(Date.now() - 6 * dayMs).toISOString().slice(0, 10));
  const [end, setEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [compare, setCompare] = useState(true);
  const [font, setFont] = useState('normal');
  const [refresh, setRefresh] = useState(0);
  const appliedRefresh = useRef(0);
  const queryCache = useMemo(() => new DashboardQueryCache(cacheScope), [cacheScope]);
  const [result, setResult] = useState<{ key: string; data: DashboardData; error?: string } | null>(null);
  const key = `${cacheScope}:${start}:${end}:${refresh}`;
  const cached = queryCache.get(start, end);
  const busy = !cached && result?.key !== key;
  const data = cached || (result?.key === key ? result.data : emptyData);
  const sources = data.sources || emptySources;
  const live = useMemo(() => buildLive(sectionData(data, 'overview'), start, end, compare), [data, start, end, compare]);
  const cashLive = useMemo(() => buildLive(sectionData(data, 'cash'), start, end, compare), [data, start, end, compare]);
  const salesLive = useMemo(() => buildLive(sectionData(data, 'sales'), start, end, compare), [data, start, end, compare]);
  const debtLive = useMemo(() => buildLive(sectionData(data, 'debt'), start, end, compare), [data, start, end, compare]);
  useEffect(() => {
    let active = true;
    const force = refresh > appliedRefresh.current && role === 'admin';
    appliedRefresh.current = refresh;
    queryCache.load(start, end, { force }).then(payload => {
      if (active && payload) setResult({ key, data: payload });
    }).catch((error: unknown) => {
      if (active) setResult({ key, data: emptyData, error: error instanceof Error ? error.message : 'Сервер недоступен' });
    });
    // Idle, bounded prefetch reads existing archives only. Obsolete results cannot replace selection.
    const prefetch = window.setTimeout(() => {
      if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return;
      for (const p of neighbourMonths(start)) queryCache.load(p.start, p.end, { prefetch: true }).catch(() => {});
    }, 1200);
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      queryCache.load(start, end, { revalidate: true }).then(payload => {
        if (active && payload) setResult({ key, data: payload });
      }).catch(() => {});
    }, 60000);
    return () => { active = false; window.clearTimeout(prefetch); window.clearInterval(timer); };
  }, [key, start, end, refresh, role, queryCache]);
  useEffect(() => {
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('dashboard-session') : undefined;
    if (channel) channel.onmessage = () => { queryCache.clear(); window.location.replace('/login'); };
    const clear = () => queryCache.clear();
    window.addEventListener('pagehide', clear);
    return () => { queryCache.clear(); channel?.close(); window.removeEventListener('pagehide', clear); };
  }, [queryCache]);
  async function refreshCalculations() {
    queryCache.clear();
    const payload = await queryCache.load(start, end);
    if (!payload) throw new Error('Процент сохранён, но остатки пока недоступны. Обновите данные.');
    setResult({ key, data: payload });
  }
  function refreshData() { queryCache.clear(); setRefresh(x => x + 1); }
  const online = role === 'admin' ? Object.values(sources).some(s => s.available) : Boolean(data.updatedAt);
  async function logout() {
    queryCache.clear();
    if (typeof BroadcastChannel !== 'undefined') { const channel = new BroadcastChannel('dashboard-session'); channel.postMessage('logout'); channel.close(); }
    try { const response = await fetch('/api/auth/logout', { method: 'POST' }); if (response.ok || response.status === 401) window.location.replace('/login'); else setDetail('Не удалось выйти. Повторите попытку.'); }
    catch { setDetail('Сервер недоступен. Повторите выход.'); }
  }
  return <main className={`shell reference-shell font-${font}`}>
    <header className="global-topbar" inert={menuOpen}><div className="topbar-brand"><span>МТ</span><b>Март-Трейд</b></div><div className="topbar-status">{busy ? 'Обновляем данные…' : data.archive?.mode === 'archive' ? 'Архивные данные' : 'Управленческий дашборд'}{data.updatedAt && <small> · {new Date(data.archive?.observedAt || data.updatedAt).toLocaleString('ru-RU')}</small>}</div><div className="head-actions">{role === 'admin' && tab === 'overview' && <WalletPercentageSettings compact refresh={refreshCalculations} financial={data.operational}/>}<div className="font-control" title="Размер шрифта"><Type size={16}/>{['normal','large','xlarge'].map((x,i) => <button key={x} aria-label={`Размер шрифта ${i+1}`} className={font===x?'active':''} onClick={()=>setFont(x)}>A</button>)}</div>{role === 'admin' && <details className="admin-menu"><summary><Settings2 size={16}/>Панель администратора</summary><nav aria-label="Администрирование">{tabs.filter(item => item.id === 'settings' || item.id === 'users').map(item => <a key={item.id} id={`tab-${item.id}`} href={`/?tab=${item.id}`} aria-current={tab === item.id ? 'page' : undefined} onClick={event => { if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); navigate(item.id); event.currentTarget.closest('details')?.removeAttribute('open'); }}>{item.label}</a>)}</nav></details>}<span className="topbar-role">{role === 'admin' ? 'Администратор' : 'Просмотр'}</span><button onClick={logout}>Выйти</button></div></header>
    <div className="workspace" inert={menuOpen}>
      <div className="page-toolbar"><header className="page-heading"><button ref={menuButton} className="menu-button" aria-label="Открыть меню" aria-expanded={menuOpen} aria-controls="dashboard-navigation" onClick={() => setMenuOpen(true)}><Menu size={20}/></button><div><p>{groups.find(g => g.ids.includes(tab))?.label || 'Управленческая аналитика'}</p><h1>{tabs.find(t => t.id === tab)?.label}</h1></div></header>
      {tab !== 'opiu' && tab !== 'users' && <DateControl mode={mode} setMode={setMode} start={start} setStart={setStart} end={end} setEnd={setEnd} compare={compare} setCompare={setCompare}/>}
      {['overview', 'cash', 'movements', 'balance', 'sales', 'plan', 'debt'].includes(tab) && canAccess(tab) && <ExcelExportButton key={tab} disabled={busy} options={{ section: (tab === 'movements' ? 'cash' : tab) as ReportSection, start, end, compare }}/> }
      </div>
      {tab !== 'opiu' && tab !== 'users' && <div className="source-note" role="status"><div><b>{busy ? 'Обновляем данные' : data.archive?.mode === 'archive' ? 'Архивные данные' : online ? 'Данные подключённых источников' : 'Нет доступных данных'}</b><small>{result?.key === key && result.error ? result.error : data.updatedAt ? `По состоянию на ${new Date(data.archive?.observedAt || data.updatedAt).toLocaleString('ru-RU')}` : 'Ожидаем данные.'}</small>{data.archive?.message && <details className="archive-freshness"><summary>Проверка актуальности</summary><p>{data.archive.message}</p></details>}</div></div>}
      <div className="content" aria-busy={busy}>
        {busy && <p role="status">Загружаем данные за {rangeLabel(start, end)}…</p>}
        {canAccess('movements') && tab === 'movements' && <Cash live={cashLive} open={setDetail} planning={sectionData(data, 'cash').planningSummary || data.planningSummary}/>}
        {canAccess('salary') && tab === 'salary' && <SourceUnavailable title="Заработная плата" fields="начисления и выплаты сотрудникам"/>}
        {canAccess('projects') && tab === 'projects' && <SourceUnavailable title="Потоки по проектам" fields="проект операции: в текущем наборе ДДС нет подтверждённой привязки к проектам"/>}
        {canAccess('plan') && tab === 'plan' && <PlanningPanel data={sectionData(data, 'plan')} start={start} end={end} compare={compare} loading={busy} canConfigure={role === 'admin'} onConfigure={() => { navigate('settings'); requestAnimationFrame(() => document.getElementById('planning-sources')?.scrollIntoView({ behavior: 'smooth', block: 'start' })); }}/>}
        {role === 'admin' && tab === 'users' && <section role="tabpanel" id="panel-users" aria-labelledby="tab-users"><UsersPanel/></section>}
        {canAccess('overview') && <section role="tabpanel" id="panel-overview" aria-labelledby="tab-overview" hidden={tab!=='overview'}><OperationalPanel compare={compare} data={data.operational} onConfigure={role === 'admin' ? () => navigate('settings') : undefined}/></section>}
        {canAccess('cash') && <section role="tabpanel" id="panel-cash" aria-labelledby="tab-cash" hidden={tab!=='cash'}><Cash live={cashLive} open={setDetail} planning={sectionData(data, 'cash').planningSummary || data.planningSummary}/></section>}
        {canAccess('sales') && <section role="tabpanel" id="panel-sales" aria-labelledby="tab-sales" hidden={tab!=='sales'}><Sales live={salesLive}/></section>}
        {canAccess('goods') && <section role="tabpanel" id="panel-goods" aria-labelledby="tab-goods" hidden={tab!=='goods'}><SourceUnavailable title="Управление товаром" fields="остатки, себестоимость и движения товара"/></section>}
        {canAccess('logistics') && <section role="tabpanel" id="panel-logistics" aria-labelledby="tab-logistics" hidden={tab!=='logistics'}><SourceUnavailable title="Логистика" fields="доставки, перевозчик и стоимость доставки"/></section>}
        {canAccess('debt') && <section role="tabpanel" id="panel-debt" aria-labelledby="tab-debt" hidden={tab!=='debt'}><ReceivablesPanel report={data.receivables} loading={busy} error={result?.error} refresh={role === 'admin' ? refreshData : undefined} start={start} end={end} compare={compare}/><NlpkPayablesPanel compare={compare} comparison={sectionData(data, 'debt').nlpkComparison || data.nlpkComparison} rows={sectionData(data, 'debt').nlpkPayables || data.nlpkPayables} configured={sectionData(data, 'debt').nlpkConfigured || data.nlpkConfigured} onConfigure={role === 'admin' ? () => navigate('settings') : undefined}/><div className="debt-cards">{data.sources?.payables?.error && <p className="connection-alert" role="alert">{data.sources.payables.error}</p>}<Kpi x={[data.sections?.debt?.creditor.total != null ? 'Кредиторская задолженность' : 'Кредиторская задолженность перед заводом', shortRub(data.sections?.debt?.creditor.total ?? debtLive.factoryDebt), debtLive.factoryDate || 'Дата не указана', 'Другие кредиторы в этом итоге не учтены', 'warn', Banknote]} open={() => setDetail('Кредиторская задолженность перед заводом')}/><Kpi x={['Оплаты поставщикам', shortRub(role === 'admin' ? debtLive.factoryPayments : data.debtPayments), 'За выбранный период', 'Существующий фильтр статей: завод / поставщик', 'good', ArrowUpRight]} open={() => setDetail('Оплаты поставщикам')}/></div></section>}
        {canAccess('opiu') && <section role="tabpanel" id="panel-opiu" aria-labelledby="tab-opiu" hidden={tab!=='opiu'}>{opiuVisited && <OpiuPanel canRefresh={role === 'admin'}/>}</section>}
        {canAccess('balance') && <section role="tabpanel" id="panel-balance" aria-labelledby="tab-balance" hidden={tab!=='balance'}><Heading eye="Финансы" title="Баланс"/><Balance data={data} loading={busy} error={result?.key === key ? result.error : undefined}/></section>}
        {role === 'admin' && <section role="tabpanel" id="panel-settings" aria-labelledby="tab-settings" hidden={tab!=='settings'}>{tab === 'settings' && <ArchivePanel start={start} end={end}/>}<SourcesPanel showWalletSettings={tab === 'settings'} refreshCalculations={refreshCalculations} financial={data.operational} role={role} sources={sources} refresh={refreshData} busy={busy} start={start} end={end} managers={salesLive.managers.map(manager => manager.name)}/></section>}
      </div>
    </div>
    {menuOpen && <button className="nav-backdrop" aria-label="Закрыть меню" onClick={() => setMenuOpen(false)}/>}
    <aside ref={sidebar} id="dashboard-navigation" className={`dashboard-sidebar${menuOpen ? ' is-open' : ''}`} role={menuOpen ? 'dialog' : undefined} aria-modal={menuOpen || undefined} aria-label="Навигация"><button className="menu-close" aria-label="Закрыть панель меню" onClick={() => setMenuOpen(false)}><X size={22}/></button><div className="brand"><b>МТ</b><span><strong>Март-Трейд</strong><small>{role==='admin'?'Администратор':'Просмотр дашборда'}</small></span></div><div className="nav-mode-switch"><small>РАЗДЕЛЫ</small>{visibleGroups.map(group => <button key={group.key} className={group.ids.includes(tab) ? 'selected' : ''} aria-pressed={group.ids.includes(tab)} onClick={() => navigate(group.ids[0] as Tab)}>{group.label}</button>)}</div><nav aria-label="Разделы дашборда">{visibleGroups.map(group => <div className="nav-group" key={group.key} hidden={!group.ids.includes(tab)}>
      {group.label && <button type="button" id={`nav-${group.key}-toggle`} className={`nav-group-title nav-group-toggle${group.ids.includes(tab) ? ' has-active-child' : ''}`} aria-expanded={Boolean(expanded[group.key])} aria-controls={`nav-${group.key}-items`} onClick={() => saveGroups({ ...expanded, [group.key]: !expanded[group.key] })}><span>{group.label}</span><ChevronDown size={16} aria-hidden="true"/></button>}
      <div id={`nav-${group.key}-items`} className={`nav-group-items${group.label ? ' nav-submenu' : ''}`}>
        {group.ids.map(id => { const t = tabs.find(item => item.id === id)!; const Icon = t.icon; return <a id={`tab-${t.id}`} href={t.id === 'balance' ? '/balance' : t.id === 'overview' ? '/' : `/?tab=${t.id}`} aria-current={tab === t.id ? 'page' : undefined} className={tab === t.id ? 'active' : ''} key={t.id} onClick={event => { if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); navigate(t.id); }}><Icon size={20}/>{t.label}</a>; })}
      </div>
    </div>)}</nav><div className="nav-bottom"><small className="source-card-label">ИСТОЧНИКИ ДАННЫХ</small><p><i/><span><b>{busy?'Обновление…':online?'Есть подключённые источники':'Источники не подключены'}</b><small>{data.updatedAt?new Date(data.updatedAt).toLocaleString('ru-RU'):'Актуальность не подтверждена'}</small></span></p></div></aside>
    {detail && <div className="modal" onClick={()=>setDetail(null)}><article role="dialog" aria-modal="true" aria-label={detail} onClick={e=>e.stopPropagation()}><button className="close" aria-label="Закрыть" onClick={()=>setDetail(null)}><X/></button><h2>{detail}</h2><p>Период: {rangeLabel(start,end)}.</p><p>Обновлено: {data.updatedAt ? new Date(data.updatedAt).toLocaleString('ru-RU') : 'Нет подтверждённых данных'}.</p><p>{tab === 'cash' ? 'Сбор средств — положительные операции ДДС; расходы — сумма отрицательных операций; операционный остаток — их разность. Остатки берутся из источника на указанную дату.' : 'Продажи — сумма по строкам заказов за выбранный период. Заказы считаются по уникальным заполненным номерам, менеджеры — по заполненным значениям источника.'}</p><button className="primary" onClick={()=>setDetail(null)}>Закрыть</button></article></div>}
  </main>;
}
