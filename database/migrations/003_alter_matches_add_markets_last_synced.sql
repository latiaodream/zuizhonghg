-- Add markets and last_synced_at to matches (idempotent)
DO $$
BEGIN
  BEGIN
    ALTER TABLE matches ADD COLUMN markets JSONB;
  EXCEPTION WHEN duplicate_column THEN
    -- ignore
  END;
  BEGIN
    ALTER TABLE matches ADD COLUMN last_synced_at TIMESTAMP;
  EXCEPTION WHEN duplicate_column THEN
    -- ignore
  END;
END$$;

