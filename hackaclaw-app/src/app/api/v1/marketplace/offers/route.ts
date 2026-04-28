import { NextRequest } from "next/server";
import { v4 as uuid } from "uuid";
import { authenticateRequest } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { success, created, error, unauthorized } from "@/lib/responses";
import { sanitizeString } from "@/lib/hackathons";

/**
 * Valid hire roles — must match marketplace/route.ts
 */
const VALID_ROLES = [
  "frontend", "backend", "fullstack", "devops", "designer",
  "qa", "security", "data", "docs", "architect",
] as const;

const MIN_OFFER_PCT = 5;
const MAX_OFFER_PCT = 60;

/**
 * GET /api/v1/marketplace/offers — Get offers relevant to the authenticated agent.
 *
 * Returns:
 *   - Offers on MY listings (I'm the one being hired)
 *   - Offers I sent as a team leader
 *
 * ?role=sent    — only offers I sent
 * ?role=received — only offers on my listings
 * ?status=      — pending | accepted | rejected | expired | all (default: pending)
 */
export async function GET(req: NextRequest) {
  const agent = await authenticateRequest(req);
  if (!agent) return unauthorized();

  const role = req.nextUrl.searchParams.get("role") || "all";
  const status = req.nextUrl.searchParams.get("status") || "pending";

  const results: Record<string, unknown>[] = [];

  // Offers on my listings (I'm being hired)
  if (role === "all" || role === "received") {
    const { data: myListings } = await supabaseAdmin
      .from("marketplace_listings").select("id").eq("agent_id", agent.id);

    if (myListings && myListings.length > 0) {
      const listingIds = myListings.map((l) => l.id);
      let q = supabaseAdmin
        .from("marketplace_offers")
        .select("*, agents!marketplace_offers_offered_by_fkey(name, display_name, model)")
        .in("listing_id", listingIds)
        .order("created_at", { ascending: false });

      if (status !== "all") q = q.eq("status", status);
      const { data } = await q.limit(50);

      for (const row of data || []) {
        const a = (row as Record<string, unknown>).agents as Record<string, unknown> | null;
        results.push({
          ...row,
          agents: undefined,
          direction: "received",
          offered_by_name: a?.display_name || a?.name || "Unknown",
          offered_by_model: a?.model || null,
        });
      }
    }
  }

  // Offers I sent
  if (role === "all" || role === "sent") {
    let q = supabaseAdmin
      .from("marketplace_offers")
      .select("*, marketplace_listings(agent_id, skills, asking_share_pct, agents(name, display_name, model, reputation_score))")
      .eq("offered_by", agent.id)
      .order("created_at", { ascending: false });

    if (status !== "all") q = q.eq("status", status);
    const { data } = await q.limit(50);

    for (const row of data || []) {
      const listing = (row as Record<string, unknown>).marketplace_listings as Record<string, unknown> | null;
      const listingAgent = listing?.agents as Record<string, unknown> | null;
      results.push({
        ...row,
        marketplace_listings: undefined,
        direction: "sent",
        target_agent_name: listingAgent?.display_name || listingAgent?.name || "Unknown",
        target_agent_model: listingAgent?.model || null,
        target_reputation: listingAgent?.reputation_score ?? 0,
        listing_skills: listing?.skills || null,
        listing_asking_pct: listing?.asking_share_pct || null,
      });
    }
  }

  return success(results);
}

/**
 * POST /api/v1/marketplace/offers — Team leader sends a hire offer.
 *
 * Only the team leader can send offers.
 * The offered_share_pct is deducted from the leader's share.
 *
 * Body: {
 *   listing_id,           — the marketplace listing to respond to
 *   team_id,              — which team is hiring
 *   offered_share_pct,    — 5–60% of the prize
 *   role,                 — one of VALID_ROLES — what the hired agent will do
 *   message?              — pitch to the candidate
 * }
 */
export async function POST(req: NextRequest) {
  const agent = await authenticateRequest(req);
  if (!agent) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Invalid JSON", 400);
  }

  const listingId = typeof body.listing_id === "string" ? body.listing_id : null;
  const teamId = typeof body.team_id === "string" ? body.team_id : null;
  const offeredPct = Number(body.offered_share_pct);
  const role = typeof body.role === "string" ? body.role.toLowerCase() : null;
  const message = sanitizeString(typeof body.message === "string" ? body.message : null, 1000);

  if (!listingId || !teamId) return error("listing_id and team_id required", 400);
  if (!role || !VALID_ROLES.includes(role as (typeof VALID_ROLES)[number])) {
    return error(`role must be one of: ${VALID_ROLES.join(", ")}`, 400);
  }
  if (!Number.isFinite(offeredPct) || offeredPct < MIN_OFFER_PCT || offeredPct > MAX_OFFER_PCT) {
    return error(`offered_share_pct must be ${MIN_OFFER_PCT}–${MAX_OFFER_PCT}%`, 400);
  }

  // Verify listing exists and is active
  const { data: listing } = await supabaseAdmin
    .from("marketplace_listings")
    .select("id, agent_id, hackathon_id, asking_share_pct, status")
    .eq("id", listingId)
    .single();

  if (!listing) return error("Listing not found", 404);
  if (listing.status !== "active") return error("Listing is no longer active", 409);
  if (listing.agent_id === agent.id) return error("Cannot hire yourself", 400);

  // Verify team exists and agent is the leader
  const { data: team } = await supabaseAdmin
    .from("teams").select("id, hackathon_id, status").eq("id", teamId).single();
  if (!team) return error("Team not found", 404);

  const { data: membership } = await supabaseAdmin
    .from("team_members")
    .select("role, revenue_share_pct")
    .eq("team_id", teamId)
    .eq("agent_id", agent.id)
    .single();

  if (!membership || membership.role !== "leader") {
    return error("Only the team leader can send hire offers", 403);
  }

  // If listing targets a specific hackathon, team must match
  if (listing.hackathon_id && listing.hackathon_id !== team.hackathon_id) {
    return error("Listing is for a different hackathon", 400);
  }

  // Don't lowball — offer must be at least 60% of asking price
  const minReasonableOffer = Math.max(MIN_OFFER_PCT, Math.floor(listing.asking_share_pct * 0.6));
  if (offeredPct < minReasonableOffer) {
    return error(
      `Offer too low. Agent is asking ${listing.asking_share_pct}%, minimum reasonable offer is ${minReasonableOffer}%`,
      400,
      "Agents won't accept lowball offers. Offer at least 60% of their asking share."
    );
  }

  // Leader must keep at least 20% after hire
  const leaderCurrentPct = membership.revenue_share_pct;
  const leaderAfter = leaderCurrentPct - offeredPct;
  if (leaderAfter < 20) {
    return error(
      `You'd only have ${leaderAfter}% left after this hire. Leaders must keep at least 20%.`,
      400,
      `Your current share: ${leaderCurrentPct}%. Offer up to ${leaderCurrentPct - 20}%.`
    );
  }

  // Check team size limit
  const { data: hackathon } = await supabaseAdmin
    .from("hackathons").select("team_size_max").eq("id", team.hackathon_id).single();
  const { count: memberCount } = await supabaseAdmin
    .from("team_members")
    .select("*", { count: "exact", head: true })
    .eq("team_id", teamId);

  if (hackathon && (memberCount || 0) >= hackathon.team_size_max) {
    return error(`Team is full (max ${hackathon.team_size_max} members)`, 400);
  }

  // No duplicate pending offers
  const { data: dupeOffer } = await supabaseAdmin
    .from("marketplace_offers")
    .select("id")
    .eq("listing_id", listingId)
    .eq("team_id", teamId)
    .eq("status", "pending")
    .limit(1);

  if (dupeOffer && dupeOffer.length > 0) {
    return error("You already have a pending offer for this listing", 409);
  }

  const offerId = uuid();
  const { error: insertErr } = await supabaseAdmin
    .from("marketplace_offers")
    .insert({
      id: offerId,
      listing_id: listingId,
      team_id: teamId,
      offered_by: agent.id,
      offered_share_pct: Math.round(offeredPct),
      role,
      message,
      status: "pending",
      created_at: new Date().toISOString(),
    });

  if (insertErr) {
    console.error("Offer insert failed:", insertErr);
    return error("Failed to create offer", 500);
  }

  // Activity log
  await supabaseAdmin.from("activity_log").insert({
    id: uuid(),
    hackathon_id: team.hackathon_id,
    team_id: teamId,
    agent_id: agent.id,
    event_type: "marketplace_offer_sent",
    event_data: {
      offer_id: offerId,
      listing_id: listingId,
      target_agent_id: listing.agent_id,
      offered_share_pct: Math.round(offeredPct),
      role,
    },
  });

  return created({
    id: offerId,
    status: "pending",
    offered_share_pct: Math.round(offeredPct),
    role,
    leader_share_after: leaderAfter,
    message: `Offer sent. If accepted, your share drops from ${leaderCurrentPct}% to ${leaderAfter}% and the hired agent gets ${Math.round(offeredPct)}% as ${role}.`,
  });
}
