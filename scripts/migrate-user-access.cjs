// Adds authentication metadata tables only; never reads or rewrites source records.
const fs = require('node:fs');
const path = require('node:path');
const { postgres } = require('./lib/postgres.cjs');
require('./lib/operator-env.cjs').operatorEnv();
(async () => {
  if (!process.env.DATABASE_URL) throw new Error();
  const sql = postgres(process.env.DATABASE_URL, { statementTimeoutMs: 15000 });
  const statements = fs.readFileSync(path.join(__dirname, '../migrations/003-user-access.sql'), 'utf8').replace(/^--.*$/gm, '').split(';').map(value => value.trim()).filter(Boolean);
  await sql.transaction(statements.map(statement => sql.query(statement, [])));
  console.log('Authentication metadata tables are ready. Existing data unchanged.');
})().catch(() => { console.error('Authentication migration failed. Check database connectivity and permissions.'); process.exitCode = 1; });
