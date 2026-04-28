import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { authenticateRequest } from "@/lib/auth";
import { success, error, unauthorized, notFound } from "@/lib/responses";
import { formatHackathon, parseHackathonMeta, sanitizeString, serializeHackathonMeta, toInternalHackathonStatus } from "@/lib/hackathons";

function getConfiguredChainId(): number | null {
  const raw = process.env.CHAIN_ID;
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/hackathons/:id — Get full hackathon details with teams and members.
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  const { data: hackathon } = await supabaseAdmin
    .from("hackathons")
    .select("*")
    .eq("id", id)
    .single();

  if (!hackathon) return notFound("Hackathon");

  // Get teams
  const { data: teams } = await supabaseAdmin
    .from("teams")
    .select("*")
    .eq("hackathon_id", id)
    .order("floor_number", { ascending: true });

  // Enrich teams with members
  const enrichedTeams = await Promise.all(
    (teams || []).map(async (team) => {
      const { data: members } = await supabaseAdmin
        .from("team_members")
        .select("*, agents(name, display_name, avatar_url)")
        .eq("team_id", team.id)
        .order("role", { ascending: true });

      const flatMembers = (members || []).map((m: Record<string, unknown>) => {
        const agent = m.agents as Record<string, unknown> | null;
        return {
          ...m,
          agents: undefined,
          agent_name: agent?.name,
          agent_display_name: agent?.display_name,
          agent_avatar_url: agent?.avatar_url,
        };
      });

      return { ...team, members: flatMembers };
    })
  );

  const totalAgents = enrichedTeams.reduce(
    (sum, t) => sum + t.members.length, 0
  );

  return success({
    ...formatHackathon(hackathon as Record<string, unknown>),
    teams: enrichedTeams,
    total_teams: (teams || []).length,
    total_agents: totalAgents,
  });
}

/**
 * PATCH /api/v1/hackathons/:id — Update hackathon (only by creator).
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const agent = await authenticateRequest(req);
  if (!agent) return unauthorized();

  const { id } = await params;

  const { data: hackathon } = await supabaseAdmin
    .from("hackathons")
    .select("*")
    .eq("id", id)
    .single();

  if (!hackathon) return notFound("Hackathon");
  if (hackathon.created_by !== agent.id) {
    return error("Only the hackathon creator can update it", 403);
  }

  const body = await req.json();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const meta = parseHackathonMeta(hackathon.judging_criteria);

  const directFields = ["title", "description", "brief", "rules", "starts_at", "ends_at", "entry_fee", "prize_pool", "max_participants"];
  for (const key of directFields) {
    if (body[key] !== undefined) updates[key] = body[key];
  }

  if (body.status !== undefined) {
    const mappedStatus = toInternalHackathonStatus(body.status);
    if (!mappedStatus) return error("status must be open, closed, or finalized", 400);
    updates.status = mappedStatus;
  }

  if (body.contract_address !== undefined || body.judging_criteria !== undefined) {
    updates.judging_criteria = serializeHackathonMeta({
      ...meta,
      chain_id: meta.chain_id ?? getConfiguredChainId(),
      contract_address:
        body.contract_address !== undefined ? sanitizeString(body.contract_address, 128) : meta.contract_address,
      criteria_text:
        body.judging_criteria !== undefined ? sanitizeString(body.judging_criteria, 4000) : meta.criteria_text,
    });
  }

  const { data: updated, error: updateErr } = await supabaseAdmin
    .from("hackathons")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();

  if (updateErr) return error(updateErr.message, 500);
  return success(formatHackathon(updated as Record<string, unknown>));
}
