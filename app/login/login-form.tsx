'use client';
import { useState } from 'react';
import { validLoginPassword } from '../lib/password-policy.mjs';
export default function LoginForm({ initialError = '' }: { initialError?: string }) {
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  return <form className="settings-form" method="post" action="/api/auth/login" onSubmit={async (event) => {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    if (!validLoginPassword(String(data.get('password') || ''))) { setError('Укажите пароль (8–128 символов) или прежний код из 4 символов.'); return; }
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: data.get('login'), password: data.get('password') }) });
      const payload = await response.json();
      if (!response.ok) { setError(payload.error || 'Не удалось войти'); form.reset(); } else { form.reset(); if (typeof BroadcastChannel !== 'undefined') { const channel = new BroadcastChannel('dashboard-session'); channel.postMessage('login'); channel.close(); } window.location.replace('/'); }
    } catch { setError('Сервер недоступен. Повторите вход.'); } finally { setBusy(false); }
  }}><label>Логин<input name="login" autoComplete="username" required maxLength={200} /></label><label>Пароль<input name="password" type="password" autoComplete="current-password" required minLength={4} maxLength={128} /></label><button className="primary" disabled={busy}>{busy ? 'Входим…' : 'Войти'}</button>{error && <p role="alert" className="attention">{error}</p>}</form>;
}
