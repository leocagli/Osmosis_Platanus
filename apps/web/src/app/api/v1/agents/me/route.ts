import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { authenticateRequest } from "@/lib/auth";
import { success, unauthorized } from "@/lib/responses";
import { getBalance } from "@/lib/balance";
import { getAgentIdentity, getMarketplaceReputationScore } from "@/lib/erc8004";

/**
 * GET /api/v1/agents/me
 * Get authenticated agent's profile + balance + hackathons, teams, and deploy links.
 */
export async function GET(req: NextRequest) {
  const agent = await authenticateRequest(req);
  if (!agent) return unauthorized();

  // Get balance
  const balance = await getBalance(agent.id);

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
  const { data: memberships } = await supabaseAdmin
    .from("team_members")
    .select("team_id, role, revenue_share_pct, teams(id, name, hackathon_id, status, color)")
    .eq("agent_id", agent.id);

  // For each team, get hackathon info and submission
  const hackathons = await Promise.all(
    (memberships || []).map(async (m) => {
      const team = (m as Record<string, unknown>).teams as Record<string, unknown> | null;
      if (!team) return null;

      const { data: hackathon } = await supabaseAdmin
        .from("hackathons")
        .select("id, title, status, entry_type, entry_fee, prize_pool, max_participants, challenge_type, build_time_seconds, github_repo")
        .eq("id", team.hackathon_id)
        .single();

      if (!hackathon) return null;

      // Get submission + score
      const { data: sub } = await supabaseAdmin
        .from("submissions")
        .select("id, status, project_type, file_count, languages")
        .eq("team_id", team.id)
        .eq("hackathon_id", hackathon.id)
        .single();

      let score = null;
      if (sub) {
        const { data: evalData } = await supabaseAdmin
          .from("evaluations")
          .select("total_score, judge_feedback")
          .eq("submission_id", sub.id)
          .single();
        score = evalData;
      }

      // Get latest prompt round for iteration visibility.
      const { data: latestRound } = await supabaseAdmin
        .from("prompt_rounds")
        .select("round_number, llm_provider, llm_model, commit_sha, created_at")
        .eq("team_id", team.id)
        .eq("hackathon_id", hackathon.id)
        .order("round_number", { ascending: false })
        .limit(1)
        .single();

      // Count current participants
      const { data: participants } = await supabaseAdmin
        .from("team_members")
        .select("agent_id, teams!inner(hackathon_id)")
        .eq("teams.hackathon_id", hackathon.id);
      const participantCount = new Set((participants || []).map((p: Record<string, unknown>) => p.agent_id)).size;

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
