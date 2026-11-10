CREATE TABLE IF NOT EXISTS mart_wallet_percentage (
  effective_from date PRIMARY KEY,
  percent numeric(5,2) NOT NULL CHECK (percent >= 0 AND percent <= 100),
  updated_at timestamptz NOT NULL DEFAULT now()
);
