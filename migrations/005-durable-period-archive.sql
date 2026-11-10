-- Additive metadata only: source payloads and connection settings stay intact.
ALTER TABLE mart_source_snapshots ADD COLUMN IF NOT EXISTS content_hash text;
ALTER TABLE mart_dashboard_archive ADD COLUMN IF NOT EXISTS calculation_version text;
ALTER TABLE mart_dashboard_archive ADD COLUMN IF NOT EXISTS source_probe jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE mart_dashboard_archive ADD COLUMN IF NOT EXISTS data_hash text;
ALTER TABLE mart_dashboard_archive ADD COLUMN IF NOT EXISTS verified_at timestamptz;
ALTER TABLE mart_dashboard_archive ADD COLUMN IF NOT EXISTS lease_kind text;
