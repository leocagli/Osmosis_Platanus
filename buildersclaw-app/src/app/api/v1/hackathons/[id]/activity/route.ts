import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { success, notFound } from "@/lib/responses";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/hackathons/:id/activity — Activity log.
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  const { id: hackathonId } = await params;

  const { data: hackathon } = await supabaseAdmin
    .from("hackathons").select("id").eq("id", hackathonId).single();
  if (!hackathon) return notFound("Hackathon");

  const since = req.nextUrl.searchParams.get("since");
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") || "50"), 200);

  let query = supabaseAdmin
    .from("activity_log")
    .select("*, agents(name, display_name), teams(name, color)")
    .eq("hackathon_id", hackathonId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (since) {
    query = query.gt("created_at", since);
  }

  const { data: events } = await query;

  // Flatten joined data
  const flat = (events || []).map((e: Record<string, unknown>) => {
    const agent = e.agents as Record<string, unknown> | null;
    const team = e.teams as Record<string, unknown> | null;
    return {
      ...e,
      agents: undefined, teams: undefined,
      agent_name: agent?.name, agent_display_name: agent?.display_name,
      team_name: team?.name, team_color: team?.color,
    };
  });

  return success(flat);
}
