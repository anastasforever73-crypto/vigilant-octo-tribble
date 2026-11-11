import { temporaryStorage } from './lib/postgres';
import { contentHash } from '@/app/lib/archive-version';
import { requirePageSession } from './lib/auth';
import Dashboard, { type Tab } from './dashboard-client';
import { redirect } from 'next/navigation';
import { canView, firstPage } from './lib/user-access';
export const dynamic = 'force-dynamic';
export default async function Home({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const session = await requirePageSession();
  const { tab } = await searchParams;
  if (!canView(session, tab || 'overview')) redirect(firstPage(session));
  if (tab === 'balance') redirect('/balance');
  const allowed = ['movements', 'salary', 'projects', 'plan', 'overview', 'cash', 'opiu', 'debt', 'sales', 'goods', 'logistics', ...(session.role === 'admin' ? ['settings', 'users'] : [])];
  return <>{temporaryStorage() && <div role="status" style={{ padding: "10px 20px", background: "#fff3cd", color: "#664d03" }}>Временное хранилище: после перезапуска приложения изменения будут потеряны. Администратору нужно скачать резервную копию в разделе «Источники».</div>}<Dashboard cacheScope={contentHash([session.login, session.version, session.nonce, session.sections])} role={session.role} allowedSections={session.sections} initialTab={allowed.includes(tab || '') ? tab as Tab : 'overview'} /></>;
}
