'use client';
import { useEffect, useState } from 'react';
import type { ArchiveEntry } from './lib/period-archive';
const date = (value: string | null) => value ? new Date(value).toLocaleString('ru-RU') : 'Ещё не создан';
export default function ArchivePanel({ start, end }: { start: string; end: string }) {
  const [now, setNow] = useState(0);
  const [entries, setEntries] = useState<ArchiveEntry[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState('dashboard');
  const [selection, setSelection] = useState({ start, end });
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    async function poll() {
      try {
        const response = await fetch('/api/archive', { cache: 'no-store', signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        if (alive) { setNow(Date.now()); setEntries(data.entries); setError(''); }
      } catch (e) { if (alive) setError(e instanceof Error ? e.message : 'Архив недоступен'); }
    }
    void poll();
    const timer = setInterval(poll, 4000);
    return () => { alive = false; controller.abort(); clearInterval(timer); };
  }, []);
  async function create(entry?: ArchiveEntry) {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/archive', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(entry ? { kind: entry.kind, start: entry.period_start, end: entry.period_end } : { kind, ...selection }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setMessage(data.message + '. Можно продолжать работу; статус обновляется автоматически.');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Не удалось запустить архив'); }
    finally { setBusy(false); }
  }
  return <section className="panel archive-panel"><h2>Архив периодов</h2>
    <p className="hint">Постоянное хранилище PostgreSQL. Снимки содержат детализацию и данные сравнения. Прошлые периоды хранятся бессрочно, в том числе после перезапуска и развёртывания приложения. Они обновляются при изменении данных, настроек или версии расчётов, либо вручную. Пятиминутный срок применяется только к текущим периодам. Версии таблиц проверяются без чтения ячеек. Для источников без доступной версии выполняется фоновая проверка при обращении к архиву, не чаще раза в час; неизменённый снимок не переписывается.</p>
    <div className="filterbar"><label>Отчёт<select value={kind} onChange={e => setKind(e.target.value)}><option value="dashboard">Дашборд</option><option value="opiu">ОПиУ · все доступные месяцы</option></select></label>
      {kind === 'dashboard' && <><label>С<input type="date" value={selection.start} onChange={e => setSelection({ ...selection, start: e.target.value })}/></label><label>По<input type="date" min={selection.start} value={selection.end} onChange={e => setSelection({ ...selection, end: e.target.value })}/></label></>}
      <button className="primary" onClick={() => void create()} disabled={busy || (kind === 'dashboard' && (!selection.start || !selection.end || selection.start > selection.end))}>{busy ? 'Запускаем…' : 'Создать/обновить архив'}</button>
    </div>
    {error && <p role="alert" className="attention">{error}</p>}{message && <p role="status">{message}</p>}
    <div className="scroll"><table><thead><tr><th>Отчёт / период</th><th>Последнее успешное создание</th><th>Данные прочитаны</th><th>Проверено содержимое</th><th>Версия</th><th>Статус / ошибка</th><th>Действие</th></tr></thead><tbody>
      {entries.map(e => <tr key={e.archive_key}><td>{e.kind === 'opiu' ? 'ОПиУ · все месяцы' : `${e.period_start} — ${e.period_end}`}</td><td>{date(e.created_at)}</td><td>{date(e.observed_at)}</td><td>{date(e.verified_at)}</td><td>{e.schema_version ?? '—'}<br/><small>{e.calculation_version || 'Прежняя версия'}</small></td><td>{e.lease_until ? Date.parse(e.lease_until) > now ? 'Создаётся…' : 'Обработка прервана. Можно повторить.' : e.last_error || (e.created_at ? 'Снимок сохранён; актуальность проверяется при загрузке' : 'Нет снимка')}</td><td><button type="button" className="primary" disabled={busy || Boolean(e.lease_until && Date.parse(e.lease_until) > now)} onClick={() => void create(e)}>Обновить</button></td></tr>)}
      {!entries.length && <tr><td colSpan={7}>Архивных периодов пока нет. Они появятся после успешной загрузки данных.</td></tr>}
    </tbody></table></div>
  </section>;
}
