import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { postgres } from './postgres';
import { contentHash, CALCULATION_VERSION, reportContentHash } from './archive-version';
import { seal, unseal } from './connections/crypto';
import { MemoryCache } from './memory-cache';

const context = new AsyncLocalStorage<{ force: boolean; only: boolean; observedAt?: string; pending: Map<string, Promise<unknown>> }>();
const memory = new MemoryCache<unknown>(32 * 1024 * 1024, 64);
const pending = new Map<string, Promise<unknown>>();
export function sourceObservedAt() { return context.getStore()?.observedAt; }
function observe(value: unknown) {
  const job = context.getStore(), date = new Date(String(value));
  if (job && Number.isFinite(date.getTime()) && (!job.observedAt || date.toISOString() < job.observedAt)) job.observedAt = date.toISOString();
}
export function hasSourceArchive() { return Boolean(context.getStore()); }
export async function withSourceArchive<T>(force: boolean, load: () => Promise<T>, only = false) {
  const parent = context.getStore();
  const job = { force, only, pending: new Map<string, Promise<unknown>>(), observedAt: undefined as string | undefined };
  try { return await context.run(job, load); }
  finally { if (parent && job.observedAt && (!parent.observedAt || job.observedAt < parent.observedAt)) parent.observedAt = job.observedAt; }
}
/** Outside dashboard archive jobs the original readers retain their explicit live-read semantics. */
export async function sourceInput<T>(identity: unknown, load: () => Promise<T>, complete: (value: T) => boolean = () => true): Promise<T> {
  const job = context.getStore();
  if (!job) return load();
  if (!process.env.DATABASE_URL) { if (job.only) throw new Error('Архив входных данных недоступен'); return load(); }
  const key = contentHash([CALCULATION_VERSION, identity]);
  const existing = job.pending.get(key);
  if (existing) return structuredClone(await existing) as T;
  const flightKey = `${process.env.DATABASE_URL}:${key}:${job.force}:${job.only}`;
  let promise = pending.get(flightKey) as Promise<T> | undefined;
  if (!promise) {
    promise = read(); pending.set(flightKey, promise);
    promise.finally(() => { if (pending.get(flightKey) === promise) pending.delete(flightKey); }).catch(() => {});
  }
  job.pending.set(key, promise);
  return structuredClone(await promise);

  async function read(): Promise<T> {
    const sql = postgres(process.env.DATABASE_URL!, { statementTimeoutMs: 15000 });
    let token: string | undefined;
    try {
      if (!job!.force) {
        const row = (await sql`SELECT data_hash,observed_at FROM mart_source_input_archive WHERE input_key=${key}`)[0];
        if (row?.data_hash) {
          observe(row.observed_at);
          const cacheKey = `${flightKey}:${row.data_hash}:${row.observed_at}`;
          const hit = memory.get(cacheKey) as T | undefined;
          if (hit !== undefined) return hit;
          const full = (await sql`SELECT payload,data_hash,observed_at FROM mart_source_input_archive WHERE input_key=${key}`)[0];
          if (full?.payload) {
            const value = unseal<T>(String(full.payload), key);
            if (complete(value)) { memory.set(`${flightKey}:${full.data_hash}:${full.observed_at}`, value); return value; }
          }
        }
      }
      if (job!.only) throw new Error('Архив входных данных не покрывает период');
      token = randomUUID();
      // Across instances only the lease owner imports; followers poll the durable result.
      const claimed = await sql`INSERT INTO mart_source_input_archive(input_key,lease_token,lease_until) VALUES(${key},${token},now()+interval '3 minutes')
        ON CONFLICT(input_key) DO UPDATE SET lease_token=EXCLUDED.lease_token,lease_until=EXCLUDED.lease_until
        WHERE mart_source_input_archive.lease_until IS NULL OR mart_source_input_archive.lease_until < now() RETURNING input_key`;
      if (!claimed.length) {
        token = undefined;
        for (let attempt = 0; attempt < 180; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          const row = (await sql`SELECT payload,lease_until,observed_at FROM mart_source_input_archive WHERE input_key=${key}`)[0];
          if (!row?.lease_until && row?.payload) { observe(row.observed_at); return unseal<T>(String(row.payload), key); }
          if (!row || (row.lease_until && Date.parse(String(row.lease_until)) < Date.now())) break;
        }
        throw new Error('Подготовка данных ещё выполняется. Повторите запрос.');
      }
    } catch (error) {
      // Missing migration / unavailable database must not fabricate a successful archive hit.
      if (job!.only || error instanceof Error && error.message.startsWith('Подготовка')) throw error;
      return load();
    }
    try {
      observe(new Date().toISOString());
      const value = await load();
      if (complete(value)) {
        const payload = seal(value, key), hash = reportContentHash(value);
        await sql`UPDATE mart_source_input_archive SET payload=${payload},data_hash=${hash},observed_at=now(),lease_token=NULL,lease_until=NULL
          WHERE input_key=${key} AND lease_token=${token} AND lease_until > now()`;
      }
      return value;
    } finally {
      await sql`UPDATE mart_source_input_archive SET lease_token=NULL,lease_until=NULL WHERE input_key=${key} AND lease_token=${token}`.catch(() => {});
    }
  }
}
