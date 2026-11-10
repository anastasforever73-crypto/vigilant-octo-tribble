-- Independent archive; existing source tables and records are not modified.
CREATE TABLE IF NOT EXISTS mart_dashboard_archive (
  archive_key text PRIMARY KEY,
  kind text NOT NULL,
  period_start text NOT NULL,
  period_end text NOT NULL,
  schema_version integer,
  source_version text,
  payload text,
  created_at timestamptz,
  observed_at timestamptz,
  lease_token text,
  lease_until timestamptz,
  last_error text,
  attempted_at timestamptz
);
