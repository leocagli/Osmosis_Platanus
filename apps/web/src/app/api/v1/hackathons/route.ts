import { NextRequest } from "next/server";
import { v4 as uuid } from "uuid";
import { count, countDistinct, desc, eq } from "drizzle-orm";
import { authenticateAdminRequest } from "@buildersclaw/shared/auth";
import { getDb, schema } from "@buildersclaw/shared/db";
import { created, error, getPlatformFeePct, success } from "@buildersclaw/shared/responses";
import { formatHackathon, sanitizeString, sanitizeUrl, serializeHackathonMeta } from "@buildersclaw/shared/hackathons";
import { getUsdcDecimals, getUsdcSymbol } from "@buildersclaw/shared/chain";
import { telegramHackathonCreated } from "@buildersclaw/shared/telegram";

const hackathonSelect = {
  id: schema.hackathons.id,
  title: schema.hackathons.title,
  description: schema.hackathons.description,
  brief: schema.hackathons.brief,
  rules: schema.hackathons.rules,
  entry_type: schema.hackathons.entryType,
  entry_fee: schema.hackathons.entryFee,
  prize_pool: schema.hackathons.prizePool,
  platform_fee_pct: schema.hackathons.platformFeePct,
  max_participants: schema.hackathons.maxParticipants,
  team_size_min: schema.hackathons.teamSizeMin,
  team_size_max: schema.hackathons.teamSizeMax,
  build_time_seconds: schema.hackathons.buildTimeSeconds,
  challenge_type: schema.hackathons.challengeType,
  status: schema.hackathons.status,
  created_by: schema.hackathons.createdBy,
  starts_at: schema.hackathons.startsAt,
  ends_at: schema.hackathons.endsAt,
  judging_criteria: schema.hackathons.judgingCriteria,
  github_repo: schema.hackathons.githubRepo,
  created_at: schema.hackathons.createdAt,
  updated_at: schema.hackathons.updatedAt,
};

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

function hasDatabaseConfig() {
  return Boolean(process.env.DATABASE_URL);
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
    const contractAddress = sanitizeString(body.contract_address, 128);
    const entryType = contractAddress ? "on_chain" : "off_chain";
    const teamSizeMin = parseInteger(body.team_size_min, 1, 1, 20);
    const teamSizeMax = Math.max(teamSizeMin, parseInteger(body.team_size_max, 5, 1, 20));
    const prizePool = parseNumber(body.prize_pool, 0, 0, 100_000_000);
    const platformFeePct = parseNumber(body.platform_fee_pct, getPlatformFeePct(), 0, 1);
    const chainId = Number.isInteger(Number(body.chain_id))
      ? Number(body.chain_id)
      : Number(process.env.CHAIN_ID || 0) || null;
    const id = uuid();

    const insertPayload = {
      id,
      title,
      description: sanitizeString(body.description, 2000) || `Direct hackathon: ${title}`,
      brief,
      rules: sanitizeString(body.rules, 4000),
      entryType,
      entryFee,
      prizePool,
      platformFeePct,
      maxParticipants: parseInteger(body.max_participants, 500, 1, 10000),
      teamSizeMin,
      teamSizeMax,
      buildTimeSeconds: parseInteger(body.build_time_seconds, 180, 30, 86400),
      challengeType: sanitizeString(body.challenge_type, 50) || "other",
      status: internalStatus,
      createdBy: null,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      judgingCriteria: serializeHackathonMeta({
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
      githubRepo: sanitizeUrl(body.github_repo),
    };

    let hackathon: Record<string, unknown>;
    try {
      [hackathon] = await getDb().insert(schema.hackathons).values(insertPayload).returning(hackathonSelect);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown database error";
      return error(`Failed to create hackathon: ${message}`, 500);
    }

    if (internalStatus === "open") {
      telegramHackathonCreated({
        id,
        title,
        prize_pool: prizePool,
        challenge_type: insertPayload.challengeType,
      }).catch(() => {});
    }

    return created({
      ...formatHackathon(hackathon),
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
  if (!hasDatabaseConfig()) {
    return success([]);
  }

  const status = req.nextUrl.searchParams.get("status");
  const challengeType = req.nextUrl.searchParams.get("challenge_type");
  const db = getDb();

  const hackathons = challengeType
    ? await db
        .select(hackathonSelect)
        .from(schema.hackathons)
        .where(eq(schema.hackathons.challengeType, challengeType.slice(0, 50)))
        .orderBy(desc(schema.hackathons.createdAt))
        .limit(50)
    : await db.select(hackathonSelect).from(schema.hackathons).orderBy(desc(schema.hackathons.createdAt)).limit(50);

  const enriched = await Promise.all(
    hackathons.map(async (h) => {
      const [[teamRow], [agentRow]] = await Promise.all([
        db.select({ total: count() }).from(schema.teams).where(eq(schema.teams.hackathonId, h.id)),
        db
          .select({ total: countDistinct(schema.teamMembers.agentId) })
          .from(schema.teamMembers)
          .innerJoin(schema.teams, eq(schema.teamMembers.teamId, schema.teams.id))
          .where(eq(schema.teams.hackathonId, h.id)),
      ]);
      const publicHackathon = formatHackathon(h as Record<string, unknown>);

      return { ...publicHackathon, total_teams: teamRow?.total || 0, total_agents: agentRow?.total || 0 };
    }),
  );

  const filtered = status
    ? enriched.filter((hackathon) => hackathon.status === status)
    : enriched;

  return success(filtered);
}
