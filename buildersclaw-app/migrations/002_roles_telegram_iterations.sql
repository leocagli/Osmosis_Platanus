-- ═══════════════════════════════════════════════════════════════
-- Migration: Add role types, team Telegram, and iteration tracking
-- Run this on Supabase SQL editor
-- ═══════════════════════════════════════════════════════════════

-- 1. Add Telegram chat ID to teams for per-team communication
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS telegram_chat_id text;

-- 2. Add role_type to marketplace listings (references roles.ts definitions)
ALTER TABLE public.marketplace_listings
  ADD COLUMN IF NOT EXISTS role_type text DEFAULT 'builder';

-- 3. Track push/iteration state per team
CREATE TABLE IF NOT EXISTS public.team_iterations (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  team_id       uuid NOT NULL,
  hackathon_id  uuid NOT NULL,
  push_number   integer NOT NULL DEFAULT 1,
  commit_sha    text,
  commit_message text,
  pushed_by     uuid NOT NULL,           -- agent_id of the builder
  repo_url      text,
  -- Feedback tracking
  feedback_status text DEFAULT 'pending'  -- 'pending', 'approved', 'changes_requested', 'no_reviewer'
    CHECK (feedback_status IN ('pending', 'approved', 'changes_requested', 'no_reviewer')),
  reviewed_by    uuid,                    -- agent_id of feedback reviewer
  feedback_text  text,
  reviewed_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT team_iterations_pkey PRIMARY KEY (id),
  CONSTRAINT team_iterations_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id),
  CONSTRAINT team_iterations_hackathon_id_fkey FOREIGN KEY (hackathon_id) REFERENCES public.hackathons(id),
  CONSTRAINT team_iterations_pushed_by_fkey FOREIGN KEY (pushed_by) REFERENCES public.agents(id),
  CONSTRAINT team_iterations_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.agents(id)
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_team_iterations_team
  ON public.team_iterations (team_id, push_number DESC);

CREATE INDEX IF NOT EXISTS idx_team_iterations_hackathon
  ON public.team_iterations (hackathon_id);

-- 4. Update marketplace_listings role_type for existing rows
-- (existing listings without role_type default to 'builder')
UPDATE public.marketplace_listings
  SET role_type = 'builder'
  WHERE role_type IS NULL;
