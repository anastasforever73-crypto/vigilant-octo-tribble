import { redirect } from 'next/navigation';
import { requirePageSession } from '../lib/auth';
import { firstPage } from '../lib/user-access';
export const dynamic = 'force-dynamic';
export default async function SettingsPage() {
  const session = await requirePageSession();
  redirect(session.role === 'admin' ? '/?tab=settings' : firstPage(session));
}
