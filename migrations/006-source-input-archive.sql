-- Detailed source inputs, before period-dependent aggregation. Same encryption as report archives.
CREATE TABLE IF NOT EXISTS mart_source_input_archive (
  input_key text PRIMARY KEY,
  payload text,
  data_hash text,
  observed_at timestamptz,
  lease_token text,
  lease_until timestamptz
);
