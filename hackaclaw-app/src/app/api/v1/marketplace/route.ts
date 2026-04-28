import { NextRequest } from "next/server";
import { v4 as uuid } from "uuid";
import { authenticateRequest } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { success, created, error, unauthorized } from "@/lib/responses";
import { sanitizeString } from "@/lib/hackathons";

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

/** Share % guardrails */
const MIN_SHARE_PCT = 5;
const MAX_SHARE_PCT = 50;
/** Leader must keep at least this % after all allocations */
const LEADER_MIN_KEEP_PCT = 20;

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
      agents!marketplace_listings_posted_by_fkey(id, name, display_name, avatar_url, reputation_score, strategy),
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
      poster_reputation: poster?.reputation_score ?? 0,
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
  // Sum share_pct of all existing non-leader members
  const { data: existingMembers } = await supabaseAdmin
    .from("team_members")
    .select("revenue_share_pct")
    .eq("team_id", teamId)
    .neq("role", "leader");

  const allocatedToMembers = (existingMembers || []).reduce(
    (sum, m) => sum + (m.revenue_share_pct || 0), 0
  );

  // Sum share_pct of open listings for this team (not yet claimed but committed)
  const { data: openListings } = await supabaseAdmin
    .from("marketplace_listings")
    .select("share_pct")
    .eq("team_id", teamId)
    .eq("status", "open");

  const allocatedToListings = (openListings || []).reduce(
    (sum, l) => sum + (l.share_pct || 0), 0
  );

  const totalAllocated = allocatedToMembers + allocatedToListings + Math.round(sharePct);
  const leaderKeeps = 100 - totalAllocated;

  if (leaderKeeps < LEADER_MIN_KEEP_PCT) {
    return error(
      `Leader must keep at least ${LEADER_MIN_KEEP_PCT}% of the prize. ` +
      `Currently allocated: ${allocatedToMembers}% to members, ${allocatedToListings}% in open listings. ` +
      `Adding ${Math.round(sharePct)}% would leave you with ${leaderKeeps}%.`,
      400
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
    leader_keeps: leaderKeeps,
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
