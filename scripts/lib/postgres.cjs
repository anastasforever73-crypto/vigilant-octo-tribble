// Shared PostgreSQL TCP transport. Values always use positional parameters.
const fs = require('node:fs');
const { Pool, types } = require('pg');
const pools = new Map();
function configError() { const e = new Error('PostgreSQL configuration is invalid'); e.code = 'DATABASE_CONFIGURATION'; return e; }
function integer(value, fallback, max) { const n = value === undefined || value === '' ? fallback : Number(value); if (!Number.isInteger(n) || n < 1 || n > max) throw configError(); return n; }
function poolConfig(connectionString, options = {}, env = process.env) {
  let url; try { url = new URL(connectionString); } catch { throw configError(); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username || url.pathname.length < 2) throw configError();
  const mode = env.DATABASE_SSL_MODE || url.searchParams.get('sslmode') || 'verify-full';
  const host = env.DATABASE_HOSTADDR || url.hostname.replace(/^\[|\]$/g, '');
  const loopback = ['localhost','127.0.0.1','::1'].includes(host);
  if (!['verify-full', 'require', 'disable'].includes(mode) || mode === 'disable' && !loopback) throw configError();
  let ca = env.DATABASE_SSL_CA?.replace(/\\n/g, '\n');
  if (env.DATABASE_SSL_CA_FILE) { if (ca) throw configError(); ca = fs.readFileSync(env.DATABASE_SSL_CA_FILE, 'utf8'); }
  if (ca && !ca.includes('-----BEGIN CERTIFICATE-----')) throw configError();
  const servername = env.DATABASE_TLS_SERVERNAME || url.hostname.replace(/^\[|\]$/g, '');
  if (!/^[a-zA-Z0-9.:-]+$/.test(servername)) throw configError();
  // Parse the URI ourselves: pg's sslmode parser must never replace our CA or
  // turn require into rejectUnauthorized:false. require is strengthened to verify-full.
  return {
    host, port: integer(url.port, 5432, 65535), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: decodeURIComponent(url.pathname.slice(1)),
    ssl: mode === 'disable' ? false : { rejectUnauthorized: true, ...(ca ? { ca } : {}), servername },
    max: integer(env.DATABASE_POOL_MAX, 5, 20), connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000, allowExitOnIdle: true, maxLifetimeSeconds: 300,
    statement_timeout: integer(options.statementTimeoutMs, 15000, 300000), lock_timeout: 5000,
    application_name: 'mart-trade-dashboard',
    // Match the previous HTTP driver: dates stay strings, independent of local timezone.
    types: { getTypeParser: (oid, format) => [1082,1114,1184].includes(oid) && format !== 'binary' ? value => value : types.getTypeParser(oid, format) },
  };
}
function makeSql(pool) {
  const owner = Symbol('sql-owner');
  function query(text, values = []) {
    if (typeof text !== 'string' || !Array.isArray(values)) throw configError();
    let pending;
    const q = { text, values, owner, started: false,
      then(resolve, reject) { if (q.started && !pending) return Promise.reject(configError()).then(resolve,reject); if (!pending) { q.started = true; pending = pool.query(text, values).then(r => r.rows); } return pending.then(resolve,reject); },
      catch(reject) { return q.then(undefined,reject); },
      finally(callback) { return Promise.resolve(q).finally(callback); },
    };
    return q;
  }
  function sql(parts, ...values) {
    if (!Array.isArray(parts) || !Object.hasOwn(parts, 'raw')) throw configError();
    return query(parts.reduce((text, part, index) => text + (index ? `$${index}` : '') + part, ''), values);
  }
  sql.query = query;
  sql.transaction = async (queriesOrFn, options = {}) => {
    const queries = typeof queriesOrFn === 'function' ? queriesOrFn(sql) : queriesOrFn;
    if (!Array.isArray(queries) || queries.some(q => q.owner !== owner || q.started)) throw configError();
    const levels = { ReadUncommitted:'READ UNCOMMITTED', ReadCommitted:'READ COMMITTED', RepeatableRead:'REPEATABLE READ', Serializable:'SERIALIZABLE' };
    if (options.isolationLevel && !levels[options.isolationLevel]) throw configError();
    if (options.deferrable && (!options.readOnly || options.isolationLevel !== 'Serializable')) throw configError();
    const begin = `BEGIN ISOLATION LEVEL ${levels[options.isolationLevel || 'ReadCommitted']} ${options.readOnly ? 'READ ONLY' : 'READ WRITE'}${options.deferrable ? ' DEFERRABLE' : ''}`;
    for (const q of queries) q.started = true;
    const client = await pool.connect();
    let destroy = false;
    try {
      await client.query(begin);
      const result = [];
      for (const q of queries) { q.started = true; result.push((await client.query(q.text,q.values)).rows); }
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { destroy = true; }
      throw error;
    } finally { client.release(destroy); }
  };
  return sql;
}
function postgres(connectionString, options = {}) {
  const config = poolConfig(connectionString, options, options.env || process.env);
  const key = JSON.stringify({ ...config, types: undefined });
  let sql = pools.get(key);
  if (!sql) {
    const pool = new Pool(config);
    pool.on('error', () => { console.error('PostgreSQL idle connection closed; reconnecting on next request.'); });
    sql = makeSql(pool); sql.close = () => pool.end(); pools.set(key,sql);
  }
  return sql;
}
async function closePools() { const current = [...pools.values()]; pools.clear(); await Promise.allSettled(current.map(sql => sql.close())); }
module.exports = { postgres, closePools, poolConfig, makeSql };
