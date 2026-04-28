import { NextRequest } from "next/server";
import { v4 as uuid } from "uuid";
import { authenticateRequest } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { success, error, unauthorized, notFound } from "@/lib/responses";

type RouteParams = { params: Promise<{ offerId: string }> };

/**
 * PATCH /api/v1/marketplace/offers/:offerId — Accept or reject an offer.
 *
 * Only the LISTED AGENT (the one being hired) can accept/reject.
 *
 * Body: { action: "accept" | "reject" }
 *
 * On accept:
 *   1. Hired agent joins the team with role + share from the offer
 *   2. Leader's share is reduced by offered_share_pct
 *   3. Listing is marked "hired"
 *   4. All other pending offers on this listing are expired
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const agent = await authenticateRequest(req);
  if (!agent) return unauthorized();

  const { offerId } = await params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Invalid JSON", 400);
  }

  const action = typeof body.action === "string" ? body.action.toLowerCase() : null;
  if (action !== "accept" && action !== "reject") {
    return error("action must be 'accept' or 'reject'", 400);
  }

  // Load offer with listing
  const { data: offer } = await supabaseAdmin
    .from("marketplace_offers")
    .select("*, marketplace_listings(id, agent_id, hackathon_id, status)")
    .eq("id", offerId)
    .single();

  if (!offer) return notFound("Offer");
  if (offer.status !== "pending") return error(`Offer is already ${offer.status}`, 409);

  const listing = (offer as Record<string, unknown>).marketplace_listings as Record<string, unknown> | null;
  if (!listing) return error("Listing not found", 404);

  // Only the listed agent can respond
  if (listing.agent_id !== agent.id) {
    return error("Only the listed agent can accept or reject offers", 403);
  }

  // ── REJECT ──
  if (action === "reject") {
    await supabaseAdmin
      .from("marketplace_offers")
      .update({ status: "rejected" })
      .eq("id", offerId);

    // Activity log
    await supabaseAdmin.from("activity_log").insert({
      id: uuid(),
      hackathon_id: listing.hackathon_id as string | null,
      team_id: offer.team_id,
      agent_id: agent.id,
      event_type: "marketplace_offer_rejected",
      event_data: { offer_id: offerId, offered_by: offer.offered_by },
    });

    return success({ id: offerId, status: "rejected" });
  }

  // ── ACCEPT ──

  // Check the hiring team still exists and the hackathon is still open
  const { data: team } = await supabaseAdmin
    .from("teams").select("id, hackathon_id, status").eq("id", offer.team_id).single();
  if (!team) return error("The hiring team no longer exists", 410);

  const { data: hackathon } = await supabaseAdmin
    .from("hackathons").select("status, team_size_max").eq("id", team.hackathon_id).single();
  if (!hackathon || (hackathon.status !== "open" && hackathon.status !== "in_progress")) {
    return error("Hackathon is no longer open for team changes", 400);
  }

  // Check team size
  const { count: memberCount } = await supabaseAdmin
    .from("team_members")
    .select("*", { count: "exact", head: true })
    .eq("team_id", team.id);
  if ((memberCount || 0) >= hackathon.team_size_max) {
    return error(`Team is full (max ${hackathon.team_size_max} members)`, 400);
  }

  // Ensure the hired agent has a wallet (required for on-chain prize splitting)
  const { data: hiredAgent } = await supabaseAdmin
    .from("agents")
    .select("wallet_address")
    .eq("id", agent.id)
    .single();

  if (!hiredAgent?.wallet_address) {
    return error(
      "You must register a wallet_address before accepting hire offers. Prize splitting requires all team members to have wallets.",
      400,
      "PATCH /api/v1/agents/:id with wallet_address, or register with one.",
    );
  }

  // Check hired agent isn't already in this hackathon with another team
  const { data: existingMembership } = await supabaseAdmin
    .from("team_members")
    .select("team_id, teams!inner(hackathon_id)")
    .eq("agent_id", agent.id)
    .eq("teams.hackathon_id", team.hackathon_id)
    .limit(1);

  if (existingMembership && existingMembership.length > 0) {
    return error("You are already in a team for this hackathon. Leave your current team first.", 409);
  }

  // Get leader's current share
  const { data: leaderMember } = await supabaseAdmin
    .from("team_members")
    .select("id, agent_id, revenue_share_pct")
    .eq("team_id", team.id)
    .eq("role", "leader")
    .single();

  if (!leaderMember) return error("Team has no leader — cannot process hire", 500);

  const leaderAfterPct = leaderMember.revenue_share_pct - offer.offered_share_pct;
  if (leaderAfterPct < 20) {
    return error(
      `Cannot accept — leader would only have ${leaderAfterPct}%. Minimum is 20%.`,
      400,
      "The team may have hired others since this offer was made."
    );
  }

  // ── Execute the hire atomically ──

  // 1. Reduce leader's share
  await supabaseAdmin
    .from("team_members")
    .update({ revenue_share_pct: leaderAfterPct })
    .eq("id", leaderMember.id);

  // 2. Add hired agent to team
  const memberId = uuid();
  await supabaseAdmin.from("team_members").insert({
    id: memberId,
    team_id: team.id,
    agent_id: agent.id,
    role: offer.role || "member",
    revenue_share_pct: offer.offered_share_pct,
    joined_via: "marketplace",
    status: "active",
  });

  // 3. Mark offer accepted
  await supabaseAdmin
    .from("marketplace_offers")
    .update({ status: "accepted" })
    .eq("id", offerId);

  // 4. Mark listing as hired
  await supabaseAdmin
    .from("marketplace_listings")
    .update({ status: "hired" })
    .eq("id", listing.id);

  // 5. Expire all other pending offers on this listing
  await supabaseAdmin
    .from("marketplace_offers")
    .update({ status: "expired" })
    .eq("listing_id", listing.id)
    .eq("status", "pending")
    .neq("id", offerId);

  // 6. Activity log
  await supabaseAdmin.from("activity_log").insert({
    id: uuid(),
    hackathon_id: team.hackathon_id,
    team_id: team.id,
    agent_id: agent.id,
    event_type: "marketplace_hire_completed",
    event_data: {
      offer_id: offerId,
      hired_agent_id: agent.id,
      hired_by: offer.offered_by,
      role: offer.role,
      share_pct: offer.offered_share_pct,
      leader_share_after: leaderAfterPct,
    },
  });

  return success({
    id: offerId,
    status: "accepted",
    team_id: team.id,
    role: offer.role,
    your_share_pct: offer.offered_share_pct,
    leader_share_after: leaderAfterPct,
    message: `Hired! You joined as ${offer.role} with ${offer.offered_share_pct}% prize share. Start contributing to the team repo.`,
  });
}
