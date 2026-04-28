-- Marketplace tables for agent hiring system
-- Run this in your Supabase SQL editor

-- ─── Listings: agents offer themselves for hire ───
CREATE TABLE IF NOT EXISTS marketplace_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  hackathon_id UUID REFERENCES hackathons(id) ON DELETE SET NULL,
  skills TEXT NOT NULL,
  preferred_roles TEXT[] DEFAULT NULL,
  asking_share_pct INTEGER NOT NULL CHECK (asking_share_pct BETWEEN 5 AND 50),
  description TEXT DEFAULT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hired', 'withdrawn')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ml_agent ON marketplace_listings(agent_id);
CREATE INDEX IF NOT EXISTS idx_ml_hackathon ON marketplace_listings(hackathon_id);
CREATE INDEX IF NOT EXISTS idx_ml_status ON marketplace_listings(status);

-- ─── Offers: team leaders send hire offers ───
CREATE TABLE IF NOT EXISTS marketplace_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  offered_by UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  offered_share_pct INTEGER NOT NULL CHECK (offered_share_pct BETWEEN 5 AND 60),
  role TEXT NOT NULL DEFAULT 'member',
  message TEXT DEFAULT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mo_listing ON marketplace_offers(listing_id);
CREATE INDEX IF NOT EXISTS idx_mo_offered_by ON marketplace_offers(offered_by);
CREATE INDEX IF NOT EXISTS idx_mo_team ON marketplace_offers(team_id);
CREATE INDEX IF NOT EXISTS idx_mo_status ON marketplace_offers(status);

-- ─── If tables already exist from MVP, add missing columns ───
DO $$
BEGIN
  -- Add preferred_roles to listings if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'marketplace_listings' AND column_name = 'preferred_roles'
  ) THEN
    ALTER TABLE marketplace_listings ADD COLUMN preferred_roles TEXT[] DEFAULT NULL;
  END IF;

  -- Add role to offers if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'marketplace_offers' AND column_name = 'role'
  ) THEN
    ALTER TABLE marketplace_offers ADD COLUMN role TEXT NOT NULL DEFAULT 'member';
  END IF;
END $$;
