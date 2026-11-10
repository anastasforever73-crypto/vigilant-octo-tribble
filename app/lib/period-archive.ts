import { MemoryCache } from './memory-cache';
import 'server-only';
import { randomUUID } from 'node:crypto';
import { postgres } from './postgres';
import { seal, unseal } from './connections/crypto';
import { CALCULATION_VERSION, contentHash, reportContentHash } from './archive-version';
import type { SourceProbe } from './archive-source-probe';
import { moscowToday } from './receivables';
import { getSourceSettings } from './source-settings';

export const ARCHIVE_VERSION = 2;
// Only current data expires. Historical snapshots have no age-based expiration.
export const CURRENT_CACHE_MAX_AGE = 5 * 60 * 1000;
export type ArchiveInfo = { mode: 'archive' | 'live'; createdAt?: string; observedAt?: string; sourceVersion?: string; cacheVersion?: string; message?: string; retention?: 'historical' | 'current'; checkedAt?: string; verifiedAt?: string; verification?: 'checked' | 'unconfirmed' };
export type ArchiveEntry = { archive_key: string; kind: string; period_start: string; period_end: string; created_at: string | null; observed_at: string | null; lease_until: string | null; last_error: string | null; schema_version: number | null; calculation_version: string | null; verified_at: string | null };
function db() {
  if (!process.env.DATABASE_URL) throw new Error('Архив: PostgreSQL не настроен.');
  return postgres(process.env.DATABASE_URL, { statementTimeoutMs: 15000 });
}
type SpecIdentity = { archiveOnly?: boolean; kind: string; start: string; end: string; comparisonStart?: string; retention?: 'historical' | 'current'; calculationVersion?: string };
export function retention(spec: SpecIdentity, today = moscowToday()) {
  return spec.retention || (spec.end !== 'all' && spec.end >= today ? 'current' : 'historical');
}
async function sourceVersions(configurationOnly = false, spec?: SpecIdentity) {
  const connections = db()`SELECT id,revision,enabled FROM mart_connections ORDER BY id`;
  if (configurationOnly || spec?.kind === 'opiu') { const version = contentHash([getSourceSettings(), await connections]); return { period: version, global: version }; }
  const [rows, snapshots, inputs] = await Promise.all([
    connections,
    db()`SELECT s.connection_id,s.period_start,s.period_end,s.revision,COALESCE(s.content_hash,md5(s.payload)) AS content_hash
      FROM mart_source_snapshots s JOIN mart_connections c ON c.id=s.connection_id AND c.revision=s.revision
      WHERE c.enabled=true AND s.period_start <= ${spec?.end || '9999-12-31'}::date AND s.period_end >= ${spec?.comparisonStart || spec?.start || '0001-01-01'}::date
      ORDER BY s.connection_id,s.period_start,s.period_end`,
    db()`SELECT input_key,data_hash FROM mart_source_input_archive WHERE data_hash IS NOT NULL ORDER BY input_key`,
  ]);
  const config = contentHash([getSourceSettings(), rows]);
  return { period: contentHash(inputs.length ? [config, snapshots, inputs] : [config, snapshots]), global: contentHash([config, inputs]) };
}
export async function sourceVersion(configurationOnly = false, spec?: SpecIdentity) { return (await sourceVersions(configurationOnly, spec)).period; }
export async function archiveStatus(): Promise<ArchiveEntry[]> {
  return await db()`SELECT archive_key,kind,period_start,period_end,created_at,observed_at,lease_until,last_error,schema_version,calculation_version,verified_at FROM mart_dashboard_archive ORDER BY attempted_at DESC` as ArchiveEntry[];
}
export function archiveEligible(row: { schema_version?: number; calculation_version?: string; source_version?: string; observed_at?: string | null; payload?: unknown; last_error?: unknown; lease_until?: unknown; lease_kind?: string }, version: string, now = Date.now(), spec?: SpecIdentity) {
  const age = now - Date.parse(row.observed_at || '');
  return (!row.lease_until || row.lease_kind === 'verify') && row.schema_version === ARCHIVE_VERSION && row.calculation_version === (spec?.calculationVersion || CALCULATION_VERSION) && row.source_version === version && Boolean(row.payload) && age >= 0;
}
export type ArchiveSpec<T> = SpecIdentity & { onlyIfChanged?: boolean; load: () => Promise<T>; complete: (data: T) => boolean; observedAt?: (data: T) => string | undefined; probe?: () => Promise<SourceProbe> };
async function probe<T>(spec: ArchiveSpec<T>): Promise<SourceProbe> {
  try { return await spec.probe?.() || { versions: {}, warnings: ['Использованы сохранённые входные данные; проверка источников выполняется в фоне.'], checkedAt: new Date().toISOString() }; }
  catch { return { versions: {}, warnings: ['Проверка версии источников временно недоступна.'], checkedAt: new Date().toISOString() }; }
}
export function probeChanged(stored: Record<string, string>, current: Record<string, string>) {
  return Object.entries(current).some(([key, value]) => stored[key] !== value);
}
function probeInfo(value: SourceProbe) {
  return { checkedAt: value.checkedAt, verification: value.warnings.length ? 'unconfirmed' as const : 'checked' as const, ...(value.warnings.length ? { message: value.warnings.join(' ') } : {}) };
}
export function archiveKey(spec: Pick<ArchiveSpec<unknown>, 'kind' | 'start' | 'end'>) { return `${spec.kind}:${spec.start}:${spec.end}`; }
export async function claimArchive(spec: Pick<ArchiveSpec<unknown>, 'kind' | 'start' | 'end'>) {
  const key = archiveKey(spec), token = randomUUID();
  const rows = await db()`INSERT INTO mart_dashboard_archive(archive_key,kind,period_start,period_end,lease_token,lease_until,attempted_at,lease_kind)
    VALUES(${key},${spec.kind},${spec.start},${spec.end},${token},now()+interval '4 minutes',now(),'write')
    ON CONFLICT(archive_key) DO UPDATE SET lease_token=EXCLUDED.lease_token,lease_until=EXCLUDED.lease_until,attempted_at=now(),last_error=NULL,lease_kind='write'
    WHERE mart_dashboard_archive.lease_until IS NULL OR mart_dashboard_archive.lease_until < now() RETURNING archive_key`;
  return rows.length ? token : null;
}
async function fail(key: string, token: string, message: string) {
  await db()`UPDATE mart_dashboard_archive SET last_error=${message},lease_token=NULL,lease_until=NULL WHERE archive_key=${key} AND lease_token=${token}`;
}
export async function buildArchive<T>(spec: ArchiveSpec<T>, token: string): Promise<T & { archive: ArchiveInfo }> {
  const key = archiveKey(spec), startedAt = new Date().toISOString();
  let observedAt = startedAt;
  let loaded: T | undefined;
  try {
    let before: string;
    try { before = await sourceVersion(true, spec); }
    catch {
      const data = await spec.load();
      await fail(key, token, 'Хранилище недоступно после запуска задания.').catch(() => {});
      return { ...data, archive: { mode: 'live', message: 'Архив недоступен. Использована обычная загрузка.' } };
    }
    const initialProbe = await probe(spec);
    const data = await spec.load();
    loaded = data;
    const sourceTime = spec.observedAt?.(data);
    if (sourceTime && Number.isFinite(Date.parse(sourceTime))) {
      observedAt = new Date(Math.min(Date.parse(startedAt), Date.parse(sourceTime))).toISOString();
    }
    if (!spec.complete(data)) {
      await fail(key, token, 'Обновление неполное. Предыдущий исправный снимок сохранён.');
      return { ...data, archive: { mode: 'live', observedAt, message: 'Архив не обновлён: получены неполные данные.' } };
    }
    // Synchronisation may update last_success. Configuration changes must still fence publication.
    const versions = await sourceVersions(false, spec), after = versions.period;
    if (before !== await sourceVersion(true, spec)) {
      await fail(key, token, 'Источники изменились во время чтения. Повторите создание архива.');
      return { ...data, archive: { mode: 'live', observedAt, message: 'Версия источников изменилась; требуется повторное создание архива.' } };
    }
    const finalProbe = await probe(spec);
    if (Object.entries(initialProbe.versions).some(([key, value]) => finalProbe.versions[key] && finalProbe.versions[key] !== value)) {
      await fail(key, token, 'Исходная таблица изменилась во время чтения. Повторите обновление.');
      return { ...data, archive: { mode: 'live', observedAt, message: 'Архив не заменён: исходная таблица изменилась во время чтения.' } };
    }
    // Only revisions observed both before and after reading can certify the stored payload.
    const certifiedVersions = Object.fromEntries(Object.entries(finalProbe.versions).filter(([key, value]) => initialProbe.versions[key] === value));
    const dataHash = reportContentHash(data);
    if (spec.onlyIfChanged) {
      const previous = (await db()`SELECT * FROM mart_dashboard_archive WHERE archive_key=${key}`)[0];
      let unchanged = false;
      try { unchanged = previous?.schema_version === ARCHIVE_VERSION && previous.calculation_version === (spec.calculationVersion || CALCULATION_VERSION) && reportContentHash(unseal(previous.payload, key)) === dataHash; } catch { /* Repair corruption through normal publication below. */ }
      if (unchanged) {
        const saved = await db()`UPDATE mart_dashboard_archive SET source_version=${after},source_probe=${JSON.stringify(certifiedVersions)}::jsonb,data_hash=${dataHash},verified_at=now(),last_error=NULL,lease_token=NULL,lease_until=NULL,lease_kind=NULL
          WHERE archive_key=${key} AND lease_token=${token} AND lease_until > now() RETURNING created_at,observed_at,verified_at`;
        return { ...data, archive: { mode: 'live', retention: retention(spec), ...probeInfo(finalProbe), createdAt: saved[0]?.created_at, observedAt: saved[0]?.observed_at || observedAt, verifiedAt: saved[0]?.verified_at, cacheVersion: versions.global, sourceVersion: after } };
      }
    }
    const payload = seal(data, key);
    const rows = await db()`UPDATE mart_dashboard_archive SET payload=${payload},schema_version=${ARCHIVE_VERSION},source_version=${after},calculation_version=${spec.calculationVersion || CALCULATION_VERSION},source_probe=${JSON.stringify(certifiedVersions)}::jsonb,data_hash=${dataHash},verified_at=now(),created_at=now(),observed_at=${observedAt}::timestamptz,last_error=NULL,lease_token=NULL,lease_until=NULL
      WHERE archive_key=${key} AND lease_token=${token} AND lease_until > now() RETURNING created_at,verified_at`;
    return { ...data, archive: { mode: 'live', retention: retention(spec), ...probeInfo(finalProbe), observedAt, createdAt: rows[0]?.created_at, verifiedAt: rows[0]?.verified_at, cacheVersion: versions.global, sourceVersion: after, ...(!rows.length ? { message: 'Срок создания архива истёк; снимок не заменён.' } : {}) } };
  } catch (error) {
    await fail(key, token, 'Не удалось создать архив. Проверьте источники и доступность хранилища.').catch(() => {});
    if (loaded !== undefined) return { ...loaded, archive: { mode: 'live', observedAt, message: 'Данные получены, но архив сохранить не удалось.' } };
    throw error;
  }
}
async function archivedLoadOnce<T>(spec: ArchiveSpec<T>, force = false): Promise<T & { archive: ArchiveInfo }> {
  let token: string | null = null;
  try {
    const key = archiveKey(spec);
    if (!force) {
      const sql = db();
      const [versions, rows] = await Promise.all([sourceVersions(false, spec), sql`SELECT archive_key,schema_version,calculation_version,source_version,observed_at,created_at,verified_at,lease_until,lease_kind,last_error,data_hash,payload IS NOT NULL AS has_payload FROM mart_dashboard_archive WHERE archive_key=${key}`]);
      const version = versions.period, row = rows[0];
      if (row && archiveEligible({ ...row, payload: row.has_payload }, version, Date.now(), spec)) {
        try {
          const cacheKey = `${process.env.DATABASE_URL}:${key}:${version}:${row.data_hash}:${row.created_at}`;
          let data = reportMemory.get(cacheKey) as T | undefined;
          if (!data) {
            const full = (await db()`SELECT * FROM mart_dashboard_archive WHERE archive_key=${key}`)[0];
            // Metadata and payload are separate reads: a concurrent writer must not mix versions.
            if (!full || full.source_version !== version || String(full.created_at) !== String(row.created_at)) return archivedLoadOnce(spec, force);
            data = unseal<T>(String(full.payload), key);
            if (spec.complete(data)) reportMemory.set(cacheKey, data);
          }
          if (spec.complete(data)) return { ...data, archive: { mode: 'archive', retention: retention(spec), verification: 'unconfirmed',
            message: row.last_error || 'Актуальность проверяется в фоне; показана дата чтения источников.',
            createdAt: row.created_at, verifiedAt: row.verified_at, observedAt: row.observed_at, cacheVersion: versions.global, sourceVersion: version } };

        } catch { /* Corruption falls through to the regular reader. */ }
      }
    }
    if (spec.archiveOnly) throw new ArchiveMiss();
    token = await claimArchive(spec);
  } catch (error) {
    if (spec.archiveOnly || error instanceof ArchiveMiss) throw new ArchiveMiss();
    return { ...await spec.load(), archive: { mode: 'live', message: 'Архив недоступен. Использована обычная загрузка.' } };
  }
  if (!token) {
    // Other instances share the PostgreSQL lease; never start a duplicate source import.
    for (let attempt = 0; attempt < 180; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const row = (await db()`SELECT lease_until FROM mart_dashboard_archive WHERE archive_key=${archiveKey(spec)}`)[0];
      if (!row?.lease_until || Date.parse(String(row.lease_until)) < Date.now()) return archivedLoadOnce(spec, false);
    }
    throw new Error('Архив ещё подготавливается. Повторите запрос.');
  }
  return buildArchive(spec, token);
}

// A verification is not an expiration: unchanged payload/created_at/observed_at are retained.
export async function claimArchiveVerification(spec: SpecIdentity) {

  const key = archiveKey(spec), token = randomUUID();
  const rows = await db()`UPDATE mart_dashboard_archive SET lease_token=${token},lease_until=now()+interval '4 minutes',lease_kind='verify',attempted_at=now()
    WHERE archive_key=${key} AND payload IS NOT NULL AND (lease_until IS NULL OR lease_until < now())
      AND COALESCE(verified_at,created_at) < now()-(${retention(spec) === 'current' ? 300 : 3600} * interval '1 second') RETURNING archive_key`;
  return rows.length ? token : null;
}

export class ArchiveMiss extends Error {}
const reportMemory = new MemoryCache<unknown>(48 * 1024 * 1024, 24);
export function clearArchiveMemory() { reportMemory.clear(); }
const inFlight = new Map<string, Promise<unknown>>();
export async function archivedLoad<T>(spec: ArchiveSpec<T>, force = false): Promise<T & { archive: ArchiveInfo }> {
  const key = contentHash([process.env.DATABASE_URL, archiveKey(spec), spec.comparisonStart, spec.calculationVersion || CALCULATION_VERSION, force, spec.archiveOnly]);
  let promise = inFlight.get(key) as Promise<T & { archive: ArchiveInfo }> | undefined;
  if (!promise) {
    promise = archivedLoadOnce(spec, force); inFlight.set(key, promise);
    promise.finally(() => { if (inFlight.get(key) === promise) inFlight.delete(key); }).catch(() => {});
  }
  return structuredClone(await promise);
}
