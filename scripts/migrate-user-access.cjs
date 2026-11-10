// Adds authentication metadata tables only; never reads or rewrites source records.
const fs = require('node:fs');
const path = require('node:path');
const { neon } = require('@neondatabase/serverless');
require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
(async () => {
  if (!process.env.DATABASE_URL) throw new Error();
  const sql = neon(process.env.DATABASE_URL, { fetchOptions: { signal: AbortSignal.timeout(15000) } });
  const statements = fs.readFileSync(path.join(__dirname, '../migrations/003-user-access.sql'), 'utf8').replace(/^--.*$/gm, '').split(';').map(value => value.trim()).filter(Boolean);
  await sql.transaction(statements.map(statement => sql.query(statement, [])));
  console.log('Authentication metadata tables are ready. Existing data unchanged.');
})().catch(() => { console.error('Authentication migration failed. Check database connectivity and permissions.'); process.exitCode = 1; });
