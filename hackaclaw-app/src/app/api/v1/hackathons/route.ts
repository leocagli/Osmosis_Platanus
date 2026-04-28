import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { authenticateRequest } from "@/lib/auth";
import { success, created, error, unauthorized } from "@/lib/responses";
import { getPlatformFeePct } from "@/lib/responses";
import { formatHackathon, sanitizeString, serializeHackathonMeta, toPublicHackathonStatus } from "@/lib/hackathons";
import { v4 as uuid } from "uuid";
import { createHackathonRepo, slugify, setGitHubOverrides } from "@/lib/github";

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

    // duration_hours (optional) -> ends_at. If both provided, duration_hours wins.
    let endsAt: Date | null = null;
    if (body.duration_hours) {
      const hours = Number(body.duration_hours);
      if (!isNaN(hours) && hours > 0) {
        endsAt = new Date(Date.now() + hours * 60 * 60 * 1000);
      }
    } else if (body.ends_at) {
      endsAt = new Date(body.ends_at);
    }

    if (!endsAt || isNaN(endsAt.getTime())) {
      return error("ends_at or duration_hours is required", 400, "Example: ends_at='2026-03-25T18:00:00Z' OR duration_hours=24.");
    }
    if (endsAt.getTime() <= Date.now()) {
      return error("The calculated or provided deadline must be in the future", 400);
    }

    // entry_fee: required, can be 0 (free) or positive
    const entryFee = clampInt(body.entry_fee, 0, 1_000_000, -1);
    if (entryFee < 0 && body.entry_fee === undefined) {
      return error("entry_fee is required (use 0 for free hackathons)", 400, "Example: 0 for free, 100 for paid.");
    }
    const entryType = entryFee > 0 ? "paid" : "free";

    const id = uuid();

    const { data: hackathon, error: insertErr } = await supabaseAdmin
      .from("hackathons")
      .insert({
        id,
        title,
        description: sanitizeString(body.description, 1000),
        brief,
        rules: sanitizeString(body.rules, 2000),
        entry_type: entryType,
        entry_fee: entryFee,
        prize_pool: clampInt(body.prize_pool, 0, 10_000_000, 0),
        platform_fee_pct: getPlatformFeePct(),
        max_participants: clampInt(body.max_participants, 1, 1000, 100),
        team_size_min: clampInt(body.team_size_min, 1, 20, 1),
        team_size_max: 1,
        build_time_seconds: clampInt(body.build_time_seconds, 30, 600, 120),
        challenge_type: sanitizeString(body.challenge_type, 50) || "landing_page",
        status: "open",
        created_by: agent.id,
        starts_at: body.starts_at || new Date().toISOString(),
        ends_at: endsAt.toISOString(),
        judging_criteria: serializeHackathonMeta({
          chain_id: getConfiguredChainId(),
          contract_address: sanitizeString(body.contract_address, 128),
          criteria_text: sanitizeString(body.judging_criteria, 4000),
        }),
      })
      .select("*")
      .single();

    if (insertErr) return error("Failed to create hackathon", 500);

    // Create GitHub repo (best-effort — don't fail if GitHub is unavailable)
    const ghToken = sanitizeString(body.github_token, 256) || process.env.GITHUB_TOKEN;
    const ghOwner = sanitizeString(body.github_owner, 64) || undefined;
    if (ghToken) {
      try {
        setGitHubOverrides(ghToken, ghOwner);
        const hackathonSlug = slugify(title);
        const { repoUrl } = await createHackathonRepo(hackathonSlug, brief, title);
        await supabaseAdmin.from("hackathons").update({ github_repo: repoUrl }).eq("id", id);
        if (hackathon) hackathon.github_repo = repoUrl;
      } catch (err) {
        console.error("GitHub repo creation failed (non-fatal):", err);
      } finally {
        setGitHubOverrides();
      }
    }

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
