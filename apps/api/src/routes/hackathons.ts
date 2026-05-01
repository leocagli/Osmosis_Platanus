import type { FastifyInstance, FastifyRequest } from "fastify";
import { supabaseAdmin } from "../../../web/src/lib/supabase";
import { formatHackathon, loadHackathonLeaderboard, calculatePrizePool, parseHackathonMeta, sanitizeString, serializeHackathonMeta, toInternalHackathonStatus } from "../../../web/src/lib/hackathons";
import { ok, fail, notFound, unauthorized } from "../respond";
import { authFastify } from "../auth";

function hasSupabaseConfig() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

function getConfiguredChainId(): number | null {
  const raw = process.env.CHAIN_ID;
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function hackathonRoutes(fastify: FastifyInstance) {
  // GET /api/v1/hackathons
  fastify.get("/api/v1/hackathons", async (req, reply) => {
    if (!hasSupabaseConfig()) return ok(reply, []);

    const query = req.query as { status?: string; challenge_type?: string };

    let dbQuery = supabaseAdmin.from("hackathons").select("*");
    if (query.challenge_type) {
      dbQuery = dbQuery.eq("challenge_type", query.challenge_type.slice(0, 50));
    }

    const { data: hackathons, error } = await dbQuery
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) return fail(reply, "Failed to load hackathons", 500);

    const enriched = await Promise.all(
      (hackathons || []).map(async (h) => {
        const { count: teamCount } = await supabaseAdmin
          .from("teams")
          .select("*", { count: "exact", head: true })
          .eq("hackathon_id", h.id);

        const { data: members } = await supabaseAdmin
          .from("team_members")
          .select("agent_id, teams!inner(hackathon_id)")
          .eq("teams.hackathon_id", h.id);

        const uniqueAgents = new Set((members || []).map((m: Record<string, unknown>) => m.agent_id));
        return {
          ...formatHackathon(h as Record<string, unknown>),
          total_teams: teamCount || 0,
          total_agents: uniqueAgents.size,
        };
      }),
    );

    const filtered = query.status
      ? enriched.filter((h) => h.status === query.status)
      : enriched;

    return ok(reply, filtered);
  });

  // GET /api/v1/hackathons/:id
  fastify.get("/api/v1/hackathons/:id", async (req, reply) => {
    const { id } = req.params as { id: string };

    const { data: hackathon } = await supabaseAdmin
      .from("hackathons")
      .select("*")
      .eq("id", id)
      .single();

    if (!hackathon) return notFound(reply, "Hackathon");

    const { data: teams } = await supabaseAdmin
      .from("teams")
      .select("*")
      .eq("hackathon_id", id)
      .order("floor_number", { ascending: true });

    const enrichedTeams = await Promise.all(
      (teams || []).map(async (team) => {
        const { data: members } = await supabaseAdmin
          .from("team_members")
          .select("*, agents(name, display_name, avatar_url)")
          .eq("team_id", team.id)
          .order("role", { ascending: true });

        const flatMembers = (members || []).map((m: Record<string, unknown>) => {
          const agent = m.agents as Record<string, unknown> | null;
          return { ...m, agents: undefined, agent_name: agent?.name, agent_display_name: agent?.display_name, agent_avatar_url: agent?.avatar_url };
        });

        return { ...team, members: flatMembers };
      }),
    );

    const totalAgents = enrichedTeams.reduce((sum, t) => sum + t.members.length, 0);
    const prize = await calculatePrizePool(id);

    return ok(reply, {
      ...formatHackathon(hackathon as Record<string, unknown>),
      teams: enrichedTeams,
      total_teams: (teams || []).length,
      total_agents: totalAgents,
      prize_pool_dynamic: prize,
    });
  });

  // PATCH /api/v1/hackathons/:id
  fastify.patch("/api/v1/hackathons/:id", async (req, reply) => {
    const agent = await authFastify(req);
    if (!agent) return unauthorized(reply);

    const { id } = req.params as { id: string };

    const { data: hackathon } = await supabaseAdmin
      .from("hackathons")
      .select("*")
      .eq("id", id)
      .single();

    if (!hackathon) return notFound(reply, "Hackathon");
    if (hackathon.created_by !== agent.id) {
      return fail(reply, "Only the hackathon creator can update it", 403);
    }

    const body = req.body as Record<string, unknown>;
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const meta = parseHackathonMeta(hackathon.judging_criteria);

    const directFields = ["title", "description", "brief", "rules", "starts_at", "ends_at", "entry_fee", "prize_pool", "max_participants"];
    for (const key of directFields) {
      if (body[key] !== undefined) updates[key] = body[key];
    }

    if (body.status !== undefined) {
      const mappedStatus = toInternalHackathonStatus(body.status as string);
      if (!mappedStatus) return fail(reply, "status must be open, closed, or finalized", 400);
      updates.status = mappedStatus;
    }

    if (body.contract_address !== undefined || body.judging_criteria !== undefined) {
      updates.judging_criteria = serializeHackathonMeta({
        ...meta,
        chain_id: meta.chain_id ?? getConfiguredChainId(),
        contract_address: body.contract_address !== undefined ? sanitizeString(body.contract_address as string, 128) : meta.contract_address,
        criteria_text: body.judging_criteria !== undefined ? sanitizeString(body.judging_criteria as string, 4000) : meta.criteria_text,
      });
    }

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("hackathons")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();

    if (updateErr) return fail(reply, updateErr.message, 500);
    return ok(reply, formatHackathon(updated as Record<string, unknown>));
  });

  // GET /api/v1/hackathons/:id/leaderboard
  fastify.get("/api/v1/hackathons/:id/leaderboard", async (req, reply) => {
    const { id: hackathonId } = req.params as { id: string };
    const leaderboard = await loadHackathonLeaderboard(hackathonId);
    if (!leaderboard) return notFound(reply, "Hackathon");
    const prize = await calculatePrizePool(hackathonId);
    return ok(reply, { leaderboard, prize_pool: prize });
  });

  // GET /api/v1/hackathons/:id/judge  (leaderboard alias for backward compat)
  fastify.get("/api/v1/hackathons/:id/judge", async (req, reply) => {
    const { id: hackathonId } = req.params as { id: string };
    const leaderboard = await loadHackathonLeaderboard(hackathonId);
    if (!leaderboard) return notFound(reply, "Hackathon");
    return ok(reply, leaderboard);
  });
}
