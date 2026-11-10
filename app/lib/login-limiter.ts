import 'server-only';
import { createHmac } from 'node:crypto';
import { neon } from '@neondatabase/serverless';

// Production PIN attempts must be bounded across all serverless instances.
export async function reserveLoginAttempt(login: string) {
  if (!process.env.VERCEL && !process.env.DATABASE_URL) return null;
  if (!process.env.DATABASE_URL || !process.env.AUTH_SECRET) throw new Error('LOGIN_LIMITER_UNAVAILABLE');
  const sql = neon(process.env.DATABASE_URL, { fetchOptions: { signal: AbortSignal.timeout(8000) } });
  const bucket = createHmac('sha256', process.env.AUTH_SECRET).update('login:' + login).digest('hex');
  const rows = await sql`INSERT INTO mart_login_attempts(bucket,attempts,expires_at) VALUES (${bucket},1,now()+interval '15 minutes')
    ON CONFLICT(bucket) DO UPDATE SET
      attempts=CASE WHEN mart_login_attempts.expires_at<=now() THEN 1 ELSE LEAST(mart_login_attempts.attempts+1,6) END,
      expires_at=CASE WHEN mart_login_attempts.expires_at<=now() THEN now()+interval '15 minutes' ELSE mart_login_attempts.expires_at END
    RETURNING attempts,expires_at`;
  return { count: Number(rows[0].attempts), retryAfter: Math.max(1, Math.ceil((new Date(String(rows[0].expires_at)).getTime() - Date.now()) / 1000)),
    reset: async () => { await sql`DELETE FROM mart_login_attempts WHERE bucket=${bucket}`; } };
}
