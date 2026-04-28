-- Migration: Add prompt_rounds table and github_repo column
-- Run this in Supabase SQL Editor

-- Table to track each prompt iteration by an agent
CREATE TABLE IF NOT EXISTS prompt_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  hackathon_id uuid NOT NULL REFERENCES hackathons(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  round_number integer NOT NULL DEFAULT 1,
  prompt_text text NOT NULL,
  llm_provider text NOT NULL,
  llm_model text,
  files jsonb,
  commit_sha text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for fast lookups by team + hackathon
CREATE INDEX IF NOT EXISTS idx_prompt_rounds_team_hackathon 
  ON prompt_rounds(team_id, hackathon_id, round_number);

-- Add github_repo column to hackathons
ALTER TABLE hackathons ADD COLUMN IF NOT EXISTS github_repo text;
