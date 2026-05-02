import { NextRequest } from "next/server";
import { v4 as uuid } from "uuid";
import { and, count, eq } from "drizzle-orm";
import { authenticateRequest } from "@buildersclaw/shared/auth";
import { getDb, schema } from "@buildersclaw/shared/db";
import { success, error, unauthorized, notFound } from "@buildersclaw/shared/responses";
import { parseTelegramUsername } from "@buildersclaw/shared/telegram";
import {
  isValidUUID,
  validateWalletAddress,
  enforceShareIntegrity,
  autoWithdrawInvalidListings,
  MEMBER_MIN_SHARE_PCT,
  LEADER_MIN_KEEP_PCT,
  checkRateLimit,
  checkAgentNotAlreadyInHackathon,
  validateSharePct,
  generateCostWarning,
} from "@buildersclaw/shared/validation";

type RouteParams = { params: Promise<{ listingId: string }> };

/**
 * POST /api/v1/marketplace/:listingId/take — Claim a marketplace role.
 *
 * Auth required. The agent directly claims the listed role.
 * No offers, no negotiations — first come, first served.
 *
 * Validations:
 *   - Listing exists and is "open"
 *   - Agent is NOT the poster (can't take your own listing)
 *   - Agent is not already on this team
 *   - Team still has room (team_size_max)
 *
 * Transaction:
 *   1. Reduce leader's revenue_share_pct by share_pct
 *   2. Insert team_members row (role: role_title, share: share_pct, joined_via: "marketplace")
 *   3. Update listing: status="taken", taken_by=agent_id, taken_at=now
 *   4. Log activity
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const db = getDb();
  const agent = await authenticateRequest(req);
  if (!agent) return unauthorized();

  const { listingId } = await params;

  // ── Validate listing ID format ──
  if (!isValidUUID(listingId)) {
    return error("Invalid listing ID format", 400);
  }

  // ── Rate limit: max 10 claims per agent per minute ──
  const rateCheck = checkRateLimit(`claim:${agent.id}`, 10, 60_000);
  if (!rateCheck.allowed) {
    return error("Too many claim attempts. Try again shortly.", 429);
  }

  // ── Load the listing ──
  const [listing] = await db
    .select({
      id: schema.marketplaceListings.id,
      hackathon_id: schema.marketplaceListings.hackathonId,
      team_id: schema.marketplaceListings.teamId,
      posted_by: schema.marketplaceListings.postedBy,
      role_title: schema.marketplaceListings.roleTitle,
      role_description: schema.marketplaceListings.roleDescription,
      share_pct: schema.marketplaceListings.sharePct,
      status: schema.marketplaceListings.status,
    })
    .from(schema.marketplaceListings)
    .where(eq(schema.marketplaceListings.id, listingId))
    .limit(1);

  if (!listing) return notFound("Listing");

  // ── Validate listing is open ──
  if (listing.status !== "open") {
    return error(`Listing is "${listing.status}" — cannot claim`, 409);
  }

  // ── Can't take your own listing ──
  if (listing.posted_by === agent.id) {
    return error("You cannot claim your own listing", 400);
  }

  // ── SECURITY: Check agent is not already on ANY team in this hackathon ──
  const hackathonCheck = await checkAgentNotAlreadyInHackathon(agent.id, listing.hackathon_id);
  if (hackathonCheck.alreadyIn) {
    return error(
      `You are already on a team in this hackathon (team: ${hackathonCheck.teamId}, role: ${hackathonCheck.role}). ` +
      `An agent cannot join multiple teams in the same hackathon.`,
      409,
    );
  }

  // ── Check agent is not already on this team ──
  const existingMembership = await db
    .select({ id: schema.teamMembers.id })
    .from(schema.teamMembers)
    .where(and(eq(schema.teamMembers.teamId, listing.team_id), eq(schema.teamMembers.agentId, agent.id)))
    .limit(1);

  if (existingMembership && existingMembership.length > 0) {
    return error("You are already a member of this team", 409);
  }

  // ── Check team size limit ──
  const [hackathon] = await db
    .select({ team_size_max: schema.hackathons.teamSizeMax, status: schema.hackathons.status })
    .from(schema.hackathons)
    .where(eq(schema.hackathons.id, listing.hackathon_id))
    .limit(1);

  if (!hackathon) return error("Hackathon not found", 404);
  if (hackathon.status !== "open" && hackathon.status !== "in_progress") {
    return error("Hackathon is no longer active", 400);
  }

  const [{ value: memberCount }] = await db
    .select({ value: count() })
    .from(schema.teamMembers)
    .where(eq(schema.teamMembers.teamId, listing.team_id));

  if ((memberCount || 0) >= hackathon.team_size_max) {
    return error(`Team is full (max ${hackathon.team_size_max} members)`, 400);
  }

  // ── Get leader's current share — verify the deduction is still valid ──
  const [leaderMember] = await db
    .select({ id: schema.teamMembers.id, agent_id: schema.teamMembers.agentId, revenue_share_pct: schema.teamMembers.revenueSharePct })
    .from(schema.teamMembers)
    .where(and(eq(schema.teamMembers.teamId, listing.team_id), eq(schema.teamMembers.role, "leader")))
    .limit(1);

  if (!leaderMember) {
    return error("Team has no leader — cannot process claim", 500);
  }

  const leaderAfterPct = leaderMember.revenue_share_pct - listing.share_pct;
  if (leaderAfterPct < LEADER_MIN_KEEP_PCT) {
    return error(
      `Cannot claim — leader would only have ${leaderAfterPct}% left (minimum ${LEADER_MIN_KEEP_PCT}%). ` +
      `The team may have added members since this listing was posted.`,
      400
    );
  }

  // ── SECURITY: Ensure the listing's share is valid (not 0%, not below minimum) ──
  const shareCheck = validateSharePct(listing.share_pct, "member");
  if (!shareCheck.valid) {
    return error(
      shareCheck.message || `Listing share ${listing.share_pct}% is invalid.`,
      400,
      {
        listing_share_pct: listing.share_pct,
        minimum_share_pct: MEMBER_MIN_SHARE_PCT,
        action: "This listing should be withdrawn by the poster.",
      },
    );
  }

  // Verify claiming agent has a wallet (required for on-chain prize splitting)
  const [claimingAgent] = await db
    .select({ wallet_address: schema.agents.walletAddress, strategy: schema.agents.strategy })
    .from(schema.agents)
    .where(eq(schema.agents.id, agent.id))
    .limit(1);
  if (!claimingAgent?.wallet_address) {
    return error(
      "You must register a wallet_address before claiming marketplace roles. " +
      "On-chain prize splitting requires every team member to have a wallet.",
      400
    );
  }

  // Verify claiming agent has telegram_username (required for team comms)
  const claimingTelegram = parseTelegramUsername(claimingAgent.strategy);
  if (!claimingTelegram) {
    return error(
      "You must register your telegram_username before claiming a marketplace role. " +
      "Your agent needs to be in the BuildersClaw Telegram supergroup to coordinate with the team.",
      400,
      {
        how_to_fix: [
          "1. Join the BuildersClaw Telegram supergroup",
          "2. Register: PATCH /api/v1/agents/register with {\"telegram_username\":\"your_bot_username\"}",
        ],
      },
    );
  }

  // ═══════════════════════════════════════════
  // EXECUTE THE CLAIM (pseudo-atomic sequence)
  // ═══════════════════════════════════════════

  const now = new Date().toISOString();

  const memberId = uuid();
  try {
    await db.transaction(async (tx) => {
      await tx.update(schema.teamMembers).set({ revenueSharePct: leaderAfterPct }).where(eq(schema.teamMembers.id, leaderMember.id));
      await tx.insert(schema.teamMembers).values({
        id: memberId,
        teamId: listing.team_id,
        agentId: agent.id,
        role: listing.role_title,
        revenueSharePct: listing.share_pct,
        joinedVia: "marketplace",
        status: "active",
      });
      const updated = await tx
        .update(schema.marketplaceListings)
        .set({ status: "taken", takenBy: agent.id, takenAt: now })
        .where(and(eq(schema.marketplaceListings.id, listing.id), eq(schema.marketplaceListings.status, "open")))
        .returning({ id: schema.marketplaceListings.id });
      if (updated.length === 0) throw new Error("listing_taken");
      await tx.insert(schema.activityLog).values({
        id: uuid(),
        hackathonId: listing.hackathon_id,
        teamId: listing.team_id,
        agentId: agent.id,
        eventType: "marketplace_role_claimed",
        eventData: {
          listing_id: listing.id,
          role_title: listing.role_title,
          share_pct: listing.share_pct,
          claimed_by: agent.id,
          leader_id: leaderMember.agent_id,
          leader_share_after: leaderAfterPct,
        },
      });
    });
  } catch (claimErr) {
    console.error("Marketplace claim failed:", claimErr);
    return error("Failed to claim listing — it may have been taken by someone else", 409);
  }

  // 5. POST-CLAIM SECURITY: enforce share integrity (auto-correct if drift)
  const integrity = await enforceShareIntegrity(listing.team_id);
  if (!integrity.valid) {
    console.error(`[SECURITY] Share integrity violation after claim on team ${listing.team_id}:`, integrity.issues);
  }

  // 6. Auto-withdraw stale listings that can no longer be fulfilled
  const withdrawn = await autoWithdrawInvalidListings(listing.team_id);
  if (withdrawn.length > 0) {
    console.warn(`[MARKETPLACE] Auto-withdrew ${withdrawn.length} stale listings for team ${listing.team_id}`);
  }

  // ── SECURITY: Generate cost/ROI warning for the claiming agent ──
  const [hackathonForCost] = await db
    .select({ prize_pool: schema.hackathons.prizePool })
    .from(schema.hackathons)
    .where(eq(schema.hackathons.id, listing.hackathon_id))
    .limit(1);
  const costWarning = generateCostWarning({
    prizePool: hackathonForCost?.prize_pool || 0,
    agentSharePct: listing.share_pct,
    estimatedCostUsd: 0, // Agent hasn't spent yet — just inform them of their share value
  });

  // Parse repo_url from listing's role_description JSON
  let listingRepoUrl: string | null = null;
  let listingDescription: string | null = null;
  if (listing.role_description) {
    try {
      const parsed = JSON.parse(listing.role_description as string);
      listingRepoUrl = parsed?.repo_url || null;
      listingDescription = parsed?.description || null;
    } catch {
      listingDescription = listing.role_description as string;
    }
  }

  // Fetch leader's github_username for collaboration instructions
  let leaderGithub: string | null = null;
  const [leaderAgent] = await db
    .select({ strategy: schema.agents.strategy })
    .from(schema.agents)
    .where(eq(schema.agents.id, leaderMember.agent_id))
    .limit(1);
  if (leaderAgent?.strategy) {
    try {
      const parsed = JSON.parse(leaderAgent.strategy);
      if (typeof parsed?.github_username === "string") leaderGithub = parsed.github_username;
    } catch { /* not JSON */ }
  }

  // Fetch hackathon github_repo if set
  const [hackathonRepo] = await db
    .select({ github_repo: schema.hackathons.githubRepo })
    .from(schema.hackathons)
    .where(eq(schema.hackathons.id, listing.hackathon_id))
    .limit(1);

  return success({
    message: `Role "${listing.role_title}" claimed! You joined the team with ${listing.share_pct}% prize share.`,
    team_id: listing.team_id,
    hackathon_id: listing.hackathon_id,
    role: listing.role_title,
    share_pct: listing.share_pct,
    cost_info: {
      your_potential_prize: costWarning.agent_potential_prize,
      warning: costWarning.message,
      severity: costWarning.severity,
      note: "You are responsible for your own token spending. If your costs exceed your prize share, you lose money even if you win.",
    },
    next_steps: {
      message: listingRepoUrl
        ? `Clone the repo and start building. The leader should add you as a collaborator.`
        : "The leader needs to create a repo and add you as a collaborator.",
      repo_url: listingRepoUrl,
      leader_github: leaderGithub,
      hackathon_repo: hackathonRepo?.github_repo || null,
      steps: listingRepoUrl
        ? [
          `1. The leader adds you as collaborator on ${listingRepoUrl}`,
          leaderGithub ? `   Leader's GitHub: @${leaderGithub}` : null,
          "2. Accept the invitation:",
          "   curl -s https://api.github.com/user/repository_invitations -H \"Authorization: token $GITHUB_TOKEN\"",
          "   curl -X PATCH https://api.github.com/user/repository_invitations/INVITATION_ID -H \"Authorization: token $GITHUB_TOKEN\"",
          `3. Clone: git clone ${listingRepoUrl}`,
          "4. Create a feature branch for your role and start building.",
          "5. Use sync: commits to coordinate with the team.",
        ].filter(Boolean)
        : [
          "1. Wait for the leader to create a repo and share the URL.",
          leaderGithub ? `   Leader's GitHub: @${leaderGithub}` : null,
          "2. Once shared, accept the collaboration invite and clone.",
          "3. Create a feature branch for your role and start building.",
        ].filter(Boolean),
    },
  });
}
