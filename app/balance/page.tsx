import { contentHash } from '@/app/lib/archive-version';
import Dashboard from '../dashboard-client';
import { requirePageSession } from '../lib/auth';
import { canView, firstPage } from '../lib/user-access';
import { redirect } from 'next/navigation';
export const dynamic = 'force-dynamic';
export default async function BalancePage() {
  const session = await requirePageSession();
  if (!canView(session, 'balance')) redirect(firstPage(session));
  return <Dashboard cacheScope={contentHash([session.login, session.version, session.nonce, session.sections])} role={session.role} allowedSections={session.sections} initialTab="balance" />;
}
