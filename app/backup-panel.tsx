'use client';
import { useEffect, useState } from 'react';
type Status = { enabled: boolean; temporary: boolean; dirty: boolean; lastDownload: string | null; maxFileBytes: number };
type Preview = { token: string; temporary: boolean; environmentRestore: string; summary: { createdAt: string; users: number; connections: number; rates: number; snapshots: number; reports: number; sourceArchives: number; environmentIncluded: boolean } };
async function post(body: unknown) {
  const response = await fetch('/api/backup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
  if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || 'Операция не выполнена.'); }
  return response;
}
export default function BackupPanel() {
  const [status, setStatus] = useState<Status | null>(null), [password, setPassword] = useState(''), [repeat, setRepeat] = useState('');
  const [statusError, setStatusError] = useState('');
  const [file, setFile] = useState<File | null>(null), [preview, setPreview] = useState<Preview | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  useEffect(() => { let active = true; const load = async () => { try { const r = await fetch('/api/backup', { cache: 'no-store' }); const data = await r.json(); if (!r.ok) throw new Error(data.error || 'Не удалось проверить резервные копии.'); if (active) { setStatus(data); setStatusError(''); } } catch (e) { if (active) setStatusError(e instanceof Error ? e.message : 'Не удалось проверить резервные копии.'); } }; void load(); const timer = setInterval(load, 30000); return () => { active = false; clearInterval(timer); }; }, []);
  async function download() {
    if (password.length < 12 || password !== repeat) { setMessage('Укажите пароль от 12 символов и повторите его без изменений.'); return; }
    setBusy(true); setMessage('');
    try {
      const response = await post({ action: 'download', password }); const blob = await response.blob(); const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = `mart-backup-${new Date().toISOString().slice(0,10)}.martbackup`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
      await post({ action: 'downloaded', revision: Number(response.headers.get('X-Backup-Revision')) });
      setMessage('Копия передана браузеру. Проверьте файл в загрузках и сохраните пароль отдельно.'); setPassword(''); setRepeat('');
      const r = await fetch('/api/backup', { cache: 'no-store' }); if (r.ok) setStatus(await r.json());
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Не удалось скачать копию.'); } finally { setBusy(false); }
  }
  async function restore(confirm = false) {
    if (!file) { setMessage('Выберите файл резервной копии.'); return; }
    if (status && file.size > status.maxFileBytes) { setMessage('Файл превышает поддерживаемый размер.'); return; }
    setBusy(true); setMessage('');
    try {
      const result = await (await post({ action: confirm ? 'restore' : 'preview', file: await file.text(), password, ...(confirm ? { confirm: true, token: preview?.token } : {}) })).json();
      if (confirm) { setPassword(''); window.location.reload(); } else setPreview(result);
    } catch (e) { setPreview(null); setMessage(e instanceof Error ? e.message : 'Не удалось прочитать копию.'); } finally { setBusy(false); }
  }
  return <section className="panel" aria-label="Резервные копии"><h3>Резервные копии</h3>{statusError && <p role="alert" className="attention">{statusError}</p>}
    <p>Скачайте зашифрованную копию пользователей, подключений, ставок и сохранённых данных на свой компьютер. Пароль копии не сохраняется и не восстанавливается.</p>
    {status?.temporary && <p className="attention" role="status">Временный режим: данные находятся в памяти одного процесса и исчезнут после перезапуска или обновления. После запуска потребуется вручную восстановить копию. {status.dirty ? 'Есть изменения после последней выдачи копии.' : 'После последней выдачи копии новых изменений не обнаружено.'}</p>}
    {status?.lastDownload && <p>Последняя выдача копии браузеру: {new Date(status.lastDownload).toLocaleString('ru-RU')}. Сохранение файла на диске проверьте самостоятельно.</p>}
    {status && !status.enabled && <p>Для копирования включите временный режим хранения или подключите PostgreSQL.</p>}
    <div className="settings-form"><label>Пароль резервной копии<input type="password" autoComplete="new-password" minLength={12} maxLength={256} value={password} disabled={busy} onChange={e => { setPassword(e.target.value); setPreview(null); }}/></label>
      <label>Повторите пароль для скачивания<input type="password" autoComplete="new-password" value={repeat} maxLength={256} disabled={busy} onChange={e => setRepeat(e.target.value)}/></label>
      <button type="button" className="primary" disabled={busy || !status?.enabled} onClick={download}>Скачать резервную копию</button>
      <label>Файл для восстановления<input type="file" accept=".martbackup" disabled={busy} onChange={e => { setFile(e.target.files?.[0] || null); setPreview(null); }}/></label>
      <button type="button" disabled={busy || !status?.enabled || !file} onClick={() => restore()}>Предварительный просмотр копии</button>
    </div>
    {preview && <div><h4>Подтверждение восстановления</h4><p>Копия от {new Date(preview.summary.createdAt).toLocaleString('ru-RU')}: пользователей — {preview.summary.users}, подключений — {preview.summary.connections}, ставок — {preview.summary.rates}, снимков — {preview.summary.snapshots}, отчётов — {preview.summary.reports}, архивов источников — {preview.summary.sourceArchives}.</p><p>Восстановление заменит текущие данные приложения. Настроенный на сервере администратор сохраняет доступ. Пользователям потребуется войти заново.</p>
      {preview.environmentRestore === 'manual' && preview.summary.environmentIncluded ? <p role="alert">Копия содержит серверные переменные. Для восстановления в PostgreSQL сначала перенесите настройки источников в переменные хостинга.</p> : <button type="button" className="primary" disabled={busy} onClick={() => restore(true)}>Подтвердить замену и восстановить</button>}
      <button type="button" disabled={busy} onClick={() => setPreview(null)}>Отмена</button></div>}
    <p role="status">{busy ? 'Выполняем операцию…' : message}</p>
  </section>;
}
