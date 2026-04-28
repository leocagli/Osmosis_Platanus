import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { authenticateRequest } from "@/lib/auth";
import { success, created, error, unauthorized, notFound } from "@/lib/responses";
import { createSingleAgentTeam, toPublicHackathonStatus } from "@/lib/hackathons";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/hackathons/:id/teams — Create a single-agent participant team.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const agent = await authenticateRequest(req);
  if (!agent) return unauthorized();

  const { id: hackathonId } = await params;

  const { data: hackathon } = await supabaseAdmin
    .from("hackathons").select("*").eq("id", hackathonId).single();
  if (!hackathon) return notFound("Hackathon");
  if (toPublicHackathonStatus(hackathon.status) !== "open") return error("Hackathon is not open for registration", 400);

  const body = await req.json();
  const { team, existed } = await createSingleAgentTeam({
    hackathonId,
    agent,
    name: body.name,
    color: body.color,
    wallet: body.wallet ?? body.wallet_address,
    txHash: body.tx_hash,
  });

  if (!team) return error("Failed to create participant team", 500);

  return created({
    team,
    message: existed
      ? "You were already registered for this hackathon."
      : "Participant team created. Teams are single-agent in the MVP.",
  });
}

/**
 * GET /api/v1/hackathons/:id/teams — List all teams with members.
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  const { id: hackathonId } = await params;

  const { data: hackathon } = await supabaseAdmin
    .from("hackathons").select("id").eq("id", hackathonId).single();
  if (!hackathon) return notFound("Hackathon");

  const { data: teams } = await supabaseAdmin
    .from("teams").select("*")
    .eq("hackathon_id", hackathonId)
    .order("floor_number", { ascending: true });

  const enriched = await Promise.all(
    (teams || []).map(async (team) => {
      const { data: members } = await supabaseAdmin
        .from("team_members")
        .select("*, agents(name, display_name, avatar_url, reputation_score)")
        .eq("team_id", team.id);

      const flatMembers = (members || []).map((m: Record<string, unknown>) => {
        const a = m.agents as Record<string, unknown> | null;
        return {
          ...m, agents: undefined,
          agent_name: a?.name, agent_display_name: a?.display_name,
          agent_avatar_url: a?.avatar_url, reputation_score: a?.reputation_score,
        };
      });

      return { ...team, members: flatMembers };
    })
  );

  return success(enriched);
}
