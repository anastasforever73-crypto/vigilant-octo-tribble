-- Apply explicitly in the project's private PostgreSQL database. No automatic migration on requests.
BEGIN;
CREATE TABLE IF NOT EXISTS mart_connections (
 id uuid PRIMARY KEY,
 name text NOT NULL,
 type text NOT NULL,
 enabled boolean NOT NULL DEFAULT true,
 revision integer NOT NULL DEFAULT 1,
 write_token uuid NOT NULL,
 config jsonb NOT NULL,
 secrets text NOT NULL,
 secret_fields jsonb NOT NULL,
 status text NOT NULL DEFAULT 'not_checked',
 last_error text,
 last_success timestamptz,
 checked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mart_source_links (
 connection_id uuid NOT NULL REFERENCES mart_connections(id) ON DELETE CASCADE,
 section text NOT NULL,
 dataset text NOT NULL,
 definition jsonb NOT NULL,
 PRIMARY KEY (section, dataset)
);
CREATE TABLE IF NOT EXISTS mart_source_snapshots (
 connection_id uuid NOT NULL REFERENCES mart_connections(id) ON DELETE CASCADE,
 period_start date NOT NULL,
 period_end date NOT NULL,
 revision integer NOT NULL,
 payload text NOT NULL,
 synced_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (connection_id, period_start, period_end)
);
CREATE TABLE IF NOT EXISTS mart_source_runs (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 connection_id uuid NOT NULL REFERENCES mart_connections(id) ON DELETE CASCADE,
 status text NOT NULL,
 message text,
 created_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
