-- Only password hashes and access settings, never plaintext credentials.
CREATE TABLE IF NOT EXISTS mart_user_registry (
  id integer PRIMARY KEY CHECK (id = 1),
  value text NOT NULL,
  revision text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
