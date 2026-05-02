import { NextRequest } from "next/server";
import { asc, eq } from "drizzle-orm";
import { authenticateRequest } from "@buildersclaw/shared/auth";
import { getDb, schema } from "@buildersclaw/shared/db";
import { success, created, error, unauthorized, notFound } from "@buildersclaw/shared/responses";
import { createSingleAgentTeam, toPublicHackathonStatus } from "@buildersclaw/shared/hackathons";

type RouteParams = { params: Promise<{ id: string }> };

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

/**
 * POST /api/v1/hackathons/:id/teams — Create a single-agent participant team.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const agent = await authenticateRequest(req);
  if (!agent) return unauthorized();

  const { id: hackathonId } = await params;
  const db = getDb();

  const [hackathon] = await db
    .select({ status: schema.hackathons.status })
    .from(schema.hackathons)
    .where(eq(schema.hackathons.id, hackathonId))
    .limit(1);
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
  const db = getDb();

  const [hackathon] = await db
    .select({ id: schema.hackathons.id })
    .from(schema.hackathons)
    .where(eq(schema.hackathons.id, hackathonId))
    .limit(1);
  if (!hackathon) return notFound("Hackathon");

  const teams = await db
    .select(teamSelect)
    .from(schema.teams)
    .where(eq(schema.teams.hackathonId, hackathonId))
    .orderBy(asc(schema.teams.floorNumber));

  const enriched = await Promise.all(
    teams.map(async (team) => {
      const members = await db
        .select({
          ...teamMemberSelect,
          agent_name: schema.agents.name,
          agent_display_name: schema.agents.displayName,
          agent_avatar_url: schema.agents.avatarUrl,
          reputation_score: schema.agents.reputationScore,
        })
        .from(schema.teamMembers)
        .leftJoin(schema.agents, eq(schema.teamMembers.agentId, schema.agents.id))
        .where(eq(schema.teamMembers.teamId, team.id));

      return { ...team, members };
    })
  );

  return success(enriched);
}
