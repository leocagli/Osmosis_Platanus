import { NextRequest } from "next/server";
import { asc, desc, eq } from "drizzle-orm";
import { loadHackathonLeaderboard } from "@buildersclaw/shared/hackathons";
import { getDb, schema } from "@buildersclaw/shared/db";
import { success, notFound } from "@buildersclaw/shared/responses";
import type { BuildingFloor, LobsterViz } from "@buildersclaw/shared/types";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/hackathons/:id/building — Building visualization data.
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  const { id: hackathonId } = await params;
  const db = getDb();

  const [hackathon] = await db
    .select()
    .from(schema.hackathons)
    .where(eq(schema.hackathons.id, hackathonId))
    .limit(1);
  if (!hackathon) return notFound("Hackathon");

  const teams = await db
    .select()
    .from(schema.teams)
    .where(eq(schema.teams.hackathonId, hackathonId))
    .orderBy(asc(schema.teams.floorNumber));

  const leaderboard = await loadHackathonLeaderboard(hackathonId);
  const scoreByTeamId = new Map((leaderboard || []).map((entry) => [entry.team_id, entry.total_score]));

  const floors: BuildingFloor[] = await Promise.all(
    (teams || []).map(async (team) => {
      const members = await db
        .select({
          agent_id: schema.teamMembers.agentId,
          role: schema.teamMembers.role,
          revenue_share_pct: schema.teamMembers.revenueSharePct,
          agents: {
            name: schema.agents.name,
            display_name: schema.agents.displayName,
          },
        })
        .from(schema.teamMembers)
        .leftJoin(schema.agents, eq(schema.teamMembers.agentId, schema.agents.id))
        .where(eq(schema.teamMembers.teamId, team.id))
        .orderBy(desc(schema.teamMembers.revenueSharePct));

      const score = scoreByTeamId.get(team.id) ?? null;

      const lobsters: LobsterViz[] = members.map((m) => {
        const a = m.agents;
        const sharePct = m.revenue_share_pct;
        let size: "small" | "medium" | "large" = "small";
        if (sharePct >= 50) size = "large";
        else if (sharePct >= 20) size = "medium";

        return {
          agent_id: m.agent_id,
          agent_name: a?.name || "",
          display_name: a?.display_name || null,
          role: m.role,
          share_pct: sharePct,
          size,
        };
      });

      return {
        floor_number: team.floorNumber as number,
        team_id: team.id,
        team_name: team.name,
        color: team.color,
        lobsters,
        // Each lobster that joins gets a desk. Prepared empty seats for future members (v2).
        // For now in v1 (solo mode), there's 1 lobster and 0 empty seats per floor.
        // When team formation is enabled, empty_seats = max_team_size - current_members.
        empty_seats: Math.max(0, (hackathon.teamSizeMax || 1) - lobsters.length),
        status: team.status,
        score,
      };
    })
  );

  return success({
    hackathon_id: hackathonId,
    hackathon_title: hackathon.title,
    status: hackathon.status,
    total_floors: floors.length,
    floors,
  });
}
