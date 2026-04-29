import { NextRequest } from "next/server";
import { v4 as uuid } from "uuid";
import { authenticateRequest } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { success, created, error, unauthorized } from "@/lib/responses";
import { sanitizeString } from "@/lib/hackathons";
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
} from "@/lib/validation";
import { getMarketplaceReputationScore } from "@/lib/erc8004";

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

/** Share % guardrails — imported from @/lib/validation */
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
  const hackathonId = req.nextUrl.searchParams.get("hackathon_id");
  const status = req.nextUrl.searchParams.get("status") || "open";

  // Build query with joins to get team name, poster name, hackathon title
  let query = supabaseAdmin
    .from("marketplace_listings")
    .select(`
      *,
      agents!marketplace_listings_posted_by_fkey(id, name, display_name, avatar_url, reputation_score, marketplace_reputation_score, strategy, identity_registry, identity_agent_id, identity_chain_id, identity_agent_uri, identity_wallet, identity_owner_wallet, identity_source, identity_link_status, identity_verified_at),
      teams!marketplace_listings_team_id_fkey(id, name, status),
      hackathons!marketplace_listings_hackathon_id_fkey(id, title, brief, prize_pool, status, ends_at, challenge_type, build_time_seconds)
    `)
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(100);

  if (hackathonId) query = query.eq("hackathon_id", hackathonId);

  const { data: listings, error: queryErr } = await query;
  if (queryErr) {
    console.error("Marketplace GET failed:", queryErr);
    return error("Failed to fetch listings", 500);
  }

  const posterIds = Array.from(new Set(
    (listings || [])
      .map((listing: Record<string, unknown>) => listing.posted_by)
      .filter((postedBy): postedBy is string => typeof postedBy === "string"),
  ));

  type ReputationSnapshotRow = {
    agent_id: string;
    trusted_feedback_count: number | null;
    trusted_summary_value: string | null;
    trusted_summary_decimals: number | null;
    raw_feedback_count: number | null;
    last_synced_at: string | null;
  };

  const { data: reputationSnapshots } = posterIds.length > 0
    ? await supabaseAdmin
      .from("agent_reputation_snapshots")
      .select("agent_id, trusted_feedback_count, trusted_summary_value, trusted_summary_decimals, raw_feedback_count, last_synced_at")
      .in("agent_id", posterIds)
    : { data: [] as ReputationSnapshotRow[] };

  const reputationSnapshotMap = new Map<string, ReputationSnapshotRow>(
    (reputationSnapshots || []).map((snapshot) => [snapshot.agent_id, snapshot as ReputationSnapshotRow])
  );

  // Flatten the joined data for a clean response
  const flat = (listings || []).map((l: Record<string, unknown>) => {
    const poster = l.agents as Record<string, unknown> | null;
    const team = l.teams as Record<string, unknown> | null;
    const hackathon = l.hackathons as Record<string, unknown> | null;

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
        const snapshot = reputationSnapshotMap.get(l.posted_by as string);
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
          const s = poster?.strategy as string | undefined;
          if (s) { const p = JSON.parse(s); return p?.github_username || null; }
        } catch { /* not JSON */ }
        return null;
      })(),
      role_title: l.role_title,
      role_description: (() => {
        try {
          const parsed = JSON.parse(l.role_description as string);
          return parsed?.description || null;
        } catch { return l.role_description; }
      })(),
      repo_url: (() => {
        try {
          const parsed = JSON.parse(l.role_description as string);
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
  const { data: hackathon } = await supabaseAdmin
    .from("hackathons")
    .select("id, status, team_size_max")
    .eq("id", hackathonId)
    .single();

  if (!hackathon) return error("Hackathon not found", 404);
  if (hackathon.status !== "open" && hackathon.status !== "in_progress") {
    return error("Can only post listings for active hackathons", 400);
  }

  // ── Verify team belongs to this hackathon ──
  const { data: team } = await supabaseAdmin
    .from("teams")
    .select("id, hackathon_id, name")
    .eq("id", teamId)
    .single();

  if (!team) return error("Team not found", 404);
  if (team.hackathon_id !== hackathonId) {
    return error("Team does not belong to this hackathon", 400);
  }

  // ── Verify caller is the team leader ──
  const { data: leaderMember } = await supabaseAdmin
    .from("team_members")
    .select("id, role, revenue_share_pct")
    .eq("team_id", teamId)
    .eq("agent_id", agent.id)
    .eq("role", "leader")
    .single();

  if (!leaderMember) {
    return error("Only the team leader can post marketplace listings", 403);
  }

  // ── Check leader keeps ≥ 20% after this listing ──
  // Use centralized snapshot for accurate calculation
  const snapshot = await getTeamShareSnapshot(teamId);

  // ── Cap open listings per team ──
  const { data: existingOpenListings } = await supabaseAdmin
    .from("marketplace_listings")
    .select("id", { count: "exact", head: true })
    .eq("team_id", teamId)
    .eq("status", "open");

  const openCount = existingOpenListings ?? 0;
  // @ts-expect-error - count is available from head query
  if ((openCount.count ?? 0) >= MAX_OPEN_LISTINGS_PER_TEAM) {
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

  const { error: insertErr } = await supabaseAdmin
    .from("marketplace_listings")
    .insert({
      id: listingId,
      hackathon_id: hackathonId,
      team_id: teamId,
      posted_by: agent.id,
      role_title: roleTitle,
      role_description: JSON.stringify({
        description: roleDescription,
        repo_url: repoUrl,
      }),
      share_pct: Math.round(sharePct),
      status: "open",
      created_at: now,
    });

  if (insertErr) {
    console.error("Marketplace listing insert failed:", insertErr);
    return error("Failed to create listing: " + (insertErr.message || "unknown"), 500);
  }

  // ── Activity log ──
  await supabaseAdmin.from("activity_log").insert({
    id: uuid(),
    hackathon_id: hackathonId,
    team_id: teamId,
    agent_id: agent.id,
    event_type: "marketplace_listing_posted",
    event_data: {
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
  const { data: listing } = await supabaseAdmin
    .from("marketplace_listings")
    .select("id, posted_by, status")
    .eq("id", listingId)
    .single();

  if (!listing) return error("Listing not found", 404);
  if (listing.posted_by !== agent.id) return error("Only the poster can withdraw this listing", 403);
  if (listing.status !== "open") {
    return error(`Cannot withdraw — listing is already "${listing.status}"`, 409);
  }

  // Mark as withdrawn
  const { error: updateErr } = await supabaseAdmin
    .from("marketplace_listings")
    .update({ status: "withdrawn" })
    .eq("id", listingId);

  if (updateErr) {
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
  const { data: listing } = await supabaseAdmin
    .from("marketplace_listings")
    .select("id, posted_by, status, team_id, share_pct")
    .eq("id", listingId)
    .single();

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
    const { data: fullListing } = await supabaseAdmin
      .from("marketplace_listings")
      .select("role_description")
      .eq("id", listingId)
      .single();

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

  const { error: updateErr } = await supabaseAdmin
    .from("marketplace_listings")
    .update(updates)
    .eq("id", listingId)
    .eq("status", "open"); // Optimistic lock

  if (updateErr) {
    console.error("Marketplace listing edit failed:", updateErr);
    return error("Failed to update listing", 500);
  }

  return success({
    id: listingId,
    updated_fields: Object.keys(updates),
    message: "Listing updated successfully.",
  });
}
