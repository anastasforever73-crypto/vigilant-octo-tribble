import { NextRequest } from 'next/server';
import { guard, json, requestSession } from '@/app/lib/auth';
import { canView } from '@/app/lib/user-access';
import { loadDashboard } from '@/app/lib/load-dashboard';
import { visibleDashboard } from '@/app/lib/dashboard-access';
import { readOpiu } from '@/app/lib/read-opiu';
import { date, period } from '@/app/lib/source-values';
import { segments, type Segment } from '@/app/lib/opiu';
import { dashboardReport, opiuReport, reportTitles, ruDate, writeExcel, type ExportOptions, type ReportSection } from '@/app/lib/excel-report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 240;
export async function GET(request: NextRequest) {
  const denied = await guard(request);
  if (denied) return denied;
  const session = (await requestSession(request))!;
  const params = request.nextUrl.searchParams;
  const section = params.get('section') || '';
  if (!Object.hasOwn(reportTitles, section)) return json({ error: 'Этот раздел нельзя выгрузить' }, 400);
  if (!canView(session, section)) return json({ error: 'Нет доступа к этому отчёту' }, 403);
  let options: ExportOptions;
  try {
    if (!params.get('start') || !params.get('end') || !['0', '1'].includes(params.get('compare') || '')) throw Error();
    const p = period(params);
    const segment = params.get('segment') || 'ИТОГО';
    if (!segments.includes(segment as Segment)) throw Error();
    const asOf = params.get('asOf') ? date(params.get('asOf')) : undefined;
    if (section === 'opiu' && (p.start.slice(8) !== '01' || new Date(Date.parse(p.end) + 86400000).getUTCDate() !== 1)) throw Error();
    options = { section: section as ReportSection, start: p.start, end: p.end, compare: params.get('compare') === '1', asOf, segment: segment as Segment };
  } catch { return json({ error: 'Проверьте выбранный период и фильтры отчёта' }, 400); }
  try {
    // No client-supplied rows, source overrides, refresh or administrative options are accepted.
    const report = section === 'opiu' ? opiuReport(await readOpiu(), options) : dashboardReport(visibleDashboard(await loadDashboard(new URLSearchParams({ start: options.start, end: options.end }), false, session.role !== 'admin'), session), options);
    const buffer = await writeExcel(report);
    const filename = `${report.title.replaceAll(' ', '_')}_${ruDate(options.start)}-${ruDate(options.end)}.xlsx`;
    return new Response(new Uint8Array(buffer), { headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="report.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff',
    } });
  } catch { return json({ error: 'Не удалось сформировать Excel. Повторите попытку позже.' }, 502); }
}
