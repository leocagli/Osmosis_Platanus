import { NextRequest } from "next/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { authenticateRequest } from "@buildersclaw/shared/auth";
import { success, unauthorized } from "@buildersclaw/shared/responses";
import { getBalance } from "@buildersclaw/shared/balance";
import { getDb, schema } from "@buildersclaw/shared/db";
import { getAgentIdentity, getMarketplaceReputationScore } from "@buildersclaw/shared/erc8004";

/**
 * GET /api/v1/agents/me
 * Get authenticated agent's profile + balance + hackathons, teams, and deploy links.
 */
export async function GET(req: NextRequest) {
  const agent = await authenticateRequest(req);
  if (!agent) return unauthorized();

  // Get balance
  const balance = await getBalance(agent.id);
  const db = getDb();

  // Parse github_username + telegram_username from strategy JSON
  let githubUsername: string | null = null;
  let telegramUsername: string | null = null;
  if (agent.strategy) {
    try {
      const parsed = JSON.parse(agent.strategy);
      if (typeof parsed === "object" && parsed !== null) {
        if (typeof parsed.github_username === "string") githubUsername = parsed.github_username;
        if (typeof parsed.telegram_username === "string") telegramUsername = parsed.telegram_username;
      }
    } catch { /* not JSON, legacy stack string */ }
  }

  // Prerequisites check
  const missingPrereqs: string[] = [];
  if (!agent.wallet_address) missingPrereqs.push("wallet_address");
  if (!githubUsername) missingPrereqs.push("github_username");

  // Get all teams this agent is in
  const memberships = await db
    .select({
      role: schema.teamMembers.role,
      revenue_share_pct: schema.teamMembers.revenueSharePct,
      team: {
        id: schema.teams.id,
        name: schema.teams.name,
        hackathon_id: schema.teams.hackathonId,
        status: schema.teams.status,
        color: schema.teams.color,
      },
    })
    .from(schema.teamMembers)
    .innerJoin(schema.teams, eq(schema.teamMembers.teamId, schema.teams.id))
    .where(eq(schema.teamMembers.agentId, agent.id));

  // For each team, get hackathon info and submission
  const hackathons = await Promise.all(
    memberships.map(async (m) => {
      const team = m.team;

      const [hackathon] = await db
        .select({
          id: schema.hackathons.id,
          title: schema.hackathons.title,
          status: schema.hackathons.status,
          entry_type: schema.hackathons.entryType,
          entry_fee: schema.hackathons.entryFee,
          prize_pool: schema.hackathons.prizePool,
          max_participants: schema.hackathons.maxParticipants,
          challenge_type: schema.hackathons.challengeType,
          build_time_seconds: schema.hackathons.buildTimeSeconds,
          github_repo: schema.hackathons.githubRepo,
        })
        .from(schema.hackathons)
        .where(eq(schema.hackathons.id, team.hackathon_id))
        .limit(1);

      if (!hackathon) return null;

      // Get submission + score
      const [sub] = await db
        .select({
          id: schema.submissions.id,
          status: schema.submissions.status,
          project_type: schema.submissions.projectType,
          file_count: schema.submissions.fileCount,
          languages: schema.submissions.languages,
        })
        .from(schema.submissions)
        .where(and(eq(schema.submissions.teamId, team.id), eq(schema.submissions.hackathonId, hackathon.id)))
        .limit(1);

      let score = null;
      if (sub) {
        const [evalData] = await db
          .select({
            total_score: schema.evaluations.totalScore,
            judge_feedback: schema.evaluations.judgeFeedback,
          })
          .from(schema.evaluations)
          .where(eq(schema.evaluations.submissionId, sub.id))
          .limit(1);
        score = evalData;
      }

      // Get latest prompt round for iteration visibility.
      const [latestRound] = await db
        .select({
          round_number: schema.promptRounds.roundNumber,
          llm_provider: schema.promptRounds.llmProvider,
          llm_model: schema.promptRounds.llmModel,
          commit_sha: schema.promptRounds.commitSha,
          created_at: schema.promptRounds.createdAt,
        })
        .from(schema.promptRounds)
        .where(and(eq(schema.promptRounds.teamId, team.id), eq(schema.promptRounds.hackathonId, hackathon.id)))
        .orderBy(desc(schema.promptRounds.roundNumber))
        .limit(1);

      // Count current participants
      const [participants] = await db
        .select({ count: sql<number>`count(distinct ${schema.teamMembers.agentId})` })
        .from(schema.teamMembers)
        .innerJoin(schema.teams, eq(schema.teamMembers.teamId, schema.teams.id))
        .where(eq(schema.teams.hackathonId, hackathon.id));
      const participantCount = Number(participants?.count || 0);

      return {
        hackathon_id: hackathon.id,
        hackathon_title: hackathon.title,
        hackathon_status: hackathon.status,
        challenge_type: hackathon.challenge_type,
        entry_fee: hackathon.entry_fee,
        prize_pool: hackathon.prize_pool,
        current_participants: participantCount,
        max_participants: hackathon.max_participants,
        team_id: team.id,
        team_name: team.name,
        team_status: team.status,
        my_role: m.role,
        my_revenue_share: m.revenue_share_pct,
        // Prompt rounds generate files only; teams must manage their own repos.
        github_repo: null,
        github_folder: null,
        current_round: latestRound?.round_number || 0,
        submission: sub ? {
          id: sub.id,
          status: sub.status,
          project_type: sub.project_type,
          file_count: sub.file_count,
          languages: sub.languages,
          preview_url: `/api/v1/submissions/${sub.id}/preview`,
          score: score?.total_score ?? null,
          feedback: score?.judge_feedback ?? null,
        } : null,
      };
    })
  );

  return success({
    agent: {
      id: agent.id,
      name: agent.name,
      display_name: agent.display_name,
      wallet_address: agent.wallet_address || null,
      github_username: githubUsername,
      telegram_username: telegramUsername,
      reputation_score: agent.reputation_score,
      marketplace_reputation_score: getMarketplaceReputationScore(agent),
      identity: getAgentIdentity(agent),
      total_hackathons: agent.total_hackathons,
      total_wins: agent.total_wins,
    },
    prerequisites: missingPrereqs.length > 0
      ? {
        ready: false,
        missing: missingPrereqs,
        message: `Missing: ${missingPrereqs.join(", ")}. Update with PATCH /api/v1/agents/register.`,
        ...(missingPrereqs.includes("wallet_address") ? {
          wallet_setup: "Install Foundry (curl -L https://foundry.paradigm.xyz | bash && foundryup), then: cast wallet new. Register: PATCH /api/v1/agents/register with {\"wallet_address\":\"0x...\"}. Full guide: GET /api/v1/chain/setup",
        } : {}),
        ...(missingPrereqs.includes("github_username") ? {
          github_setup: "You need a GitHub account + Personal Access Token (repo scope) to create repos and submit solutions. Generate at https://github.com/settings/tokens. Store the token LOCALLY (export GITHUB_TOKEN=ghp_...) — never send it to BuildersClaw. Register ONLY your username: PATCH /api/v1/agents/register with {\"github_username\":\"your-username\"}",
        } : {}),
      }
      : { ready: true },
    communication: {
      telegram_configured: Boolean(telegramUsername),
      telegram_username: telegramUsername,
      recommendation: telegramUsername
        ? "Telegram notifications are enabled for this agent."
        : "Telegram is optional for joining hackathons, but recommended if you want real-time team notifications alongside the chat API and webhooks.",
    },
    balance: {
      balance_usd: balance.balance_usd,
      total_deposited_usd: balance.total_deposited_usd,
      total_spent_usd: balance.total_spent_usd,
      total_fees_usd: balance.total_fees_usd,
    },
    hackathons: hackathons.filter(Boolean),
  });
}
