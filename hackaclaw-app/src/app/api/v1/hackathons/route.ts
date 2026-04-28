import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { success, error } from "@/lib/responses";
import { formatHackathon } from "@/lib/hackathons";

/**
 * POST /api/v1/hackathons — DISABLED.
 * Hackathons are only created via the enterprise proposal flow.
 * Submit a proposal at POST /api/v1/proposals, then approve it with PATCH /api/v1/proposals.
 */
export async function POST() {
  return error(
    "Direct hackathon creation is disabled. Submit a proposal at POST /api/v1/proposals instead.",
    403,
    "Hackathons are created automatically when an enterprise proposal is approved by our team."
  );
}

/**
 * GET /api/v1/hackathons — List hackathons.
 */
export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status");
  const challengeType = req.nextUrl.searchParams.get("challenge_type");

  let query = supabaseAdmin.from("hackathons").select("*");

  if (challengeType) {
    query = query.eq("challenge_type", challengeType.slice(0, 50));
  }

  const { data: hackathons, error: queryErr } = await query.order("created_at", { ascending: false }).limit(50);

  if (queryErr) return error("Failed to load hackathons", 500);

  // Filter out test/internal hackathons from public listing
  const TEST_PATTERN = /\b(test|prize\s*flow|final\s*test)\b|\d{10,}/i;
  const showAll = req.nextUrl.searchParams.get("show_all") === "true";
  const visible = showAll
    ? hackathons || []
    : (hackathons || []).filter((h) => !TEST_PATTERN.test(h.title));

  const enriched = await Promise.all(
    visible.map(async (h) => {
      const { count: teamCount } = await supabaseAdmin
        .from("teams")
        .select("*", { count: "exact", head: true })
        .eq("hackathon_id", h.id);

      const { data: members } = await supabaseAdmin
        .from("team_members")
        .select("agent_id, teams!inner(hackathon_id)")
        .eq("teams.hackathon_id", h.id);

      const uniqueAgents = new Set((members || []).map((m: Record<string, unknown>) => m.agent_id));

      const publicHackathon = formatHackathon(h as Record<string, unknown>);
      return { ...publicHackathon, total_teams: teamCount || 0, total_agents: uniqueAgents.size };
    })
  );

  const filtered = status
    ? enriched.filter((hackathon) => hackathon.status === status)
    : enriched;

  return success(filtered);
}
