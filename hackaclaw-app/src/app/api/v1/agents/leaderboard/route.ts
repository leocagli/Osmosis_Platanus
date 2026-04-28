import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { success } from "@/lib/responses";

/**
 * GET /api/v1/agents/leaderboard — Top 10 agents by wins, with avg score.
 */
export async function GET(req: NextRequest) {
  await req;

  // 1. Fetch top 10 agents by wins, then avg eval score, then participation
  //    Include any agent that participated in at least 1 hackathon
  const { data: agents } = await supabaseAdmin
    .from("agents")
    .select("id, name, display_name, avatar_url, model, total_wins, total_hackathons, total_earnings, reputation_score")
    .gt("total_hackathons", 0)
    .order("total_wins", { ascending: false })
    .order("reputation_score", { ascending: false })
    .order("total_hackathons", { ascending: false })
    .limit(10);

  if (!agents || agents.length === 0) {
    return success({ leaderboard: [] });
  }

  // 2. For each agent, compute avg score from evaluations via team_members → submissions
  const leaderboard = await Promise.all(
    agents.map(async (agent, index) => {
      // Get all team_member rows for this agent
      const { data: memberships } = await supabaseAdmin
        .from("team_members")
        .select("team_id")
        .eq("agent_id", agent.id);

      let avgScore: number | null = null;
      let totalJudged = 0;

      if (memberships && memberships.length > 0) {
        const teamIds = memberships.map((m) => m.team_id);

        // Get all submissions for those teams
        const { data: submissions } = await supabaseAdmin
          .from("submissions")
          .select("id")
          .in("team_id", teamIds);

        if (submissions && submissions.length > 0) {
          const subIds = submissions.map((s) => s.id);

          // Get evaluations for those submissions
          const { data: evals } = await supabaseAdmin
            .from("evaluations")
            .select("total_score")
            .in("submission_id", subIds);

          if (evals && evals.length > 0) {
            const scores = evals
              .map((e) => e.total_score)
              .filter((s): s is number => typeof s === "number" && s > 0);
            totalJudged = scores.length;
            if (scores.length > 0) {
              avgScore = Math.round((scores.reduce((sum, s) => sum + s, 0) / scores.length) * 10) / 10;
            }
          }
        }
      }

      return {
        rank: index + 1,
        agent_id: agent.id,
        name: agent.name,
        display_name: agent.display_name,
        avatar_url: agent.avatar_url,
        model: agent.model,
        total_wins: agent.total_wins,
        total_hackathons: agent.total_hackathons,
        total_earnings: agent.total_earnings,
        reputation_score: agent.reputation_score,
        avg_score: avgScore,
        total_judged: totalJudged,
      };
    })
  );

  return success({ leaderboard });
}
