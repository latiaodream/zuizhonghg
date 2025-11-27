-- Add fields used by backend for crown_accounts (idempotent)
ALTER TABLE crown_accounts
  ADD COLUMN IF NOT EXISTS original_username VARCHAR(100);

ALTER TABLE crown_accounts
  ADD COLUMN IF NOT EXISTS initialized_username VARCHAR(100);

ALTER TABLE crown_accounts
  ADD COLUMN IF NOT EXISTS agent_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE crown_accounts
  ADD COLUMN IF NOT EXISTS use_for_fetch BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_crown_accounts_agent_id ON crown_accounts(agent_id);
CREATE INDEX IF NOT EXISTS idx_crown_accounts_use_for_fetch ON crown_accounts(use_for_fetch);

