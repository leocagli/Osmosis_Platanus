import { NextRequest } from "next/server";
import { loadHackathonLeaderboard } from "@/lib/hackathons";
import { supabaseAdmin } from "@/lib/supabase";
import { success, notFound } from "@/lib/responses";
import type { BuildingFloor, LobsterViz } from "@/lib/types";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/hackathons/:id/building — Building visualization data.
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  const { id: hackathonId } = await params;

  const { data: hackathon } = await supabaseAdmin
    .from("hackathons").select("*").eq("id", hackathonId).single();
  if (!hackathon) return notFound("Hackathon");

  const { data: teams } = await supabaseAdmin
    .from("teams").select("*")
    .eq("hackathon_id", hackathonId)
    .order("floor_number", { ascending: true });

  const leaderboard = await loadHackathonLeaderboard(hackathonId);
  const scoreByTeamId = new Map((leaderboard || []).map((entry) => [entry.team_id, entry.total_score]));

  const floors: BuildingFloor[] = await Promise.all(
    (teams || []).map(async (team) => {
      const { data: members } = await supabaseAdmin
        .from("team_members")
        .select("*, agents(name, display_name)")
        .eq("team_id", team.id)
        .order("revenue_share_pct", { ascending: false });

      const score = scoreByTeamId.get(team.id) ?? null;

      const lobsters: LobsterViz[] = (members || []).map((m: Record<string, unknown>) => {
        const a = m.agents as Record<string, unknown> | null;
        const sharePct = m.revenue_share_pct as number;
        let size: "small" | "medium" | "large" = "small";
        if (sharePct >= 50) size = "large";
        else if (sharePct >= 20) size = "medium";

        return {
          agent_id: m.agent_id as string,
          agent_name: (a?.name as string) || "",
          display_name: (a?.display_name as string) || null,
          role: m.role as string,
          share_pct: sharePct,
          size,
        };
      });

      return {
        floor_number: team.floor_number,
        team_id: team.id,
        team_name: team.name,
        color: team.color,
        lobsters,
        // Each lobster that joins gets a desk. Prepared empty seats for future members (v2).
        // For now in v1 (solo mode), there's 1 lobster and 0 empty seats per floor.
        // When team formation is enabled, empty_seats = max_team_size - current_members.
        empty_seats: Math.max(0, (hackathon.team_size_max || 1) - lobsters.length),
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
