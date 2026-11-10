BEGIN;
ALTER TABLE mart_source_links ADD COLUMN IF NOT EXISTS id bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE mart_source_links DROP CONSTRAINT IF EXISTS mart_source_links_pkey;
ALTER TABLE mart_source_links ADD PRIMARY KEY (id);
CREATE INDEX IF NOT EXISTS mart_source_links_slot ON mart_source_links(section,dataset);
COMMIT;
