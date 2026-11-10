'use client';
import WalletPercentageSettings from './wallet-percentage-settings';
import type { Operational } from './lib/operational';
import { useEffect, useRef, useState } from 'react';
import type { SourceStatus } from './lib/dashboard-data';
import type { Role } from './lib/auth';
import { bindingIssues, capabilities, datasets, sections, sourceTypes, type Binding, type Connection, type ConnectionInput, type Dataset, type Inspection, type SourceType, type StorageStatus } from './lib/connections/model';
const methods = { cash: '/v1/transaction', balances: '/v1/moneybag', pnl: '/v1/pnl-item' };
const statuses: Record<string, string> = { connected: 'Подключён', checked: 'Доступ проверен', not_checked: 'Не проверен', needs_sync: 'Нужно обновить данные', disabled: 'Отключён', not_configured: 'Не подключён', loading: 'Проверяется', check_error: 'Ошибка проверки', sync_error: 'Ошибка обновления', adapter_required: 'Требуется адаптер CRM' };
const time = (value?: string) => value ? new Date(value).toLocaleString('ru-RU') : 'ещё не было';
async function api(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(path, { method, cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  if (response.status === 401) { window.location.replace('/login'); throw new Error('Сессия завершена'); }
  const result = await response.json().catch(() => ({ error: `Сервер вернул ошибку HTTP ${response.status}. Повторите запрос.` }));
  if (!response.ok) throw new Error(result.error || 'Операция не выполнена');
  return result;
}
export function SourceStatusCards({ sources }: { sources: Record<string, SourceStatus> }) {
  return <div className="source-cards">{Object.entries(sources).map(([key, source]) => <article className="panel" key={key}><h3>{source.name}</h3><p>{statuses[source.status] || (source.available ? 'Данные доступны' : 'Нет подтверждённых данных')}</p><p>Последнее успешное обновление: {time(source.updatedAt)}</p><p>{source.purpose || (key === 'fintablo' ? 'ДДС, остатки и финансовые показатели' : key === 'debt' ? 'Google Sheets — дебиторка / кредиторка' : source.freshness)}</p>{source.error && <p className="connection-alert" role="alert">{source.error}</p>}</article>)}</div>;
}
export default function SourcesPanel({ role, sources, refresh, busy, start, end, managers, financial, refreshCalculations, showWalletSettings = true }: { showWalletSettings?: boolean; refreshCalculations: () => Promise<void>; financial?: Operational; role: Role; sources: Record<string, SourceStatus>; refresh: () => void; busy: boolean; start: string; end: string; managers: string[] }) {
  return <section className="admin-sources" aria-label={role === 'admin' ? 'Источники данных' : 'Статус источников'}>
    <div className="heading"><div><span>{role === 'admin' ? 'Администрирование' : 'Состояние данных'}</span><h2>{role === 'admin' ? 'Источники данных' : 'Статус источников'}</h2></div></div>
    {role === 'admin' && showWalletSettings && <WalletPercentageSettings refresh={refreshCalculations} financial={financial}/>}
    <SourceStatusCards sources={sources}/>
    {role === 'admin' && <AdminConnections refresh={refresh} busy={busy} start={start} end={end} managers={managers}/>}
  </section>;
}
function AdminConnections({ refresh, busy, start, end, managers }: { refresh: () => void; busy: boolean; start: string; end: string; managers: string[] }) {
  const [storage, setStorage] = useState<StorageStatus>({ available: false, message: 'Проверяем хранилище подключений…' });
  const [connections, setConnections] = useState<Connection[]>([]);
  const [editing, setEditing] = useState<Connection | 'new' | 'new-plan' | null>(null);
  const [pending, setPending] = useState('');
  const [message, setMessage] = useState('');
  const [version, setVersion] = useState(0);
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    let active = true;
    api('/api/connections/readiness').then(async (status: StorageStatus) => {
      if (!active) return;
      setStorage(status);
      if (status.available) {
        const result = await api('/api/connections');
        if (active) { setStorage(result.storage); setConnections(result.connections); }
      } else { setConnections([]); setEditing(null); }
    }).catch(() => { if (active) { setStorage({ available: false, message: 'Не удалось проверить готовность системы. Повторите проверку.' }); setEditing(null); } }).finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [version]);
  async function action(c: Connection, kind: 'check' | 'sync' | 'disable' | 'enable' | 'delete') {
    if (kind === 'delete' && !window.confirm(`Удалить подключение «${c.name}», его связи и сохранённые результаты?`)) return;
    if (kind === 'disable' && !window.confirm(`Отключить подключение «${c.name}»? Его данные перестанут обновляться.`)) return;
    setPending(c.id); setMessage('');
    try {
      const result = kind === 'check' || kind === 'sync'
        ? await api(`/api/connections/${c.id}/${kind}`, 'POST', kind === 'sync' ? { start, end } : {})
        : await api(`/api/connections/${c.id}`, kind === 'delete' ? 'DELETE' : 'POST', { action: kind, revision: c.revision, confirm: kind === 'delete' });
      setMessage(result.message || 'Изменения сохранены'); setVersion(v => v + 1); refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Операция не выполнена'); }
    finally { setPending(''); }
  }
  const readiness = <section className="panel" aria-label="Готовность системы">
    <h3>{checking ? 'Проверяем готовность системы' : storage.available ? 'Система готова к подключению источников' : 'Требуется первоначальная настройка хранилища'}</h3>
    <p role="status">{checking ? 'Проверяем базу, миграцию и серверный ключ…' : storage.message}</p>
    <ul className="readiness-checks">{([['database', 'База подключена'], ['migration', 'Миграция применена'], ['encryption', 'Ключ шифрования задан']] as const).map(([key, label]) => <li key={key}><b>{label}</b><span>{checking ? 'Проверяется' : ({ ready: 'Готово', missing: 'Не настроено', error: 'Ошибка', unchecked: 'Не проверено' }[storage.checks?.[key] || 'unchecked'])}</span></li>)}</ul>
    {!checking && !storage.available && <p>Техническая настройка выполняется один раз: подключите базу, задайте серверный ключ и примените миграцию. После этого все источники добавляются и управляются здесь, без переходов в Vercel.</p>}
    <button type="button" disabled={checking} onClick={() => { setChecking(true); setVersion(v => v + 1); }}>Проверить готовность системы</button>
  </section>;
  if (checking || !storage.available) return readiness;
  return <>
    {readiness}
    <section className="panel" id="planning-sources"><h3>Источники планирования</h3><p>Подключите Google Sheets с планами поступлений и списаний. Для каждого направления назначьте лист и колонки: плановая дата, категория, сумма. Период выбирается в разделе «Планирование».</p><div className="settings-actions"><button className="primary" type="button" onClick={() => setEditing('new-plan')}>Добавить источник планов</button>{connections.filter(c => c.type === 'googleSheets').map(c => <button key={c.id} type="button" onClick={() => setEditing(c)}>Добавить планы в «{c.name}»</button>)}</div></section>
    <section className="panel"><h3>Управление подключениями</h3><p role="status">{storage.message}</p><p>Синхронизация: {start} — {end}, включая предыдущий период для сравнения. Существующие серверные подключения продолжают работать до явного назначения новых источников.</p><div className="settings-actions"><button className="primary" type="button" onClick={() => setEditing('new')}>Добавить подключение</button><button className="primary" type="button" onClick={refresh} disabled={busy}>Обновить действующие данные</button></div></section>
    {message && <p role="status" className="hint">{message}</p>}
    <div className="connection-list">{connections.map(c => <article key={c.id} className="panel connection-card"><div className="panel-head"><div><h3>{c.name}</h3><p>{c.type === 'fintablo' ? 'ДДС, остатки и финансовые показатели' : c.type === 'debt' ? 'Google Sheets — дебиторка / кредиторка' : c.bindings.map(b => datasets[b.dataset].label).join(', ')}</p>{c.enabled && c.type !== 'debt' && !c.bindings.length && <p className="connection-alert" role="alert">Добавьте связь с разделом, выберите набор данных и подтвердите сопоставление.</p>}<p>{sourceTypes[c.type]} · {statuses[c.status] || 'Нужна проверка'}</p></div></div><p>Последняя успешная синхронизация: {time(c.lastSuccess)}</p><p>Проверка доступа: {time(c.checkedAt)}</p>{c.error && <p role="status" className="attention">{c.error}</p>}<div className="settings-actions"><button type="button" onClick={() => setEditing(c)}>Редактировать</button><button className="primary" type="button" disabled={Boolean(pending)} onClick={() => action(c, 'check')}>Проверить подключение</button><button className="primary" type="button" disabled={Boolean(pending) || !c.enabled} onClick={() => action(c, 'sync')}>Обновить данные</button><button className={c.enabled ? "danger" : "primary"} type="button" disabled={Boolean(pending)} onClick={() => action(c, c.enabled ? 'disable' : 'enable')}>{c.enabled ? 'Отключить' : 'Включить'}</button><button className="danger" type="button" disabled={Boolean(pending)} onClick={() => action(c, 'delete')}>Удалить</button></div></article>)}</div>
    {!connections.length && <p className="hint">Сохранённых подключений пока нет. Новая форма остаётся черновиком до успешного сохранения на сервере.</p>}
    {editing && <ConnectionEditor key={typeof editing === 'string' ? editing : `${editing.id}:${editing.revision}`} connection={typeof editing === 'string' ? undefined : editing} planning={editing === 'new-plan'} storage={storage} managers={managers} close={() => setEditing(null)} saved={(connection, message) => { setMessage(message); setEditing(connection); setVersion(v => v + 1); refresh(); }}/>} 
    <section className="panel"><h3>Связь с разделами</h3><p>Раздел поддерживает несколько источников и листов. Для одного показателя выберите основной источник, резервный или объединение строк. Приоритет: меньшее число выше; одинаковые строки при объединении учитываются один раз.</p>{Object.entries(sections).map(([section, label]) => <div className="source-link-summary" key={section}><h4>{label}</h4>{connections.flatMap(c => c.bindings.filter(b => b.section === section).map(b => <div key={`${c.id}:${b.dataset}:${b.sheet}`}><b>{c.name} · {datasets[b.dataset].label}</b><p>{b.sheet || 'Набор ещё не выбран'} · {b.mode === 'merge' ? 'Объединение строк' : b.mode === 'fallback' ? 'Резервный' : 'Основной'} · Приоритет {b.priority ?? 50} · {c.enabled ? statuses[c.status] || c.status : 'Отключён'} · Обновление: {time(c.lastSuccess)}</p><small>{Object.keys(b.columns).length ? Object.keys(b.columns).map(field => `${field} → колонка ${b.columns[field] + 1}`).join('; ') : 'Поля реализованного API-адаптера'}</small></div>))}{!connections.some(c => c.bindings.some(b => b.section === section)) && <p>Новое назначение не задано. Используются только прежние подтверждённые данные, если они доступны.</p>}</div>)}</section>
  </>;
}
function planBinding(dataset: 'planReceipts' | 'planPayments'): Binding { return { dataset, section: 'plan', sheet: '', headerRow: 1, columns: {}, confirmed: false }; }
function ConnectionEditor({ connection, planning = false, storage, close, saved, managers }: { connection?: Connection; planning?: boolean; storage: StorageStatus; managers: string[]; close: () => void; saved: (connection: Connection, message: string) => void }) {
  const [draft, setDraft] = useState<ConnectionInput>(connection || { name: '', type: 'googleSheets', enabled: true, config: {}, bindings: planning ? [planBinding('planReceipts'), planBinding('planPayments')] : [] });
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [metadata, setMetadata] = useState<Record<number, Inspection>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(Boolean(connection && (connection.type === 'googleSheets' || connection.type === 'debt')));
  const [errorMessage, setErrorMessage] = useState('');

  const form = useRef<HTMLFormElement>(null);
  function secrets() { const values = new FormData(form.current!); return Object.fromEntries(['token', 'serviceAccountEmail', 'privateKey'].map(key => [key, values.get(key) || ''])); }
  function clearSecrets() { for (const name of ['token', 'serviceAccountEmail', 'privateKey']) { const field = form.current?.elements.namedItem(name); if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) field.value = ''; } }
  function config(key: keyof ConnectionInput['config'], value: string) { setDraft(d => ({ ...d, config: { ...d.config, [key]: value }, bindings: d.bindings.map(b => ({ ...b, confirmed: false })) })); setMetadata({}); setInspection(null); }
  function binding(index: number, value: Partial<Binding>) { setDraft(d => ({ ...d, bindings: d.bindings.map((b, i) => i === index ? { ...b, confirmed: false, ...value } : b) })); }
  async function inspect(index?: number, selected?: Binding) {
    setBusy(true); setMessage(''); setErrorMessage('');
    try {
      const b = selected || (index == null ? undefined : draft.bindings[index]);
      const result: Inspection = await api('/api/connections/inspect', 'POST', { ...draft, name: draft.name || sourceTypes[draft.type], id: connection?.id, secrets: secrets(), sheet: b?.sheet, headerRow: b?.headerRow });
      if (index == null) setInspection(result); else setMetadata(m => ({ ...m, [index]: result }));
      setMessage(result.message);
    } catch (error) { setErrorMessage(error instanceof Error ? error.message : 'Проверка не завершена'); }
    finally { setBusy(false); }
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (missing.length) return; setBusy(true); setMessage(''); setErrorMessage('');
    try { const result = await api(connection ? `/api/connections/${connection.id}` : '/api/connections', 'POST', { ...draft, revision: connection?.revision, secrets: secrets() }); clearSecrets(); saved(result.connection, result.message || 'Подключение сохранено в базе.'); }
    catch (error) { setErrorMessage(error instanceof Error ? error.message : 'Сохранение не выполнено'); }
    finally { clearSecrets(); setBusy(false); }
  }
  useEffect(() => {
    if (!connection || (connection.type !== 'googleSheets' && connection.type !== 'debt')) return;
    let active = true;
    const request = (b?: Binding) => api('/api/connections/inspect', 'POST', { ...connection, sheet: b?.sheet, headerRow: b?.headerRow });
    request().then(async result => {
      if (!active) return;
      setInspection(result);
      const results = await Promise.all(connection.bindings.map(async (b, index) => {
        if (!b.sheet) return;
        try { const meta = await request(b); if (active) setMetadata(m => ({ ...m, [index]: meta })); }
        catch (error) { if (active) setErrorMessage(`Связь ${index + 1}: ${error instanceof Error ? error.message : 'Не удалось загрузить колонки'}`); }
      }));
      return results;
    }).catch(error => { if (active) setErrorMessage(error instanceof Error ? error.message : 'Не удалось загрузить листы'); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [connection]);
  const missing = draft.bindings.flatMap((b, index) => {
    const issues = bindingIssues(draft.type, b);
    if (metadata[index]?.headers) for (const [field, col] of Object.entries(b.columns)) {
      if (!metadata[index].headers?.some(h => h.index === col && h.label === b.headers?.[field])) issues.push(`Повторно назначьте поле «${(datasets[b.dataset].fields as Record<string, string>)[field]}»: заголовок источника изменился`);
    }
    return issues.map(issue => `Связь ${index + 1} — ${sections[b.section]}: ${issue}`);
  });
  const google = draft.type === 'googleSheets' || draft.type === 'debt';
  return <section className="panel source-editor" aria-label="Редактор подключения"><div className="panel-head"><h3>{connection ? 'Редактирование подключения' : 'Новое подключение'}</h3><button type="button" disabled={busy} onClick={close}>Закрыть</button></div>
    <form ref={form} method="post" action={connection ? `/api/connections/${connection.id}` : '/api/connections'} autoComplete="off" onSubmit={save}>
      <ol className="hint"><li>Введите название и реквизиты, затем сохраните подключение без связей.</li><li>Проверьте сохранённое подключение и выберите реальные листы или счета.</li><li>Сопоставьте поля, подтвердите вкладки и сохраните связи.</li><li>Нажмите «Обновить данные» для выбранного периода.</li></ol>
      <fieldset className="settings-form" disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}><legend className="sr-only">Настройки подключения</legend>
      <label>Название подключения<input name="name" value={draft.name} maxLength={120} required onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}/></label>
      <label>Тип источника<select name="sourceType" value={draft.type} disabled={Boolean(connection)} onChange={e => { setDraft(d => ({ ...d, type: e.target.value as SourceType, config: {}, bindings: [] })); setInspection(null); setMetadata({}); clearSecrets(); }}>{Object.entries(sourceTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {draft.type === 'debt' && <p className="debt-note">Текущая дебиторка читается из двух исходных листов, история — из «Архив ДЗ». Выберите названия исходных листов ниже; сохранённые настройки доступны после перезапуска и деплоя. Заголовки определяются по названиям из регламента. Сохраните одно включённое подключение задолженности; отдельная связь с готовым «Лист6» для этого расчёта не нужна. Обновление выполняется кнопкой «Обновить данные» в «Расчётах и обязательствах».</p>}
      {draft.type === 'debt' && <><label>Лист транзитных заказов<input value={draft.config.debtTransitSheet || ''} placeholder="Транзит" onChange={e => config('debtTransitSheet', e.target.value)}/></label><label>Лист складских заказов<input value={draft.config.debtStockSheet || ''} placeholder="Склад" onChange={e => config('debtStockSheet', e.target.value)}/></label></>}
      {google ? <><label>Ссылка или ID таблицы<input name="spreadsheetId" value={draft.config.spreadsheetId || ''} onChange={e => config('spreadsheetId', e.target.value)}/></label><label>Email сервисного аккаунта<input name="serviceAccountEmail" type="email" autoComplete="off" placeholder={connection?.secretFields.includes('serviceAccountEmail') ? '•••••••• — сохранено, пустое поле не меняет значение' : 'Email сервисного аккаунта'}/></label><label>Private key сервисного аккаунта<textarea name="privateKey" autoComplete="off" spellCheck={false} rows={3} placeholder={connection?.secretFields.includes('privateKey') ? '•••••••• — ключ сохранён, введите новый только для замены' : 'Ключ вводится только для передачи на сервер'}/></label></> : <>
        {draft.type === 'crm' && <label>Название CRM<input name="crmName" value={draft.config.crmName || ''} onChange={e => config('crmName', e.target.value)}/></label>}
        <label>Базовый API URL<input name="baseUrl" type="url" value={draft.config.baseUrl || ''} placeholder={draft.type === 'fintablo' ? 'https://api.fintablo.ru' : 'HTTPS URL из документации вашей CRM'} onChange={e => config('baseUrl', e.target.value)}/></label>
        {draft.type === 'crm' && <><label>Документация API<input name="documentationUrl" type="url" value={draft.config.documentationUrl || ''} onChange={e => config('documentationUrl', e.target.value)}/></label><label>Способ авторизации (подтвердить по документации)<select name="authMethod" value={draft.config.authMethod || ''} onChange={e => config('authMethod', e.target.value)}><option value="">Не уточнён</option><option value="token">API-токен</option><option value="oauth2">OAuth 2.0 — нужен адаптер</option><option value="other">Другой — требуется документация</option></select></label></>}
        <label>API-токен<input name="token" type="password" autoComplete="new-password" placeholder={connection?.secretFields.includes('token') ? '•••••••• — токен сохранён, пустое поле не меняет значение' : ''}/></label>
      </>}
      {connection?.secretMasks && <div className="secret-masks" aria-label="Сохранённые реквизиты">{Object.entries(connection.secretMasks).map(([field, mask]) => <p key={field}>{({ token: 'API-токен', serviceAccountEmail: 'Email сервисного аккаунта', privateKey: 'Private key' } as Record<string, string>)[field]}: <span>{mask}</span> — сохранено на сервере</p>)}<p>Чтобы заменить реквизит, введите новое значение в его поле. Пустые поля сохраняют прежние значения.</p></div>}
      <p className="hint">Сохранённые секреты не возвращаются в браузер. После сохранения поля очищаются. Проверка использует введённые или ранее сохранённые реквизиты.</p>
      <button className="primary" type="button" disabled={busy} onClick={() => inspect()}>Проверить подключение</button>
      {inspection?.sheets && <p>Найдены листы: {inspection.sheets.map(s => s.title).join(', ')}</p>}
      {draft.type === 'fintablo' && <><p>Счета загружаются только из реального API после проверки. Отдельный выбор организаций требует подтверждённого метода. ОПиУ используется без фильтра счетов.</p>{inspection?.accounts && <fieldset><legend>Используемые счета (пустой выбор — все доступные)</legend>{inspection.accounts.map(account => <label className="check-label" key={account.id}><input type="checkbox" checked={draft.config.accountIds?.includes(account.id) || false} onChange={e => setDraft(d => ({ ...d, config: { ...d.config, accountIds: e.target.checked ? [...(d.config.accountIds || []), account.id] : d.config.accountIds?.filter(id => id !== account.id) } }))}/>{account.name}</label>)}</fieldset>}</>}
      {draft.type === 'crm' && <section className="source-requirements"><h4>Подготовка CRM</h4><p>Нужны название системы, документация API, URL и подтверждённый способ авторизации. Произвольный URL не вызывается до реализации адаптера.</p><p>Воронки и менеджеры появятся после проверки реального API. Фильтр периода берётся из дашборда. Сопоставление менеджеров и полей: менеджер, сделка, дата, сумма, этап, статус, клиент — предусмотрено моделью подключения.</p><label>Воронка<select disabled={!inspection?.pipelines?.length} value={draft.config.pipelineId || ''} onChange={e => config('pipelineId', e.target.value)}><option value="">{inspection?.pipelines?.length ? 'Все доступные' : 'Нужен CRM-адаптер'}</option>{inspection?.pipelines?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>{inspection?.managers?.length ? inspection.managers.map(manager => <label key={manager.id}>{manager.name} → менеджер дашборда<select value={draft.config.managerMapping?.[manager.id] || ''} onChange={e => setDraft(d => ({ ...d, config: { ...d.config, managerMapping: { ...d.config.managerMapping, [manager.id]: e.target.value } } }))}><option value="">Не назначено</option>{managers.map(name => <option key={name}>{name}</option>)}</select></label>) : <label>Менеджеры CRM → менеджеры дашборда<select disabled><option>Сначала получить реальный список менеджеров</option></select></label>}</section>}
      <h4>Связь с разделами</h4><p>Для НЛПК выберите набор «Кредиторская задолженность НЛПК», назначьте дату остатка и сумму долга. Лист должен содержать только остатки НЛПК; документы на одну дату суммируются, разные даты не складываются. Для планов доступны наборы «План поступлений» и «План списаний».</p><p>Можно подключить несколько листов и источников к разделу. Для повторного показателя задайте правило обработки.</p><p>Для товара и логистики нужны подтверждённые наборы и формулы. Связь появится после добавления соответствующей схемы адаптера.</p>
      {draft.bindings.map((b, index) => {
        const meta = metadata[index], sheets = meta?.sheets || inspection?.sheets;
        return <fieldset className="binding-editor" key={index}><legend>Связь {index + 1}</legend>
          <label>Набор данных<select value={b.dataset} onChange={e => { const dataset = e.target.value as Dataset; binding(index, { dataset, section: datasets[dataset].sections[0], columns: {}, sheet: draft.type === 'fintablo' ? methods[dataset as keyof typeof methods] || '' : '' }); setMetadata(m => ({ ...m, [index]: { ...m[index], headers: [], message: '', checkedAt: '' } })); }}>{capabilities[draft.type].map(key => <option key={key} value={key}>{datasets[key].label}</option>)}</select></label>
          <label>Целевая вкладка<select value={b.section} onChange={e => binding(index, { section: e.target.value as Binding['section'] })}>{Object.entries(sections).map(([key, title]) => <option key={key} value={key} disabled={!(datasets[b.dataset].sections as readonly string[]).includes(key)}>{title}</option>)}</select></label>
          {draft.type === 'debt' && <p className="debt-note">Текущая дебиторка читается из двух исходных листов, история — из «Архив ДЗ». Выберите названия исходных листов ниже; сохранённые настройки доступны после перезапуска и деплоя. Заголовки определяются по названиям из регламента. Сохраните одно включённое подключение задолженности; отдельная связь с готовым «Лист6» для этого расчёта не нужна. Обновление выполняется кнопкой «Обновить данные» в «Расчётах и обязательствах».</p>}
      {google ? <><label>Лист<select value={b.sheet} onChange={e => { const selected = { ...b, sheet: e.target.value, columns: {}, headers: {}, confirmed: false }; binding(index, selected); if (selected.sheet) void inspect(index, selected); setMetadata(m => ({ ...m, [index]: { ...m[index], headers: [], message: '', checkedAt: '' } })); }}><option value="">{sheets?.length ? 'Выберите лист' : 'Сначала проверьте подключение'}</option>{b.sheet && !sheets?.some(s => s.title === b.sheet) && <option value={b.sheet}>{b.sheet} (сохранённое назначение)</option>}{sheets?.map(sheet => <option key={sheet.title}>{sheet.title}</option>)}</select></label><label>Строка заголовков<input type="number" min={1} max={100} value={b.headerRow} onChange={e => { const selected = { ...b, headerRow: Number(e.target.value), columns: {}, headers: {}, confirmed: false }; binding(index, selected); if (selected.sheet && selected.headerRow >= 1 && selected.headerRow <= 100) void inspect(index, selected); setMetadata(m => ({ ...m, [index]: { ...m[index], headers: [], message: '', checkedAt: '' } })); }}/></label><button type="button" disabled={busy || !b.sheet} onClick={() => inspect(index)}>Получить заголовки колонок</button>
            {Object.entries(datasets[b.dataset].fields).map(([field, label]) => <label key={field}>{label}{(datasets[b.dataset].required as readonly string[]).includes(field) ? ' * (обязательно)' : ' (необязательно)'}<select value={b.columns[field] ?? ''} onChange={e => { const columns = { ...b.columns }; if (e.target.value === '') delete columns[field]; else columns[field] = Number(e.target.value); binding(index, { columns, headers: Object.fromEntries(Object.entries(columns).flatMap(([key, col]) => { const label = meta?.headers?.find(h => h.index === col)?.label || b.headers?.[key]; return label ? [[key, label]] : []; })) }); }}><option value="">Не назначено</option>{b.columns[field] != null && !meta?.headers?.some(h => h.index === b.columns[field]) && <option value={b.columns[field]}>Колонка {b.columns[field] + 1} (обновите заголовки)</option>}{meta?.headers?.map(header => <option key={header.index} value={header.index}>{header.index + 1}. {header.label}</option>)}</select></label>)}
          </> : draft.type === 'fintablo' ? <p>FinTablo API: {b.sheet}. Листы и ручное сопоставление колонок не требуются; поля загружает адаптер.</p> : <>{Object.entries(datasets.orders.fields).map(([field, label]) => <label key={field}>{label}<select disabled={!inspection?.fields?.length} value={b.apiFields?.[field] || ''} onChange={e => binding(index, { apiFields: { ...b.apiFields, [field]: e.target.value } })}><option value="">Нужно получить поля реальной CRM</option>{inspection?.fields?.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}</select></label>)}</>}
          <label>Режим источника<select value={b.mode || 'primary'} onChange={e => binding(index, { mode: e.target.value as Binding['mode'] })}><option value="primary">Основной</option><option value="fallback">Резервный при недоступности основного</option><option value="merge" disabled={b.dataset === 'balances' || b.dataset === 'nlpkPayables'}>Объединение строк без повторов</option></select></label>
          <label>Приоритет (0 — самый высокий)<input type="number" min="0" max="100" value={b.priority ?? 50} onChange={e => binding(index, { priority: Number(e.target.value) })}/></label>
          <label className="check-label"><input type="checkbox" checked={b.confirmed} onChange={e => binding(index, { confirmed: e.target.checked, headers: meta?.headers ? Object.fromEntries(Object.entries(b.columns).flatMap(([field, col]) => { const label = meta.headers?.find(h => h.index === col)?.label; return label ? [[field, label]] : []; })) : b.headers })}/>Подтверждаю назначение полей и целевой раздел</label><button className="danger" type="button" onClick={() => { if (!window.confirm("Убрать связь с разделом? Изменение применится после сохранения.")) return; setDraft(d => ({ ...d, bindings: d.bindings.filter((_, i) => i !== index) })); setMetadata({}); }}>Убрать связь</button>
        </fieldset>;
      })}
      {draft.type === 'googleSheets' && <div className="settings-actions">{(['planReceipts', 'planPayments'] as const).map(dataset => <button key={dataset} type="button" onClick={() => setDraft(d => ({ ...d, bindings: [...d.bindings, planBinding(dataset)] }))}>Добавить связь: {datasets[dataset].label}</button>)}</div>}
      <p className="hint">Сначала выберите набор данных — доступные целевые разделы зависят от него. Для планирования выберите «План поступлений» или «План списаний» в подключении Google Sheets.</p>
      <button className="primary" type="button" onClick={() => { const dataset = capabilities[draft.type][0]; setDraft(d => ({ ...d, bindings: [...d.bindings, { dataset, section: d.type === 'crm' ? 'sales' : datasets[dataset].sections[0], sheet: d.type === 'fintablo' ? methods[dataset as keyof typeof methods] || '' : '', headerRow: 1, columns: {}, confirmed: false }] })); }}>Добавить связь с разделом</button>

      <label className="check-label"><input type="checkbox" checked={draft.enabled} onChange={e => { const enabled = e.target.checked; if (!enabled && !window.confirm("Отключить подключение после сохранения?")) return; setDraft(d => ({ ...d, enabled })); }}/>Подключение включено</label>
      {missing.length > 0 && <div id="mapping-alert" role="alert" className="connection-alert"><strong>Настройка не завершена</strong><ul>{missing.map(issue => <li key={issue}>{issue}</li>)}</ul><p>Необязательные поля можно оставить «Не назначено».</p></div>}
      {errorMessage && <div role="alert" className="connection-alert"><strong>Операция не выполнена</strong><p>{errorMessage}</p></div>}
      <div className="settings-actions"><button type="submit" className="primary" disabled={!storage.available || busy || missing.length > 0} aria-describedby={missing.length ? "mapping-alert" : undefined}>Сохранить</button><button type="button" onClick={close}>Отмена</button></div>
      {!storage.available && <p>{storage.message}</p>}{message && <p role="status" className="hint">{message}</p>}
      </fieldset>
    </form>
  </section>;
}
