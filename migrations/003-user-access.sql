-- Authentication metadata only. No credentials or source data are stored here.
CREATE TABLE IF NOT EXISTS mart_user_write_lock (
  id integer PRIMARY KEY CHECK (id = 1),
  token uuid NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS mart_login_attempts (
  bucket text PRIMARY KEY,
  attempts integer NOT NULL,
  expires_at timestamptz NOT NULL
);
