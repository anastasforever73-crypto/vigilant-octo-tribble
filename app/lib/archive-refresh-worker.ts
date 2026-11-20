import 'server-only';
import { postgres } from './postgres';
import { buildArchive, claimArchiveVerification } from './period-archive';
import { dashboardArchiveSpec } from './load-dashboard';
import { moscowToday } from './receivables';

/** Refresh durable reports even when no browser is open. Existing DB leases also
 * coordinate browser maintenance, manual updates and other server instances. */
export async function refreshNextArchive() {
  if (!process.env.DATABASE_URL || process.env.ARCHIVE_AUTO_REFRESH === 'false') return false;
  const sql = postgres(process.env.DATABASE_URL, { statementTimeoutMs: 15000 });
  const today = moscowToday();
  const rows = await sql`SELECT period_start,period_end FROM mart_dashboard_archive
    WHERE kind='dashboard' AND payload IS NOT NULL
      AND (lease_until IS NULL OR lease_until < now())
      AND COALESCE(verified_at,created_at) < now() -
        (CASE WHEN period_end >= ${today} THEN 300 ELSE 3600 END * interval '1 second')
      AND (attempted_at IS NULL OR attempted_at < now()-interval '5 minutes')
    ORDER BY CASE WHEN period_end >= ${today} THEN 0 ELSE 1 END,
      COALESCE(verified_at,created_at),archive_key LIMIT 1`;
  if (!rows.length) return false;
  const params = new URLSearchParams({ start: String(rows[0].period_start).slice(0, 10), end: String(rows[0].period_end).slice(0, 10) });
  const spec = dashboardArchiveSpec(params, true);
  const token = await claimArchiveVerification(spec);
  if (!token) return false;
  const started = performance.now();
  const result = await buildArchive({ ...spec, onlyIfChanged: true }, token);
  // Log only operational metadata, never source payloads or credentials.
  console.info('[archive-refresh]', JSON.stringify({ start: spec.start, end: spec.end, durationMs: Math.round(performance.now() - started), saved: Boolean(result.archive.createdAt), message: result.archive.message }));
  return true;
}

const worker = globalThis as typeof globalThis & { martArchiveRefreshStarted?: boolean };
export function startArchiveRefresh() {
  if (worker.martArchiveRefreshStarted || !process.env.DATABASE_URL || process.env.ARCHIVE_AUTO_REFRESH === 'false') return;
  worker.martArchiveRefreshStarted = true;
  async function tick() {
    try { await refreshNextArchive(); }
    catch { console.warn('[archive-refresh] Refresh failed; saved reports retained.'); }
    finally { setTimeout(tick, 60000).unref(); }
  }
  // Start after HTTP startup; schedule after completion so imports never overlap locally.
  setTimeout(tick, 30000).unref();
  console.info('[archive-refresh] Automatic archive refresh enabled.');
}
