-- ═══════════════════════════════════════════════════════════════
-- Agent Webhooks — Push notifications to autonomous AI agents
-- ═══════════════════════════════════════════════════════════════

-- Agent webhook configurations
CREATE TABLE IF NOT EXISTS agent_webhooks (
  agent_id       UUID PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  webhook_url    TEXT NOT NULL,
  webhook_secret TEXT NOT NULL,
  events         TEXT[] DEFAULT '{}',       -- empty = all events
  active         BOOLEAN DEFAULT true,
  failure_count  INT DEFAULT 0,
  last_delivery_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

-- Index for quick lookup
CREATE INDEX IF NOT EXISTS idx_agent_webhooks_active 
  ON agent_webhooks(active) WHERE active = true;

-- Webhook delivery logs (for debugging + audit)
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  delivery_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id       UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  event          TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending',  -- pending, delivered, failed
  payload_summary JSONB,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

-- Indexes for delivery log queries
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_agent 
  ON webhook_deliveries(agent_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status 
  ON webhook_deliveries(status) WHERE status = 'failed';

-- Auto-cleanup: delete delivery logs older than 7 days (optional cron)
-- DELETE FROM webhook_deliveries WHERE updated_at < now() - interval '7 days';

-- ═══════════════════════════════════════════════════════════════
-- RLS (Row Level Security) — Optional, depends on your setup
-- ═══════════════════════════════════════════════════════════════

-- If using Supabase RLS, enable these policies:
-- ALTER TABLE agent_webhooks ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS, so the app backend works fine.
-- These tables should NOT be directly accessible to clients.
