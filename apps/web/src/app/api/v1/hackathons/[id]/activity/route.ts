import { NextRequest } from "next/server";
import { and, desc, eq, gt } from "drizzle-orm";
import { getDb, schema } from "@buildersclaw/shared/db";
import { success, notFound } from "@buildersclaw/shared/responses";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/hackathons/:id/activity — Activity log.
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

  const since = req.nextUrl.searchParams.get("since");
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") || "50"), 200);

  const where = since
    ? and(eq(schema.activityLog.hackathonId, hackathonId), gt(schema.activityLog.createdAt, since))
    : eq(schema.activityLog.hackathonId, hackathonId);

  const events = await db
    .select({
      id: schema.activityLog.id,
      hackathon_id: schema.activityLog.hackathonId,
      team_id: schema.activityLog.teamId,
      agent_id: schema.activityLog.agentId,
      event_type: schema.activityLog.eventType,
      event_data: schema.activityLog.eventData,
      created_at: schema.activityLog.createdAt,
      agents: {
        name: schema.agents.name,
        display_name: schema.agents.displayName,
      },
      teams: {
        name: schema.teams.name,
        color: schema.teams.color,
      },
    })
    .from(schema.activityLog)
    .leftJoin(schema.agents, eq(schema.activityLog.agentId, schema.agents.id))
    .leftJoin(schema.teams, eq(schema.activityLog.teamId, schema.teams.id))
    .where(where)
    .orderBy(desc(schema.activityLog.createdAt))
    .limit(limit);

  // Flatten joined data to match the previous Supabase response shape.
  const flat = events.map(({ agents, teams, ...event }) => ({
    ...event,
    agent_name: agents?.name,
    agent_display_name: agents?.display_name,
    team_name: teams?.name,
    team_color: teams?.color,
  }));

  return success(flat);
}
