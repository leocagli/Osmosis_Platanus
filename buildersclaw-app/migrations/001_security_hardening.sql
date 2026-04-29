-- ═══════════════════════════════════════════════════════════════
-- SECURITY HARDENING MIGRATION — BuildersClaw
-- 
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
--
-- What this does:
--   1. Prevents double-deposit race condition (unique index)
--   2. Prevents negative balances at DB level (CHECK constraint)
--   3. Prevents invalid share splits (CHECK constraint)
--   4. Faster queries on hot paths (indexes)
--   5. Security audit log table
--   6. RLS on anon-facing tables (blocks direct anon writes)
-- ═══════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────
-- 1. DOUBLE-DEPOSIT PREVENTION
-- A unique partial index on (reference_id, type='deposit')
-- means two concurrent INSERT with the same tx_hash → one fails.
-- This is the DB-level fix for the TOCTOU race condition.
-- ─────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS idx_balance_tx_ref_unique
  ON balance_transactions (reference_id)
  WHERE reference_id IS NOT NULL AND type = 'deposit';


-- ─────────────────────────────────────────────
-- 2. CHECK CONSTRAINTS — impossible states at DB level
-- ─────────────────────────────────────────────

-- Negative balance should never happen (even if app logic has bugs)
DO $$ BEGIN
  ALTER TABLE agent_balances
    ADD CONSTRAINT ck_balance_non_negative
    CHECK (balance_usd >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Revenue share must be 0–100 (never negative, never > 100%)
DO $$ BEGIN
  ALTER TABLE team_members
    ADD CONSTRAINT ck_share_bounds
    CHECK (revenue_share_pct >= 0 AND revenue_share_pct <= 100);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- api_key_hash must exist and be a proper SHA-256 (64 hex chars)
DO $$ BEGIN
  ALTER TABLE agents
    ADD CONSTRAINT ck_api_key_hash_valid
    CHECK (api_key_hash IS NOT NULL AND length(api_key_hash) = 64);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ─────────────────────────────────────────────
-- 3. PERFORMANCE INDEXES
-- These speed up the most frequent queries.
-- ─────────────────────────────────────────────

-- Join endpoint checks tx_hash replay via activity_log.event_data
CREATE INDEX IF NOT EXISTS idx_activity_log_event_data_gin
  ON activity_log USING gin (event_data);

-- Auth checks team membership by (agent_id) across hackathons
CREATE INDEX IF NOT EXISTS idx_team_members_agent
  ON team_members (agent_id);

-- Chat polling: WHERE team_id = X AND created_at > Y
CREATE INDEX IF NOT EXISTS idx_team_chat_team_created
  ON team_chat (team_id, created_at);

-- Marketplace: open listings per team
CREATE INDEX IF NOT EXISTS idx_marketplace_team_status
  ON marketplace_listings (team_id, status)
  WHERE status = 'open';

-- Balance lookups by agent
CREATE INDEX IF NOT EXISTS idx_balance_tx_agent_created
  ON balance_transactions (agent_id, created_at DESC);


-- ─────────────────────────────────────────────
-- 4. SECURITY AUDIT LOG
-- Stores failed auth attempts, rate limit hits, 
-- suspicious activity for forensic review.
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS security_audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type  text NOT NULL,        -- 'auth_failed', 'rate_limited', 'double_deposit', etc.
  ip_address  text,
  agent_id    text,                  -- nullable (pre-auth events)
  endpoint    text,                  -- '/api/v1/balance', etc.
  details     jsonb DEFAULT '{}',
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created
  ON security_audit_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_type_created
  ON security_audit_log (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_agent
  ON security_audit_log (agent_id, created_at DESC)
  WHERE agent_id IS NOT NULL;


-- ─────────────────────────────────────────────
-- 5. RLS — Block anon client from writing
--
-- Your API uses supabaseAdmin (service_role) which BYPASSES RLS.
-- These policies only restrict the anon key (NEXT_PUBLIC_SUPABASE_ANON_KEY)
-- which is exposed in the browser. 
--
-- Goal: if someone grabs the anon key from your frontend JS,
-- they can only READ public data — never INSERT/UPDATE/DELETE.
-- ─────────────────────────────────────────────

-- AGENTS: anon can read active agents (public profiles), never write
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_active_agents" ON agents;
CREATE POLICY "anon_read_active_agents" ON agents
  FOR SELECT TO anon
  USING (status = 'active');

-- Block anon INSERT/UPDATE/DELETE on agents
DROP POLICY IF EXISTS "anon_no_write_agents" ON agents;
CREATE POLICY "anon_no_write_agents" ON agents
  FOR ALL TO anon
  USING (false)
  WITH CHECK (false);

-- HACKATHONS: anon can read all, never write
ALTER TABLE hackathons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_hackathons" ON hackathons;
CREATE POLICY "anon_read_hackathons" ON hackathons
  FOR SELECT TO anon
  USING (true);

DROP POLICY IF EXISTS "anon_no_write_hackathons" ON hackathons;
CREATE POLICY "anon_no_write_hackathons" ON hackathons
  FOR ALL TO anon
  USING (false)
  WITH CHECK (false);

-- TEAMS: anon can read, never write
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_teams" ON teams;
CREATE POLICY "anon_read_teams" ON teams
  FOR SELECT TO anon
  USING (true);

DROP POLICY IF EXISTS "anon_no_write_teams" ON teams;
CREATE POLICY "anon_no_write_teams" ON teams
  FOR ALL TO anon
  USING (false)
  WITH CHECK (false);

-- SUBMISSIONS: anon can read, never write
ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_submissions" ON submissions;
CREATE POLICY "anon_read_submissions" ON submissions
  FOR SELECT TO anon
  USING (true);

DROP POLICY IF EXISTS "anon_no_write_submissions" ON submissions;
CREATE POLICY "anon_no_write_submissions" ON submissions
  FOR ALL TO anon
  USING (false)
  WITH CHECK (false);

-- BALANCES: anon can NEVER read or write (financial data)
ALTER TABLE agent_balances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_no_access_balances" ON agent_balances;
CREATE POLICY "anon_no_access_balances" ON agent_balances
  FOR ALL TO anon
  USING (false)
  WITH CHECK (false);

-- BALANCE TRANSACTIONS: anon can NEVER read or write
ALTER TABLE balance_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_no_access_balance_tx" ON balance_transactions;
CREATE POLICY "anon_no_access_balance_tx" ON balance_transactions
  FOR ALL TO anon
  USING (false)
  WITH CHECK (false);

-- TEAM CHAT: anon can NEVER read or write (private messages)
ALTER TABLE team_chat ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_no_access_chat" ON team_chat;
CREATE POLICY "anon_no_access_chat" ON team_chat
  FOR ALL TO anon
  USING (false)
  WITH CHECK (false);

-- SECURITY AUDIT LOG: anon can NEVER access
ALTER TABLE security_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_no_access_audit" ON security_audit_log;
CREATE POLICY "anon_no_access_audit" ON security_audit_log
  FOR ALL TO anon
  USING (false)
  WITH CHECK (false);

-- ACTIVITY LOG: anon can read (public hackathon activity), never write
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_activity" ON activity_log;
CREATE POLICY "anon_read_activity" ON activity_log
  FOR SELECT TO anon
  USING (true);

DROP POLICY IF EXISTS "anon_no_write_activity" ON activity_log;
CREATE POLICY "anon_no_write_activity" ON activity_log
  FOR ALL TO anon
  USING (false)
  WITH CHECK (false);


-- ─────────────────────────────────────────────
-- 6. Grant service_role full bypass (already default, but explicit)
-- ─────────────────────────────────────────────

-- service_role bypasses RLS by default in Supabase.
-- This ensures our API routes (supabaseAdmin) are unaffected.
-- No action needed — just documenting.


-- ═══════════════════════════════════════════════════════════════
-- DONE. Verify with:
--   SELECT tablename, policyname FROM pg_policies ORDER BY tablename;
--   SELECT conname, conrelid::regclass FROM pg_constraint WHERE conname LIKE 'ck_%';
--   SELECT indexname FROM pg_indexes WHERE indexname LIKE 'idx_%';
-- ═══════════════════════════════════════════════════════════════
