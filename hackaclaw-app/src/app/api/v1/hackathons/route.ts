import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { authenticateRequest } from "@/lib/auth";
import { success, created, error, unauthorized } from "@/lib/responses";
import { getPlatformFeePct } from "@/lib/responses";
import { formatHackathon, sanitizeString, serializeHackathonMeta, toPublicHackathonStatus } from "@/lib/hackathons";
import { v4 as uuid } from "uuid";

function clampInt(val: unknown, min: number, max: number, fallback: number): number {
  const n = Number(val);
  if (isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function getConfiguredChainId(): number | null {
  const raw = process.env.CHAIN_ID;
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * POST /api/v1/hackathons — Create a new hackathon. Requires auth.
 */
export async function POST(req: NextRequest) {
  const agent = await authenticateRequest(req);
  if (!agent) return unauthorized();

  try {
    const body = await req.json();
    const title = sanitizeString(body.title, 200);
    const brief = sanitizeString(body.brief, 5000);

    if (!title || !brief) {
      return error("title and brief are required");
    }

    const id = uuid();

    const { data: hackathon, error: insertErr } = await supabaseAdmin
      .from("hackathons")
      .insert({
        id,
        title,
        description: sanitizeString(body.description, 1000),
        brief,
        rules: sanitizeString(body.rules, 2000),
        entry_type: body.entry_type === "paid" ? "paid" : "free",
        entry_fee: clampInt(body.entry_fee, 0, 1_000_000, 0),
        prize_pool: clampInt(body.prize_pool, 0, 10_000_000, 0),
        platform_fee_pct: getPlatformFeePct(),
        max_participants: clampInt(body.max_participants, 1, 1000, 100),
        team_size_min: clampInt(body.team_size_min, 1, 20, 1),
        team_size_max: 1,
        build_time_seconds: clampInt(body.build_time_seconds, 30, 600, 120),
        challenge_type: sanitizeString(body.challenge_type, 50) || "landing_page",
        status: "open",
        created_by: agent.id,
        starts_at: body.starts_at || null,
        ends_at: body.ends_at || null,
        judging_criteria: serializeHackathonMeta({
          chain_id: getConfiguredChainId(),
          contract_address: sanitizeString(body.contract_address, 128),
          criteria_text: sanitizeString(body.judging_criteria, 4000),
        }),
      })
      .select("*")
      .single();

    if (insertErr) return error("Failed to create hackathon", 500);
    return created(formatHackathon(hackathon));
  } catch {
    return error("Invalid request body", 400);
  }
}

/**
 * GET /api/v1/hackathons — List hackathons.
 */
export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status");
  const challengeType = req.nextUrl.searchParams.get("challenge_type");

  let query = supabaseAdmin.from("hackathons").select("*");

  // Validate status filter
  if (challengeType) {
    query = query.eq("challenge_type", challengeType.slice(0, 50));
  }

  const { data: hackathons, error: queryErr } = await query.order("created_at", { ascending: false }).limit(50);

  if (queryErr) return error("Failed to load hackathons", 500);

  // Enrich with counts
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

      const publicHackathon = formatHackathon(h as Record<string, unknown>);
      return { ...publicHackathon, total_teams: teamCount || 0, total_agents: uniqueAgents.size };
    })
  );

  const filtered = status
    ? enriched.filter((hackathon) => toPublicHackathonStatus(hackathon.internal_status) === status)
    : enriched;

  return success(filtered);
}
