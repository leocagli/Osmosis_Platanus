-- ================================================
-- BuildersClaw v2: Agent Balance + Prompt Billing
-- ================================================
-- New model: agents deposit ETH → get USD credits → spend on OpenRouter prompts
-- Platform takes 5% fee on every prompt execution

-- ─── Agent Balances ───
-- Tracks each agent's current USD balance from ETH deposits

CREATE TABLE IF NOT EXISTS agent_balances (
  agent_id       UUID PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  balance_usd    DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_deposited_usd  DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_spent_usd      DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_fees_usd       DOUBLE PRECISION NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: agents can only read their own balance
ALTER TABLE agent_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agents_read_own_balance" ON agent_balances
  FOR SELECT USING (agent_id = auth.uid());

-- ─── Balance Transactions ───
-- Full audit trail of deposits, charges, fees, refunds

CREATE TABLE IF NOT EXISTS balance_transactions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id       UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  type           TEXT NOT NULL CHECK (type IN ('deposit', 'prompt_charge', 'fee', 'refund', 'entry_fee')),
  amount_usd     DOUBLE PRECISION NOT NULL,  -- positive = credit, negative = debit
  balance_after  DOUBLE PRECISION NOT NULL,
  reference_id   TEXT,                         -- tx_hash for deposits, round_id for charges
  metadata       JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_balance_tx_agent ON balance_transactions(agent_id, created_at DESC);
CREATE INDEX idx_balance_tx_type ON balance_transactions(type);
CREATE INDEX idx_balance_tx_ref ON balance_transactions(reference_id);

ALTER TABLE balance_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agents_read_own_transactions" ON balance_transactions
  FOR SELECT USING (agent_id = auth.uid());

-- ─── Add cost tracking to prompt_rounds ───
-- Track what each prompt actually cost

ALTER TABLE prompt_rounds
  ADD COLUMN IF NOT EXISTS cost_usd        DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS fee_usd         DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS input_tokens    INTEGER,
  ADD COLUMN IF NOT EXISTS output_tokens   INTEGER;

-- ─── Useful views ───

-- Platform revenue summary
CREATE OR REPLACE VIEW platform_revenue AS
  SELECT
    COUNT(*) as total_transactions,
    SUM(CASE WHEN type = 'fee' THEN ABS(amount_usd) ELSE 0 END) as total_fees_earned,
    SUM(CASE WHEN type = 'deposit' THEN amount_usd ELSE 0 END) as total_deposits,
    SUM(CASE WHEN type = 'prompt_charge' THEN ABS(amount_usd) ELSE 0 END) as total_prompt_costs
  FROM balance_transactions;

-- Per-agent spending summary
CREATE OR REPLACE VIEW agent_spending AS
  SELECT
    b.agent_id,
    a.name as agent_name,
    b.balance_usd,
    b.total_deposited_usd,
    b.total_spent_usd,
    b.total_fees_usd,
    (SELECT COUNT(*) FROM prompt_rounds pr WHERE pr.agent_id = b.agent_id) as total_prompts,
    (SELECT SUM(cost_usd) FROM prompt_rounds pr WHERE pr.agent_id = b.agent_id) as total_prompt_cost
  FROM agent_balances b
  JOIN agents a ON a.id = b.agent_id;
