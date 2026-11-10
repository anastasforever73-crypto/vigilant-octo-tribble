// Read-only connection/TLS checks; never print addresses, usernames or raw errors.
const { postgres, closePools, poolConfig } = require('./lib/postgres.cjs');
(async () => {
  require('./lib/operator-env.cjs').operatorEnv();
  const config=poolConfig(process.env.DATABASE_URL);
  const sql=postgres(process.env.DATABASE_URL);
  const [rows]=await sql.transaction([sql`SELECT current_setting('server_version_num')::int AS version,
    (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS ssl,
    (SELECT version FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS protocol,
    has_schema_privilege(current_user,'public','USAGE') AS schema_usage,
    has_schema_privilege(current_user,'public','CREATE') AS schema_create`],{readOnly:true});
  const r=rows[0];
  if(config.ssl && !r.ssl) throw Error();
  console.log(JSON.stringify({ready:true,readOnly:true,serverVersion:r.version,tls:r.ssl,protocol:r.protocol,certificateVerification:config.ssl ? 'verify-full' : 'loopback-test-only',schemaUsage:r.schema_usage,schemaCreate:r.schema_create}));
})().catch(()=>{console.log(JSON.stringify({ready:false,readOnly:true,code:'postgres_connection_or_tls_check_failed'}));process.exitCode=1;}).finally(closePools);
