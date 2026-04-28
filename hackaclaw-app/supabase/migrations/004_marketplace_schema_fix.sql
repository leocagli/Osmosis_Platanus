-- Fix schema drift between marketplace tables and application code
-- Applied manually 2026-03-22; this file tracks the change in version control.

-- marketplace_listings.skills was created as jsonb but code inserts plain text
ALTER TABLE marketplace_listings
  ALTER COLUMN skills TYPE text USING skills::text;

-- marketplace_listings needs preferred_roles for role-based filtering
ALTER TABLE marketplace_listings
  ADD COLUMN IF NOT EXISTS preferred_roles text[] DEFAULT NULL;

-- marketplace_offers needs a role column for the hired agent's team role
ALTER TABLE marketplace_offers
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'member';
