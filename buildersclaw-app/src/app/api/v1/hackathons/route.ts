import { NextRequest } from "next/server";
import { v4 as uuid } from "uuid";
import { supabaseAdmin } from "@/lib/supabase";
import { authenticateAdminRequest } from "@/lib/auth";
import { created, error, getPlatformFeePct, success } from "@/lib/responses";
import { formatHackathon, sanitizeString, sanitizeUrl, serializeHackathonMeta } from "@/lib/hackathons";
import { getUsdcDecimals, getUsdcSymbol } from "@/lib/chain";
import { telegramHackathonCreated } from "@/lib/telegram";

function parseNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function parseInteger(value: unknown, fallback: number, min: number, max: number) {
  return Math.round(parseNumber(value, fallback, min, max));
}

function parseDate(value: unknown, fallback: Date): Date | null {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string") return null;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function hasSupabaseConfig() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

/**
 * POST /api/v1/hackathons - Direct admin hackathon creation.
 * The public enterprise path remains POST /api/v1/proposals + admin approval.
 */
export async function POST(req: NextRequest) {
  if (!authenticateAdminRequest(req)) {
    return error("Admin authentication required", 401, "Add 'Authorization: Bearer <ADMIN_API_KEY>' header.");
  }

  try {
    const body = await req.json();
    const title = sanitizeString(body.title, 200);
    const brief = sanitizeString(body.brief, 5000);

    if (!title || !brief) {
      return error("title and brief are required", 400);
    }

    const now = new Date();
    const startsAt = parseDate(body.starts_at, now);
    const endsAt = parseDate(body.ends_at, new Date(now.getTime() + 24 * 60 * 60 * 1000));

    if (!startsAt) return error("starts_at must be a valid date string", 400);
    if (!endsAt) return error("ends_at must be a valid date string", 400);
    if (endsAt.getTime() <= startsAt.getTime()) return error("ends_at must be after starts_at", 400);

    const status = sanitizeString(body.status, 32) || "open";
    const internalStatus = ["draft", "scheduled", "open", "judging", "completed"].includes(status)
      ? status
      : "open";
    const entryFee = parseInteger(body.entry_fee, 0, 0, 1_000_000);
    const entryType = body.entry_type === "paid" || entryFee > 0 ? "paid" : "free";
    const teamSizeMin = parseInteger(body.team_size_min, 1, 1, 20);
    const teamSizeMax = Math.max(teamSizeMin, parseInteger(body.team_size_max, 5, 1, 20));
    const prizePool = parseNumber(body.prize_pool, 0, 0, 100_000_000);
    const platformFeePct = parseNumber(body.platform_fee_pct, getPlatformFeePct(), 0, 1);
    const chainId = Number.isInteger(Number(body.chain_id))
      ? Number(body.chain_id)
      : Number(process.env.CHAIN_ID || 0) || null;
    const contractAddress = sanitizeString(body.contract_address, 128);
    const id = uuid();

    const insertPayload = {
      id,
      title,
      description: sanitizeString(body.description, 2000) || `Direct hackathon: ${title}`,
      brief,
      rules: sanitizeString(body.rules, 4000),
      entry_type: entryType,
      entry_fee: entryFee,
      prize_pool: prizePool,
      platform_fee_pct: platformFeePct,
      max_participants: parseInteger(body.max_participants, 500, 1, 10000),
      team_size_min: teamSizeMin,
      team_size_max: teamSizeMax,
      build_time_seconds: parseInteger(body.build_time_seconds, 180, 30, 86400),
      challenge_type: sanitizeString(body.challenge_type, 50) || "other",
      status: internalStatus,
      created_by: null,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      judging_criteria: serializeHackathonMeta({
        chain_id: chainId,
        contract_address: contractAddress,
        sponsor_address: sanitizeString(body.sponsor_address, 128),
        token_address: sanitizeString(body.token_address, 128) || process.env.USDC_ADDRESS || null,
        token_symbol: sanitizeString(body.token_symbol, 32) || getUsdcSymbol(),
        token_decimals: Number.isInteger(Number(body.token_decimals))
          ? Number(body.token_decimals)
          : getUsdcDecimals(),
        criteria_text: sanitizeString(body.judging_criteria ?? body.rules, 4000),
        judge_method: sanitizeString(body.judge_method, 64),
        genlayer_contract: sanitizeString(body.genlayer_contract, 128),
      }),
      github_repo: sanitizeUrl(body.github_repo),
    };

    const { data: hackathon, error: insertErr } = await supabaseAdmin
      .from("hackathons")
      .insert(insertPayload)
      .select("*")
      .single();

    if (insertErr) return error(`Failed to create hackathon: ${insertErr.message}`, 500);

    if (internalStatus === "open") {
      telegramHackathonCreated({
        id,
        title,
        prize_pool: prizePool,
        challenge_type: insertPayload.challenge_type,
      }).catch(() => {});
    }

    return created({
      ...formatHackathon(hackathon as Record<string, unknown>),
      url: `/hackathons/${id}`,
      creation_flow: "direct_admin",
    });
  } catch {
    return error("Invalid request", 400);
  }
}

/**
 * GET /api/v1/hackathons - List hackathons.
 */
export async function GET(req: NextRequest) {
  if (!hasSupabaseConfig()) {
    return success([]);
  }

  const status = req.nextUrl.searchParams.get("status");
  const challengeType = req.nextUrl.searchParams.get("challenge_type");

  let query = supabaseAdmin.from("hackathons").select("*");

  if (challengeType) {
    query = query.eq("challenge_type", challengeType.slice(0, 50));
  }

  const { data: hackathons, error: queryErr } = await query.order("created_at", { ascending: false }).limit(50);

  if (queryErr) return error("Failed to load hackathons", 500);

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
    }),
  );

  const filtered = status
    ? enriched.filter((hackathon) => hackathon.status === status)
    : enriched;

  return success(filtered);
}
