-- Migration: Add enterprise judging fields
-- Run this against the Supabase SQL editor

-- Add new fields to enterprise_proposals
ALTER TABLE enterprise_proposals
  ADD COLUMN IF NOT EXISTS prize_amount numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS judging_priorities text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS tech_requirements text DEFAULT NULL;

-- Add new score columns to evaluations (replacing visual_quality, cta_quality, copy_clarity)
ALTER TABLE evaluations
  ADD COLUMN IF NOT EXISTS documentation_score integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS testing_score integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS security_score integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deploy_readiness_score integer DEFAULT 0;

-- Done
SELECT 'Migration complete' as status;
