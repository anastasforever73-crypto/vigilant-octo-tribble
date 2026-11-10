import Dashboard from './dashboard-client';
import { requirePageSession } from './lib/auth';
import snapshot from './demo-data.json';
export const dynamic = 'force-dynamic';
export default async function Home() {
  await requirePageSession();
  return <Dashboard data={snapshot}/>;
}
