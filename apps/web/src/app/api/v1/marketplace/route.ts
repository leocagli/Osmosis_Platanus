import { NextRequest } from "next/server";
import { v4 as uuid } from "uuid";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { authenticateRequest } from "@buildersclaw/shared/auth";
import { getDb, schema } from "@buildersclaw/shared/db";
import { success, created, error, unauthorized } from "@buildersclaw/shared/responses";
import { sanitizeString } from "@buildersclaw/shared/hackathons";
import {
  MEMBER_MIN_SHARE_PCT,
  LEADER_MIN_KEEP_PCT,
  LISTING_MAX_SHARE_PCT,
  LISTING_MIN_SHARE_PCT,
  MAX_OPEN_LISTINGS_PER_TEAM,
  MAX_ALLOCATED_PCT,
  isValidUUID,
  checkRateLimit,
  getTeamShareSnapshot,
  validateTeamTotalShares,
  validateSharePct,
  validateRoleType,
} from "@buildersclaw/shared/validation";
import { getMarketplaceReputationScore } from "@buildersclaw/shared/erc8004";

/**
 * ═══════════════════════════════════════════════════════════════
 * MARKETPLACE — Team leaders post roles. Agents claim them.
 * ═══════════════════════════════════════════════════════════════
 *
 * SQL migration for the new marketplace_listings schema:
 *
 * -- Drop the old offers table (no longer needed)
 * DROP TABLE IF EXISTS marketplace_offers;
 *
 * -- Recreate marketplace_listings with the new schema
 * DROP TABLE IF EXISTS marketplace_listings;
 * CREATE TABLE marketplace_listings (
 *   id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   hackathon_id  UUID NOT NULL REFERENCES hackathons(id),
 *   team_id       UUID NOT NULL REFERENCES teams(id),
 *   posted_by     UUID NOT NULL REFERENCES agents(id),
 *   role_title    TEXT NOT NULL,
 *   role_description TEXT,
 *   share_pct     INTEGER NOT NULL CHECK (share_pct BETWEEN 5 AND 50),
 *   status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','taken','withdrawn')),
 *   taken_by      UUID REFERENCES agents(id),
 *   taken_at      TIMESTAMPTZ,
 *   created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
 * );
 *
 * CREATE INDEX idx_marketplace_listings_hackathon ON marketplace_listings(hackathon_id);
 * CREATE INDEX idx_marketplace_listings_status ON marketplace_listings(status);
 * CREATE INDEX idx_marketplace_listings_team ON marketplace_listings(team_id);
 */

/** Share % guardrails — imported from @buildersclaw/shared/validation */
const MIN_SHARE_PCT = MEMBER_MIN_SHARE_PCT;
const MAX_SHARE_PCT = LISTING_MAX_SHARE_PCT;
const LEADER_MIN_KEEP = LEADER_MIN_KEEP_PCT;

/**
 * GET /api/v1/marketplace — Browse marketplace listings.
 *
 * Public — no auth needed.
 * ?hackathon_id=  — filter by specific hackathon
 * ?status=        — open (default) | taken | withdrawn
 */
export async function GET(req: NextRequest) {
  const db = getDb();
  const hackathonId = req.nextUrl.searchParams.get("hackathon_id");
  const status = req.nextUrl.searchParams.get("status") || "open";

  try {
    const where = hackathonId
      ? and(eq(schema.marketplaceListings.status, status as "open" | "taken" | "withdrawn"), eq(schema.marketplaceListings.hackathonId, hackathonId))
      : eq(schema.marketplaceListings.status, status as "open" | "taken" | "withdrawn");

    const listings = await db
      .select({
        id: schema.marketplaceListings.id,
        hackathon_id: schema.marketplaceListings.hackathonId,
        team_id: schema.marketplaceListings.teamId,
        posted_by: schema.marketplaceListings.postedBy,
        role_title: schema.marketplaceListings.roleTitle,
        role_description: schema.marketplaceListings.roleDescription,
        share_pct: schema.marketplaceListings.sharePct,
        status: schema.marketplaceListings.status,
        taken_by: schema.marketplaceListings.takenBy,
        taken_at: schema.marketplaceListings.takenAt,
        created_at: schema.marketplaceListings.createdAt,
        poster: {
          id: schema.agents.id,
          name: schema.agents.name,
          display_name: schema.agents.displayName,
          avatar_url: schema.agents.avatarUrl,
          reputation_score: schema.agents.reputationScore,
          marketplace_reputation_score: schema.agents.marketplaceReputationScore,
          strategy: schema.agents.strategy,
          identity_registry: schema.agents.identityRegistry,
          identity_agent_id: schema.agents.identityAgentId,
          identity_chain_id: schema.agents.identityChainId,
          identity_agent_uri: schema.agents.identityAgentUri,
          identity_wallet: schema.agents.identityWallet,
          identity_owner_wallet: schema.agents.identityOwnerWallet,
          identity_source: schema.agents.identitySource,
          identity_link_status: schema.agents.identityLinkStatus,
          identity_verified_at: schema.agents.identityVerifiedAt,
        },
        team: {
          id: schema.teams.id,
          name: schema.teams.name,
          status: schema.teams.status,
        },
        hackathon: {
          id: schema.hackathons.id,
          title: schema.hackathons.title,
          brief: schema.hackathons.brief,
          prize_pool: schema.hackathons.prizePool,
          status: schema.hackathons.status,
          ends_at: schema.hackathons.endsAt,
          challenge_type: schema.hackathons.challengeType,
          build_time_seconds: schema.hackathons.buildTimeSeconds,
        },
      })
      .from(schema.marketplaceListings)
      .innerJoin(schema.agents, eq(schema.marketplaceListings.postedBy, schema.agents.id))
      .innerJoin(schema.teams, eq(schema.marketplaceListings.teamId, schema.teams.id))
      .innerJoin(schema.hackathons, eq(schema.marketplaceListings.hackathonId, schema.hackathons.id))
      .where(where)
      .orderBy(desc(schema.marketplaceListings.createdAt))
      .limit(100);

    const posterIds = Array.from(new Set(listings.map((listing) => listing.posted_by)));

    type ReputationSnapshotRow = {
      agent_id: string;
      trusted_feedback_count: number | null;
      trusted_summary_value: string | null;
      trusted_summary_decimals: number | null;
      raw_feedback_count: number | null;
      last_synced_at: string | null;
    };

    const reputationSnapshots = posterIds.length > 0
      ? await db
        .select({
          agent_id: schema.agentReputationSnapshots.agentId,
          trusted_feedback_count: schema.agentReputationSnapshots.trustedFeedbackCount,
          trusted_summary_value: schema.agentReputationSnapshots.trustedSummaryValue,
          trusted_summary_decimals: schema.agentReputationSnapshots.trustedSummaryDecimals,
          raw_feedback_count: schema.agentReputationSnapshots.rawFeedbackCount,
          last_synced_at: schema.agentReputationSnapshots.lastSyncedAt,
        })
        .from(schema.agentReputationSnapshots)
        .where(inArray(schema.agentReputationSnapshots.agentId, posterIds))
      : [];

    const reputationSnapshotMap = new Map<string, ReputationSnapshotRow>(
      reputationSnapshots.map((snapshot) => [snapshot.agent_id, snapshot])
    );

    const flat = listings.map((l) => {
      const poster = l.poster;
      const team = l.team;
      const hackathon = l.hackathon;

      return {
        id: l.id,
        hackathon_id: l.hackathon_id,
        hackathon_title: hackathon?.title || null,
        hackathon_brief: hackathon?.brief || null,
        hackathon_prize_pool: hackathon?.prize_pool ?? 0,
        hackathon_status: hackathon?.status || null,
        hackathon_ends_at: hackathon?.ends_at || null,
        hackathon_challenge_type: hackathon?.challenge_type || null,
        hackathon_build_time: hackathon?.build_time_seconds || null,
        team_id: l.team_id,
        team_name: team?.name || null,
        team_status: team?.status || null,
        posted_by: l.posted_by,
        poster_name: poster?.display_name || poster?.name || null,
        poster_avatar: poster?.avatar_url || null,
        poster_reputation: getMarketplaceReputationScore(poster || {}),
        poster_identity: {
          linked: !!poster?.identity_registry && !!poster?.identity_agent_id,
          agent_registry: poster?.identity_registry || null,
          agent_id: poster?.identity_agent_id || null,
          chain_id: poster?.identity_chain_id || null,
          agent_uri: poster?.identity_agent_uri || null,
          wallet: poster?.identity_wallet || null,
          owner_wallet: poster?.identity_owner_wallet || null,
          source: poster?.identity_source || null,
          link_status: poster?.identity_link_status || null,
          verified_at: poster?.identity_verified_at || null,
        },
        poster_external_reputation: (() => {
          const snapshot = reputationSnapshotMap.get(l.posted_by);
          if (!snapshot) return null;
          return {
            trusted_feedback_count: snapshot.trusted_feedback_count ?? 0,
            trusted_summary_value: snapshot.trusted_summary_value ?? null,
            trusted_summary_decimals: snapshot.trusted_summary_decimals ?? null,
            raw_feedback_count: snapshot.raw_feedback_count ?? 0,
            last_synced_at: snapshot.last_synced_at ?? null,
          };
        })(),
        poster_github: (() => {
          try {
            const s = poster?.strategy;
            if (s) { const p = JSON.parse(s); return p?.github_username || null; }
          } catch { /* not JSON */ }
          return null;
        })(),
        role_title: l.role_title,
        role_description: (() => {
          try {
            const parsed = JSON.parse(l.role_description || "{}");
            return parsed?.description || null;
          } catch { return l.role_description; }
        })(),
        repo_url: (() => {
          try {
            const parsed = JSON.parse(l.role_description || "{}");
            return parsed?.repo_url || null;
          } catch { return null; }
        })(),
        share_pct: l.share_pct,
        status: l.status,
        taken_by: l.taken_by,
        taken_at: l.taken_at,
        created_at: l.created_at,
      };
    });

    return success(flat);
  } catch (queryErr) {
    console.error("Marketplace GET failed:", queryErr);
    return error("Failed to fetch listings", 500);
  }
}

/**
 * POST /api/v1/marketplace — Team leader posts a role listing.
 *
 * Auth required. Only the team leader can post.
 *
 * Body: {
 *   hackathon_id,       — which hackathon
 *   team_id,            — which team (caller must be leader)
 *   role_title,         — e.g. "Frontend Dev", "API Engineer"
 *   role_description?,  — optional longer description
 *   share_pct           — 5–50% of the prize
 * }
 */
export async function POST(req: NextRequest) {
  const db = getDb();
  const agent = await authenticateRequest(req);
  if (!agent) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Invalid JSON body", 400);
  }

  // ── Validate required fields ──
  const hackathonId = typeof body.hackathon_id === "string" ? body.hackathon_id.trim() : null;
  const teamId = typeof body.team_id === "string" ? body.team_id.trim() : null;
  const roleTitle = sanitizeString(body.role_title, 100);
  const roleDescription = sanitizeString(body.role_description, 1000);
  const repoUrl = sanitizeString(body.repo_url, 512);
  const sharePct = Number(body.share_pct);

  if (!hackathonId) return error("hackathon_id is required", 400);
  if (!teamId) return error("team_id is required", 400);
  if (!roleTitle) return error("role_title is required (e.g. 'Frontend Dev')", 400);

  // ── SECURITY: Validate role_type if provided ──
  const roleType = typeof body.role_type === "string" ? body.role_type.trim() : null;
  if (roleType) {
    const roleCheck = validateRoleType(roleType);
    if (!roleCheck.valid) {
      return error(roleCheck.message || "Invalid role_type", 400);
    }
  }

  // ── Validate UUID format ──
  if (!isValidUUID(hackathonId)) return error("Invalid hackathon_id format", 400);
  if (!isValidUUID(teamId)) return error("Invalid team_id format", 400);

  // ── Rate limit: max 5 listings per agent per hour ──
  const rateCheck = checkRateLimit(`listing:${agent.id}`, 5, 3600_000);
  if (!rateCheck.allowed) {
    return error("Too many listings. Try again later.", 429);
  }

  if (!repoUrl) {
    return error(
      "repo_url is required — create a GitHub repo for the team first, then include the URL so teammates can clone it.",
      400,
      {
        how: "curl -X POST https://api.github.com/user/repos -H \"Authorization: token $GITHUB_TOKEN\" -d '{\"name\":\"hackathon-solution\",\"public\":true}'",
      },
    );
  }

  if (!hackathonId) return error("hackathon_id is required", 400);
  if (!teamId) return error("team_id is required", 400);
  if (!roleTitle) return error("role_title is required (e.g. 'Frontend Dev')", 400);

  // ── SECURITY: Validate share_pct is not zero and within bounds ──
  const shareCheck = validateSharePct(body.share_pct, "listing");
  if (!shareCheck.valid) {
    return error(shareCheck.message || `share_pct must be ${LISTING_MIN_SHARE_PCT}–${MAX_SHARE_PCT}%`, 400);
  }

  if (!Number.isFinite(sharePct) || sharePct < MIN_SHARE_PCT || sharePct > MAX_SHARE_PCT) {
    return error(`share_pct must be ${MIN_SHARE_PCT}–${MAX_SHARE_PCT}%`, 400);
  }

  // ── Verify hackathon is active ──
  const [hackathon] = await db
    .select({ id: schema.hackathons.id, status: schema.hackathons.status, team_size_max: schema.hackathons.teamSizeMax })
    .from(schema.hackathons)
    .where(eq(schema.hackathons.id, hackathonId))
    .limit(1);

  if (!hackathon) return error("Hackathon not found", 404);
  if (hackathon.status !== "open" && hackathon.status !== "in_progress") {
    return error("Can only post listings for active hackathons", 400);
  }

  // ── Verify team belongs to this hackathon ──
  const [team] = await db
    .select({ id: schema.teams.id, hackathon_id: schema.teams.hackathonId, name: schema.teams.name })
    .from(schema.teams)
    .where(eq(schema.teams.id, teamId))
    .limit(1);

  if (!team) return error("Team not found", 404);
  if (team.hackathon_id !== hackathonId) {
    return error("Team does not belong to this hackathon", 400);
  }

  // ── Verify caller is the team leader ──
  const [leaderMember] = await db
    .select({ id: schema.teamMembers.id, role: schema.teamMembers.role, revenue_share_pct: schema.teamMembers.revenueSharePct })
    .from(schema.teamMembers)
    .where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.agentId, agent.id), eq(schema.teamMembers.role, "leader")))
    .limit(1);

  if (!leaderMember) {
    return error("Only the team leader can post marketplace listings", 403);
  }

  // ── Check leader keeps ≥ 20% after this listing ──
  // Use centralized snapshot for accurate calculation
  const snapshot = await getTeamShareSnapshot(teamId);

  // ── Cap open listings per team ──
  const [{ value: openCount }] = await db
    .select({ value: count() })
    .from(schema.marketplaceListings)
    .where(and(eq(schema.marketplaceListings.teamId, teamId), eq(schema.marketplaceListings.status, "open")));

  if (openCount >= MAX_OPEN_LISTINGS_PER_TEAM) {
    return error(`Maximum ${MAX_OPEN_LISTINGS_PER_TEAM} open listings per team. Withdraw one first.`, 400);
  }

  // ── SECURITY: Comprehensive share distribution validation ──
  const shareValidation = await validateTeamTotalShares(teamId, Math.round(sharePct));
  if (!shareValidation.valid) {
    return error(
      `Share distribution violation: ${shareValidation.issues.join("; ")}`,
      400,
      {
        breakdown: {
          current_members_pct: shareValidation.total_member_pct,
          open_listings_pct: shareValidation.open_listings_pct,
          proposed_pct: shareValidation.additional_pct,
          leader_would_keep: shareValidation.leader_would_keep,
          max_allocatable: MAX_ALLOCATED_PCT,
        },
      },
    );
  }

  // ── Create the listing ──
  const listingId = uuid();
  const now = new Date().toISOString();

  try {
    await db.insert(schema.marketplaceListings).values({
      id: listingId,
      hackathonId,
      teamId,
      postedBy: agent.id,
      roleTitle,
      roleDescription: JSON.stringify({
        description: roleDescription,
        repo_url: repoUrl,
      }),
      sharePct: Math.round(sharePct),
      status: "open",
      createdAt: now,
    });
  } catch (insertErr) {
    console.error("Marketplace listing insert failed:", insertErr);
    return error("Failed to create listing", 500);
  }

  // ── Activity log ──
  await db.insert(schema.activityLog).values({
    id: uuid(),
    hackathonId,
    teamId,
    agentId: agent.id,
    eventType: "marketplace_listing_posted",
    eventData: {
      listing_id: listingId,
      role_title: roleTitle,
      share_pct: Math.round(sharePct),
    },
  });

  return created({
    id: listingId,
    team_id: teamId,
    role_title: roleTitle,
    repo_url: repoUrl,
    share_pct: Math.round(sharePct),
    leader_keeps: shareValidation.leader_would_keep,
    status: "open",
    message: `Role "${roleTitle}" posted at ${Math.round(sharePct)}% share. Repo: ${repoUrl}. Agents can now claim it directly.`,
  });
}

/**
 * DELETE /api/v1/marketplace — Withdraw a listing.
 *
 * Auth required. Only the original poster can withdraw.
 *
 * Body: { listing_id }
 */
export async function DELETE(req: NextRequest) {
  const db = getDb();
  const agent = await authenticateRequest(req);
  if (!agent) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Invalid JSON body", 400);
  }

  const listingId = typeof body.listing_id === "string" ? body.listing_id.trim() : null;
  if (!listingId) return error("listing_id is required", 400);
  if (!isValidUUID(listingId)) return error("Invalid listing_id format", 400);

  // Fetch the listing
  const [listing] = await db
    .select({ id: schema.marketplaceListings.id, posted_by: schema.marketplaceListings.postedBy, status: schema.marketplaceListings.status })
    .from(schema.marketplaceListings)
    .where(eq(schema.marketplaceListings.id, listingId))
    .limit(1);

  if (!listing) return error("Listing not found", 404);
  if (listing.posted_by !== agent.id) return error("Only the poster can withdraw this listing", 403);
  if (listing.status !== "open") {
    return error(`Cannot withdraw — listing is already "${listing.status}"`, 409);
  }

  // Mark as withdrawn
  try {
    await db.update(schema.marketplaceListings).set({ status: "withdrawn" }).where(eq(schema.marketplaceListings.id, listingId));
  } catch (updateErr) {
    console.error("Marketplace listing withdraw failed:", updateErr);
    return error("Failed to withdraw listing", 500);
  }

  return success({
    id: listingId,
    status: "withdrawn",
    message: "Listing withdrawn successfully.",
  });
}

/**
 * PATCH /api/v1/marketplace — Edit an existing open listing.
 *
 * Auth required. Only the original poster can edit. Only open listings.
 *
 * Body: { listing_id, share_pct?, role_title?, role_description?, repo_url? }
 */
export async function PATCH(req: NextRequest) {
  const db = getDb();
  const agent = await authenticateRequest(req);
  if (!agent) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Invalid JSON body", 400);
  }

  const listingId = typeof body.listing_id === "string" ? body.listing_id.trim() : null;
  if (!listingId) return error("listing_id is required", 400);
  if (!isValidUUID(listingId)) return error("Invalid listing_id format", 400);

  // Fetch the listing
  const [listing] = await db
    .select({ id: schema.marketplaceListings.id, posted_by: schema.marketplaceListings.postedBy, status: schema.marketplaceListings.status, team_id: schema.marketplaceListings.teamId, share_pct: schema.marketplaceListings.sharePct })
    .from(schema.marketplaceListings)
    .where(eq(schema.marketplaceListings.id, listingId))
    .limit(1);

  if (!listing) return error("Listing not found", 404);
  if (listing.posted_by !== agent.id) return error("Only the poster can edit this listing", 403);
  if (listing.status !== "open") {
    return error(`Cannot edit — listing is "${listing.status}". Only open listings can be edited.`, 409);
  }

  // Build update payload
  const updates: Record<string, unknown> = {};

  // Update share_pct
  if (body.share_pct !== undefined) {
    const shareCheck = validateSharePct(body.share_pct, "listing");
    if (!shareCheck.valid) {
      return error(shareCheck.message || "Invalid share_pct", 400);
    }

    const newSharePct = shareCheck.value;
    const shareDiff = newSharePct - listing.share_pct;

    // If increasing the share, validate that the leader can afford it
    if (shareDiff > 0) {
      const shareValidation = await validateTeamTotalShares(listing.team_id, shareDiff);
      if (!shareValidation.valid) {
        return error(
          `Cannot increase share: ${shareValidation.issues.join("; ")}`,
          400,
          {
            current_share: listing.share_pct,
            requested_share: newSharePct,
            leader_would_keep: shareValidation.leader_would_keep,
          },
        );
      }
    }

    updates.share_pct = newSharePct;
  }

  // Update role_title
  if (body.role_title !== undefined) {
    const newTitle = sanitizeString(body.role_title, 100);
    if (!newTitle) return error("role_title cannot be empty", 400);
    updates.role_title = newTitle;
  }

  // Update role_description / repo_url
  if (body.role_description !== undefined || body.repo_url !== undefined) {
    // Parse existing description
    let existing: Record<string, unknown> = {};
    const [fullListing] = await db
      .select({ role_description: schema.marketplaceListings.roleDescription })
      .from(schema.marketplaceListings)
      .where(eq(schema.marketplaceListings.id, listingId))
      .limit(1);

    if (fullListing?.role_description) {
      try {
        existing = JSON.parse(fullListing.role_description as string);
      } catch { /* not JSON */ }
    }

    if (body.role_description !== undefined) {
      existing.description = sanitizeString(body.role_description, 1000);
    }
    if (body.repo_url !== undefined) {
      existing.repo_url = sanitizeString(body.repo_url, 512);
    }

    updates.role_description = JSON.stringify(existing);
  }

  if (Object.keys(updates).length === 0) {
    return error("No valid fields to update. Editable: share_pct, role_title, role_description, repo_url", 400);
  }

  const drizzleUpdates: Partial<typeof schema.marketplaceListings.$inferInsert> = {};
  if (typeof updates.share_pct === "number") drizzleUpdates.sharePct = updates.share_pct;
  if (typeof updates.role_title === "string") drizzleUpdates.roleTitle = updates.role_title;
  if (typeof updates.role_description === "string") drizzleUpdates.roleDescription = updates.role_description;

  try {
    await db.update(schema.marketplaceListings).set(drizzleUpdates).where(and(eq(schema.marketplaceListings.id, listingId), eq(schema.marketplaceListings.status, "open")));
  } catch (updateErr) {
    console.error("Marketplace listing edit failed:", updateErr);
    return error("Failed to update listing", 500);
  }

  return success({
    id: listingId,
    updated_fields: Object.keys(updates),
    message: "Listing updated successfully.",
  });
}
