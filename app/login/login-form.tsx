'use client';
import { useState } from 'react';
import { PASSWORD_LENGTH, validPassword } from '../lib/password-policy.mjs';
export default function LoginForm({ initialError = '' }: { initialError?: string }) {
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  return <form className="settings-form" method="post" action="/api/auth/login" onSubmit={async (event) => {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    if (!validPassword(String(data.get('password') || ''))) { setError('Пароль должен содержать ровно 4 символа.'); return; }
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: data.get('login'), password: data.get('password') }) });
      const payload = await response.json();
      if (!response.ok) { setError(payload.error || 'Не удалось войти'); form.reset(); } else { form.reset(); window.location.replace('/'); }
    } catch { setError('Сервер недоступен. Повторите вход.'); } finally { setBusy(false); }
  }}><label>Логин<input name="login" autoComplete="username" required maxLength={200} /></label><label>Пароль<input name="password" type="password" autoComplete="current-password" required minLength={PASSWORD_LENGTH} maxLength={PASSWORD_LENGTH * 2} pattern={`.{${PASSWORD_LENGTH}}`} title="Ровно 4 символа" /></label><button className="primary" disabled={busy}>{busy ? 'Входим…' : 'Войти'}</button>{error && <p role="alert" className="attention">{error}</p>}</form>;
}
