-- ERC-8004 identity + marketplace trust foundation

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS identity_registry TEXT,
  ADD COLUMN IF NOT EXISTS identity_agent_id TEXT,
  ADD COLUMN IF NOT EXISTS identity_chain_id INTEGER,
  ADD COLUMN IF NOT EXISTS identity_agent_uri TEXT,
  ADD COLUMN IF NOT EXISTS identity_wallet TEXT,
  ADD COLUMN IF NOT EXISTS identity_owner_wallet TEXT,
  ADD COLUMN IF NOT EXISTS identity_source TEXT,
  ADD COLUMN IF NOT EXISTS identity_link_status TEXT,
  ADD COLUMN IF NOT EXISTS identity_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS marketplace_reputation_score INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS marketplace_completed_roles INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS marketplace_successful_roles INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS marketplace_failed_roles INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS marketplace_review_approvals INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS marketplace_no_show_count INTEGER NOT NULL DEFAULT 0;

UPDATE agents
SET marketplace_reputation_score = COALESCE(reputation_score, 0)
WHERE marketplace_reputation_score = 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agents_identity_source_check'
  ) THEN
    ALTER TABLE agents
      ADD CONSTRAINT agents_identity_source_check
      CHECK (identity_source IS NULL OR identity_source IN ('external', 'buildersclaw'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agents_identity_link_status_check'
  ) THEN
    ALTER TABLE agents
      ADD CONSTRAINT agents_identity_link_status_check
      CHECK (identity_link_status IS NULL OR identity_link_status IN ('unlinked', 'linked', 'stale', 'invalid'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_identity_registry_agent_id
  ON agents(identity_registry, identity_agent_id)
  WHERE identity_registry IS NOT NULL AND identity_agent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agents_marketplace_reputation_score
  ON agents(marketplace_reputation_score DESC);

CREATE INDEX IF NOT EXISTS idx_agents_identity_wallet
  ON agents(identity_wallet)
  WHERE identity_wallet IS NOT NULL;

CREATE TABLE IF NOT EXISTS agent_identity_snapshots (
  agent_id UUID PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  identity_registry TEXT NOT NULL,
  identity_agent_id TEXT NOT NULL,
  identity_chain_id INTEGER NOT NULL,
  identity_agent_uri TEXT,
  identity_wallet TEXT,
  identity_owner_wallet TEXT,
  registration_valid BOOLEAN NOT NULL DEFAULT false,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_agent_identity_snapshots_registry_agent
  ON agent_identity_snapshots(identity_registry, identity_agent_id);

CREATE TABLE IF NOT EXISTS trusted_reputation_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'buildersclaw',
  label TEXT,
  weight INTEGER NOT NULL DEFAULT 100,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trusted_reputation_sources_active
  ON trusted_reputation_sources(active, wallet_address);

CREATE TABLE IF NOT EXISTS agent_reputation_snapshots (
  agent_id UUID PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  identity_registry TEXT NOT NULL,
  identity_agent_id TEXT NOT NULL,
  trusted_client_count INTEGER NOT NULL DEFAULT 0,
  trusted_feedback_count INTEGER NOT NULL DEFAULT 0,
  trusted_summary_value TEXT,
  trusted_summary_decimals INTEGER,
  raw_client_count INTEGER NOT NULL DEFAULT 0,
  raw_feedback_count INTEGER NOT NULL DEFAULT 0,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_agent_reputation_snapshots_last_synced
  ON agent_reputation_snapshots(last_synced_at DESC);
