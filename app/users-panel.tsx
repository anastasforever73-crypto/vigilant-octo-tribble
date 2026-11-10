'use client';
import { useEffect, useState } from 'react';
import { Pencil, Plus, Save, UserRound, X } from 'lucide-react';
import { sections, type Section } from './lib/connections/model';
import { validAccountPassword } from './lib/password-policy.mjs';

type User = { login: string; enabled: boolean; sections: Section[] };
type Registry = { users: User[]; version: string; writable: boolean; legacy?: { login: string } | null };
async function api(body?: unknown): Promise<Registry> {
  const response = await fetch('/api/users', { method: body ? 'POST' : 'GET', cache: 'no-store', credentials: 'same-origin', ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Пользователи недоступны.');
  return data;
}
export default function UsersPanel() {
  const [registry, setRegistry] = useState<Registry | null>(null);
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    api().then(data => { if (active) setRegistry(data); }).catch(error => { if (active) setError(error.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  return <section className="admin-users" aria-label="Пользователи">
    <div className="heading"><div><span>Администрирование</span><h2>Пользователи</h2></div><button className="primary" disabled={!registry?.writable || editing !== null} onClick={() => { setMessage(''); setEditing('new'); }}><Plus size={17}/>Создать пользователя</button></div>
    {loading && <p role="status">Загружаем пользователей…</p>}
    {error && <p className="attention" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {registry && !registry.writable && <p role="status">Создание и изменение пользователей пока недоступны. Требуется настройка серверного хранилища пользователей владельцем проекта.</p>}
    {registry?.legacy && <p>Ранее настроенный пользователь: <b>{registry.legacy.login}</b>. Для управления его доступом добавьте запись с этим же логином и новым паролем.</p>}
    {editing && registry && <UserForm user={editing} version={registry.version} close={() => setEditing(null)} saved={data => { setRegistry(data); setEditing(null); setMessage('Права пользователя сохранены.'); }}/>}
    {registry && <div className="scroll"><table><thead><tr><th>Логин</th><th>Статус</th><th>Разделы</th><th>Действия</th></tr></thead><tbody>{registry.users.map(user => <tr key={user.login}><td><UserRound size={16}/> {user.login}</td><td>{user.enabled ? 'Активен' : 'Отключён'}</td><td>{user.sections.map(section => sections[section]).join(', ')}</td><td><button disabled={!registry.writable || editing !== null} title={`Изменить пользователя ${user.login}`} aria-label={`Изменить пользователя ${user.login}`} onClick={() => setEditing(user)}><Pencil size={18}/></button></td></tr>)}</tbody></table>{!registry.users.length && <p>Пользователи ещё не добавлены.</p>}</div>}
  </section>;
}
function UserForm({ user, version, close, saved }: { user: User | 'new'; version: string; close: () => void; saved: (data: Registry) => void }) {
  const [login, setLogin] = useState(user === 'new' ? '' : user.login);
  const [pin, setPin] = useState('');
  const [enabled, setEnabled] = useState(user === 'new' ? true : user.enabled);
  const [allowed, setAllowed] = useState<Section[]>(user === 'new' ? ['overview'] : user.sections);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <form className="settings-form user-form" onSubmit={async event => {
    event.preventDefault();
    if ((user === 'new' || pin) && !validAccountPassword(pin)) { setError('Пароль: 8–128 символов или PIN из 4 цифр.'); return; }
    if (!allowed.length) { setError('Выберите хотя бы один раздел.'); return; }
    setBusy(true); setError('');
    try { const data = await api({ action: user === 'new' ? 'create' : 'update', ...(user === 'new' ? {} : { originalLogin: user.login }), login, pin, enabled, sections: allowed, version }); setPin(''); saved(data); }
    catch (error) { setPin(''); setError(error instanceof Error ? error.message : 'Изменения не сохранены.'); }
    finally { setBusy(false); }
  }}>
    <h3>{user === 'new' ? 'Новый пользователь' : 'Изменить пользователя'}</h3>
    <fieldset disabled={busy}><label>Логин<input autoComplete="off" value={login} required maxLength={200} onChange={event => setLogin(event.target.value)}/></label>
      <label>{user === 'new' ? 'Пароль' : 'Новый пароль (необязательно)'}<input type="password" autoComplete="new-password" minLength={4} maxLength={128} required={user === 'new'} value={pin} onChange={event => setPin(event.target.value)}/></label>
      <label className="check-label"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)}/>Доступ включён</label>
      <fieldset className="user-sections"><legend>Доступные разделы</legend>{Object.entries(sections).map(([key, title]) => <label className="check-label" key={key}><input type="checkbox" checked={allowed.includes(key as Section)} onChange={event => setAllowed(previous => event.target.checked ? [...previous, key as Section] : previous.filter(section => section !== key))}/>{title}</label>)}</fieldset>
    </fieldset>
    {error && <p role="alert" className="attention">{error}</p>}
    <div className="settings-actions"><button className="primary" disabled={busy} type="submit"><Save size={17}/>{busy ? 'Сохраняем…' : 'Сохранить'}</button><button type="button" disabled={busy} onClick={() => { setPin(''); close(); }}><X size={17}/>Отмена</button></div>
  </form>;
}
