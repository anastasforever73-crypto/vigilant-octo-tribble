import '../login.css';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySession } from '@/app/lib/auth';
import LoginForm from './login-form';
import './login.css';
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (verifySession((await cookies()).get(SESSION_COOKIE)?.value)) redirect('/');
  const initialError = (await searchParams).error === 'auth' ? 'Не удалось войти. Проверьте логин и пароль и повторите попытку.' : '';
  return <main className="login-page"><section className="login-card"><div className="login-brand">МТ</div><p>МАРТ-ТРЕЙД</p><h1>Вход в дашборд</h1><p>Управленческая аналитика для вашей команды</p><LoginForm initialError={initialError} /></section></main>;
}
