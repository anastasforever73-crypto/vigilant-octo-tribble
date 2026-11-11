// One explicitly enabled, ephemeral PostgreSQL instance per Node process.
const { randomBytes } = require('node:crypto');
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');
const transport = require('./postgres.cjs');
const { makeSql } = transport;
const symbol = Symbol.for('mart.temporary-postgres.v1');
function temporaryStorage() { return !process.env.DATABASE_URL && process.env.TEMPORARY_STORAGE_ENABLED === 'true'; }
function storageEnabled() { return Boolean(process.env.DATABASE_URL) || temporaryStorage(); }
function state() {
  if (!globalThis[symbol]) globalThis[symbol] = { key: randomBytes(32), revision: 0, downloadedRevision: -1, lastDownload: null, environment: null, tail: Promise.resolve() };
  return globalThis[symbol];
}
function memoryKey() { return state().key; }
async function lock() {
  const s = state(), previous = s.tail;
  let release; s.tail = new Promise(resolve => { release = resolve; });
  await previous; return release;
}
async function instance() {
  const s = state();
  if (!s.initializing) s.initializing = (async () => {
    const { PGlite } = require('@electric-sql/pglite');
    const db = new PGlite({ parsers: { 1082: v => v, 1114: v => v, 1184: v => v } });
    const dir = path.join(process.cwd(), 'migrations');
    for (const file of readdirSync(dir).filter(f => /^\d+.*\.sql$/.test(f)).sort()) await db.exec(readFileSync(path.join(dir, file), 'utf8'));
    return db;
  })();
  return s.initializing;
}
function mutates(text) { return !/^\s*(SELECT|SHOW|SET|BEGIN|COMMIT|ROLLBACK|LOCK)\b/i.test(text); }
function postgres(connectionString, options) {
  if (!temporaryStorage()) return transport.postgres(connectionString, options);
  const s = state();
  if (!s.sql) {
    const query = async (text, values = []) => ({ rows: (await (await instance()).query(text, values)).rows });
    const pool = {
      query: async (text, values) => { const release = await lock(); try { const result = await query(text, values); if (mutates(text)) s.revision++; return result; } finally { release(); } },
      connect: async () => {
        const release = await lock(); let changed = false;
        return { query: async (text, values) => { const result = await query(text, values); if (mutates(text)) changed = true; if (/^COMMIT\b/.test(text) && changed) s.revision++; return result; }, release, };
      },
      end: async () => {},
    };
    s.sql = makeSql(pool);
  }
  return s.sql;
}
function memoryStatus() { const s = state(); return { temporary: temporaryStorage(), revision: s.revision, lastDownload: s.lastDownload, dirty: s.downloadedRevision !== s.revision }; }
function markDownloaded(revision) { const s = state(); s.downloadedRevision = revision; s.lastDownload = new Date().toISOString(); }
function environmentOverride() { return temporaryStorage() ? state().environment : null; }
function setEnvironmentOverride(value) { state().environment = value; state().revision++; }
module.exports = { postgres, temporaryStorage, storageEnabled, memoryKey, memoryStatus, markDownloaded, environmentOverride, setEnvironmentOverride };
async function temporaryTransaction(write, fn, expectedRevision) {
  const release = await lock(), s = state();
  try {
    if (expectedRevision !== undefined && s.revision !== expectedRevision) { const error = new Error('Данные изменились. Повторите предварительный просмотр.'); error.status = 409; throw error; }
    const result = await (await instance()).transaction(tx => fn(tx));
    if (write) s.revision++;
    return result;
  } finally { release(); }
}
module.exports.temporaryTransaction = temporaryTransaction;
