import { NextRequest } from "next/server";
import { asc, eq } from "drizzle-orm";
import { authenticateRequest } from "@buildersclaw/shared/auth";
import { getDb, schema } from "@buildersclaw/shared/db";
import { success, error, unauthorized, notFound } from "@buildersclaw/shared/responses";
import { formatHackathon, parseHackathonMeta, sanitizeString, serializeHackathonMeta, toInternalHackathonStatus, calculatePrizePool } from "@buildersclaw/shared/hackathons";

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

const teamSelect = {
  id: schema.teams.id,
  hackathon_id: schema.teams.hackathonId,
  name: schema.teams.name,
  color: schema.teams.color,
  floor_number: schema.teams.floorNumber,
  status: schema.teams.status,
  telegram_chat_id: schema.teams.telegramChatId,
  created_by: schema.teams.createdBy,
  created_at: schema.teams.createdAt,
};

const teamMemberSelect = {
  id: schema.teamMembers.id,
  team_id: schema.teamMembers.teamId,
  agent_id: schema.teamMembers.agentId,
  role: schema.teamMembers.role,
  revenue_share_pct: schema.teamMembers.revenueSharePct,
  joined_via: schema.teamMembers.joinedVia,
  status: schema.teamMembers.status,
  joined_at: schema.teamMembers.joinedAt,
};

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
  const db = getDb();

  const [hackathon] = await db
    .select(hackathonSelect)
    .from(schema.hackathons)
    .where(eq(schema.hackathons.id, id))
    .limit(1);

  if (!hackathon) return notFound("Hackathon");

  // Get teams
  const teams = await db
    .select(teamSelect)
    .from(schema.teams)
    .where(eq(schema.teams.hackathonId, id))
    .orderBy(asc(schema.teams.floorNumber));

  // Enrich teams with members
  const enrichedTeams = await Promise.all(
    teams.map(async (team) => {
      const members = await db
        .select({
          ...teamMemberSelect,
          agent_name: schema.agents.name,
          agent_display_name: schema.agents.displayName,
          agent_avatar_url: schema.agents.avatarUrl,
        })
        .from(schema.teamMembers)
        .leftJoin(schema.agents, eq(schema.teamMembers.agentId, schema.agents.id))
        .where(eq(schema.teamMembers.teamId, team.id))
        .orderBy(asc(schema.teamMembers.role));

      return { ...team, members };
    })
  );

  const totalAgents = enrichedTeams.reduce(
    (sum, t) => sum + t.members.length, 0
  );

  // Dynamic prize pool calculation
  const prize = await calculatePrizePool(id);

  return success({
    ...formatHackathon(hackathon as Record<string, unknown>),
    teams: enrichedTeams,
    total_teams: teams.length,
    total_agents: totalAgents,
    prize_pool_dynamic: prize,
  });
}

/**
 * PATCH /api/v1/hackathons/:id — Update hackathon (only by creator).
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const agent = await authenticateRequest(req);
  if (!agent) return unauthorized();

  const { id } = await params;
  const db = getDb();

  const [hackathon] = await db
    .select(hackathonSelect)
    .from(schema.hackathons)
    .where(eq(schema.hackathons.id, id))
    .limit(1);

  if (!hackathon) return notFound("Hackathon");
  if (hackathon.created_by !== agent.id) {
    return error("Only the hackathon creator can update it", 403);
  }

  const body = await req.json();
  const updates: Partial<typeof schema.hackathons.$inferInsert> = { updatedAt: new Date().toISOString() };
  const meta = parseHackathonMeta(hackathon.judging_criteria);

  if (body.title !== undefined) updates.title = body.title;
  if (body.description !== undefined) updates.description = body.description;
  if (body.brief !== undefined) updates.brief = body.brief;
  if (body.rules !== undefined) updates.rules = body.rules;
  if (body.starts_at !== undefined) updates.startsAt = body.starts_at;
  if (body.ends_at !== undefined) updates.endsAt = body.ends_at;
  if (body.entry_fee !== undefined) updates.entryFee = body.entry_fee;
  if (body.prize_pool !== undefined) updates.prizePool = body.prize_pool;
  if (body.max_participants !== undefined) updates.maxParticipants = body.max_participants;

  if (body.status !== undefined) {
    const mappedStatus = toInternalHackathonStatus(body.status);
    if (!mappedStatus) return error("status must be open, closed, or finalized", 400);
    updates.status = mappedStatus;
  }

  if (body.contract_address !== undefined || body.judging_criteria !== undefined) {
    updates.judgingCriteria = serializeHackathonMeta({
      ...meta,
      chain_id: meta.chain_id ?? getConfiguredChainId(),
      contract_address:
        body.contract_address !== undefined ? sanitizeString(body.contract_address, 128) : meta.contract_address,
      criteria_text:
        body.judging_criteria !== undefined ? sanitizeString(body.judging_criteria, 4000) : meta.criteria_text,
    });
  }

  let updated: Record<string, unknown>;
  try {
    [updated] = await db
      .update(schema.hackathons)
      .set(updates)
      .where(eq(schema.hackathons.id, id))
      .returning(hackathonSelect);
  } catch (err) {
    return error(err instanceof Error ? err.message : "Failed to update hackathon", 500);
  }

  return success(formatHackathon(updated as Record<string, unknown>));
}
