import { withNativeFintabloPlans } from './read-fintablo-plans';
import { withPeriodBalances } from './period-balances';
import { contentHash } from './archive-version';
import { withWalletPercentage } from './wallet-percentage';
import { readWalletPercentage } from './wallet-percentage-store';
import { CALCULATION_VERSION } from './archive-version';
import { NLPK_HISTORY_VERSION } from './nlpk-payables';
import { withPlanningIndicators } from './planning-indicators';
import { withSourceArchive, sourceObservedAt } from './source-input-archive';
import { probeArchiveSources } from './archive-source-probe';
import { archivedLoad } from './period-archive';
import 'server-only';
import { readOperationalFinancial } from './read-operational';
import { operationalDebt, yesterdayMoscow } from './operational';
import { withConnections } from './connections/dashboard';
import type { DashboardData, SourceStatus } from './dashboard-data';
import { getSourceSettings } from './source-settings';
import { readFintablo, FintabloError } from './fintablo';
import { fintabloToDashboardData } from './fintablo-adapter';
import { readReceivables } from './read-receivables';
import { readGoogleSheets } from './google-dashboard';
import { safeSheetsError } from './google-sheets';
import { period } from './source-values';
async function loadDashboardSources(params: URLSearchParams, refresh = false, readOnly = false): Promise<DashboardData> {
  const p = period(params), s = getSourceSettings();
  const sources: Record<string, SourceStatus> = {};
  async function read<T>(key: string, name: string, enabled: boolean, configured: boolean, fn: () => Promise<T>): Promise<T | null> {
    sources[key] = { name, configured, available: false, status: !enabled ? 'disabled' : !configured ? 'not_configured' : 'loading', freshness: 'Нет подтверждённого обновления' };
    if (!enabled || !configured) return null;
    try { const value = await fn(); const updatedAt = value && typeof value === 'object' && 'updatedAt' in value && typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(); sources[key] = { name, configured, available: true, status: 'connected', updatedAt, freshness: 'Дата чтения исходных данных' }; return value; }
    catch (error) { const e = error instanceof FintabloError ? error : safeSheetsError(error); sources[key].status = e.code; sources[key].error = e.message; return null; }
  }
  const credentials = Boolean(s.googleServiceAccountEmail && s.googlePrivateKey);
  const day = yesterdayMoscow();
  const [fintablo, google, debt, financial] = await Promise.all([
    read('fintablo', 'Финтабло', s.fintabloEnabled, Boolean(s.fintabloBaseUrl && s.fintabloToken), async () => fintabloToDashboardData(await readFintablo(p.comparisonStart, p.end))),
    read('googleSheets', 'Google Sheets', s.googleEnabled, Boolean(credentials && s.googleSheetId), () => readGoogleSheets(p.end, s, p.comparisonStart)),
    readReceivables(s),
    readOperationalFinancial(day, p.end),
  ]);
  sources.debt = { name: 'Дебиторская задолженность', configured: !debt.configurationError, available: Boolean(debt.current), status: debt.current?.partial ? 'partial' : debt.current ? 'connected' : 'unavailable', updatedAt: debt.updatedAt, error: debt.current?.partial ? 'Частичный результат: один из листов недоступен.' : debt.current ? undefined : debt.configurationError || 'Итог ДЗ недоступен: проверьте подключение источников.', freshness: debt.current?.partial ? 'Получены данные только доступных листов' : debt.updatedAt ? 'Исходные листы прочитаны заново; остаток на сегодня по Москве' : 'Успешное обновление не подтверждено' };
  sources.payables = { name: 'Google Sheets — кредиторка', configured: Boolean(debt.payables), available: Boolean(debt.payables), status: debt.payables ? 'connected' : 'mapping_required', updatedAt: debt.payables ? debt.updatedAt : undefined, error: debt.payablesError, freshness: debt.payables ? `Лист «${debt.payables.sheet}»` : 'Сопоставление кредиторки не завершено' };
  // Whole fields come from one source. The same transactions are never added across sources.
  const cash = fintablo?.cash ?? google?.cash ?? [];
  const balances = fintablo?.balances.date === p.end ? fintablo.balances : google?.balances ?? {};
  const connected = await withConnections({
    source: [fintablo && 'fintablo', google && 'google-sheets', debt.current && 'debt-google-sheet'].filter(Boolean).join('+'),
    updatedAt: Object.values(sources).filter(x => x.available).map(x => x.updatedAt!).sort().at(-1),
    cash: cash.filter(x => x.date >= p.comparisonStart && x.date <= p.end),
    orders: (google?.orders ?? []).filter(x => x.date >= p.comparisonStart && x.date <= p.end),
    debtor: google?.debtor ?? {}, creditor: debt.payables ?? google?.creditor ?? {}, balances,
    receivables: debt, sources, period: p,
    operational: { day, ...financial, ...operationalDebt(debt, day) },
    fields: { cash: Boolean(fintablo || google), orders: Boolean(google), balances: balances.account != null || balances.wallet != null },
  }, p.comparisonStart, p.end, refresh, readOnly);
  return withNativeFintabloPlans(connected, p.comparisonStart, p.end);
}

export function dashboardArchiveSpec(params: URLSearchParams, refresh = false, readOnly = false) {
  const p = period(params);
  return { kind: 'dashboard', calculationVersion: `${CALCULATION_VERSION}:${NLPK_HISTORY_VERSION}:fintablo-period-balances-v1:native-plans-v1:account-breakdown-v1`, start: p.start, end: p.end, comparisonStart: p.comparisonStart, probe: refresh ? () => probeArchiveSources('dashboard') : undefined,
    load: () => withSourceArchive(refresh, async () => {
      const data = await loadDashboardSources(params, true, readOnly);
      return { ...data, dataAsOf: sourceObservedAt() };
    }),
    // A viewer may read older connection snapshots; archive creation must not renew their freshness.
    observedAt: (data: DashboardData) => data.dataAsOf || Object.values(data.sources || {}).filter(s => s.available && s.updatedAt).map(s => s.updatedAt!).sort()[0],
    complete: (data: DashboardData) => Boolean(data.period && data.sources && Object.values(data.sources).some(s => s.available)) &&
      Object.values(data.sources || {}).every(s => !s.configured || s.status === 'disabled' || (s.available && s.status !== 'partial' && !s.error)),
  };
}
export async function loadDashboard(params: URLSearchParams, refresh = false, readOnly = false): Promise<DashboardData> {
  const data = await archivedLoad({ ...dashboardArchiveSpec(params, refresh, readOnly), archiveOnly: params.get('archiveOnly') === '1' }, refresh);
  const p = period(params);
  const rules = await readWalletPercentage();
  const adjusted = withPlanningIndicators(withWalletPercentage(withPeriodBalances(data, p.end), rules, p.end), p.start, p.end);
  return { ...adjusted, archive: adjusted.archive && { ...adjusted.archive, cacheVersion: contentHash(['fintablo-period-balances-markup-v4-account-breakdown', adjusted.archive.cacheVersion || adjusted.archive.sourceVersion, rules]) } }; 
}
