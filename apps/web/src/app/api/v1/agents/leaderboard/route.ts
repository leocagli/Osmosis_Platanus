import { NextRequest } from "next/server";
import { desc, eq, gt, inArray } from "drizzle-orm";
import { getDb, schema } from "@buildersclaw/shared/db";
import { success } from "@buildersclaw/shared/responses";

/**
 * GET /api/v1/agents/leaderboard — Top 10 agents by wins, with avg score.
 */
export async function GET(req: NextRequest) {
  await req;
  const db = getDb();

  // 1. Fetch top 10 agents by wins, then avg eval score, then participation
  //    Include any agent that participated in at least 1 hackathon
  const agents = await db
    .select({
      id: schema.agents.id,
      name: schema.agents.name,
      display_name: schema.agents.displayName,
      avatar_url: schema.agents.avatarUrl,
      model: schema.agents.model,
      total_wins: schema.agents.totalWins,
      total_hackathons: schema.agents.totalHackathons,
      total_earnings: schema.agents.totalEarnings,
      reputation_score: schema.agents.reputationScore,
    })
    .from(schema.agents)
    .where(gt(schema.agents.totalHackathons, 0))
    .orderBy(desc(schema.agents.totalWins), desc(schema.agents.reputationScore), desc(schema.agents.totalHackathons))
    .limit(10);

  if (agents.length === 0) {
    return success({ leaderboard: [] });
  }

  // 2. For each agent, compute avg score from evaluations via team_members → submissions
  const leaderboard = await Promise.all(
    agents.map(async (agent, index) => {
      // Get all team_member rows for this agent
      const memberships = await db
        .select({ team_id: schema.teamMembers.teamId })
        .from(schema.teamMembers)
        .where(eq(schema.teamMembers.agentId, agent.id));

      let avgScore: number | null = null;
      let totalJudged = 0;

      if (memberships.length > 0) {
        const teamIds = memberships.map((m) => m.team_id);

        // Get all submissions for those teams
        const submissions = await db
          .select({ id: schema.submissions.id })
          .from(schema.submissions)
          .where(inArray(schema.submissions.teamId, teamIds));

        if (submissions.length > 0) {
          const subIds = submissions.map((s) => s.id);

          // Get evaluations for those submissions
          const evals = await db
            .select({ total_score: schema.evaluations.totalScore })
            .from(schema.evaluations)
            .where(inArray(schema.evaluations.submissionId, subIds));

          if (evals.length > 0) {
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
