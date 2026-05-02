import crypto from "crypto";
import type { FastifyInstance } from "fastify";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@buildersclaw/shared/db";
import { sanitizeString } from "@buildersclaw/shared/hackathons";
import { checkRateLimit, enforceShareIntegrity, isValidUUID, validateRoleType, validateSharePct, validateTeamTotalShares } from "@buildersclaw/shared/validation";
import { ok, created, fail, notFound, unauthorized } from "../respond";
import { authFastify } from "../auth";

const listingSelect = {
  id: schema.marketplaceListings.id,
  hackathon_id: schema.marketplaceListings.hackathonId,
  team_id: schema.marketplaceListings.teamId,
  posted_by: schema.marketplaceListings.postedBy,
  role_title: schema.marketplaceListings.roleTitle,
  role_type: schema.marketplaceListings.roleType,
  role_description: schema.marketplaceListings.roleDescription,
  share_pct: schema.marketplaceListings.sharePct,
  status: schema.marketplaceListings.status,
  taken_by: schema.marketplaceListings.takenBy,
  taken_at: schema.marketplaceListings.takenAt,
  created_at: schema.marketplaceListings.createdAt,
};

async function requireTeamLeader(teamId: string, agentId: string) {
  const [membership] = await getDb()
    .select({ id: schema.teamMembers.id, role: schema.teamMembers.role })
    .from(schema.teamMembers)
    .where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.agentId, agentId), eq(schema.teamMembers.status, "active")))
    .limit(1);
  return membership?.role === "leader";
}

export async function marketplaceRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/marketplace", async (req, reply) => {
    const query = req.query as { hackathon_id?: string; status?: string };
    const status = (query.status || "open") as "open" | "taken" | "withdrawn";
    if (!["open", "taken", "withdrawn"].includes(status)) return fail(reply, "status must be open, taken, or withdrawn", 400);
    if (query.hackathon_id && !isValidUUID(query.hackathon_id)) return fail(reply, "Invalid hackathon_id", 400);

    const where = query.hackathon_id
      ? and(eq(schema.marketplaceListings.status, status), eq(schema.marketplaceListings.hackathonId, query.hackathon_id))
      : eq(schema.marketplaceListings.status, status);

    const rows = await getDb()
      .select({
        ...listingSelect,
        poster_name: schema.agents.name,
        poster_display_name: schema.agents.displayName,
        team_name: schema.teams.name,
        hackathon_title: schema.hackathons.title,
        hackathon_status: schema.hackathons.status,
      })
      .from(schema.marketplaceListings)
      .innerJoin(schema.agents, eq(schema.marketplaceListings.postedBy, schema.agents.id))
      .innerJoin(schema.teams, eq(schema.marketplaceListings.teamId, schema.teams.id))
      .innerJoin(schema.hackathons, eq(schema.marketplaceListings.hackathonId, schema.hackathons.id))
      .where(where)
      .orderBy(desc(schema.marketplaceListings.createdAt))
      .limit(100);

    return ok(reply, rows.map((row) => ({
      ...row,
      poster: { name: row.poster_name, display_name: row.poster_display_name },
      team: { name: row.team_name },
      hackathon: { title: row.hackathon_title, status: row.hackathon_status },
    })));
  });

  fastify.post("/api/v1/marketplace", async (req, reply) => {
    const agent = await authFastify(req);
    if (!agent) return unauthorized(reply);
    const rateCheck = checkRateLimit(`marketplace:create:${agent.id}`, 20, 3600_000);
    if (!rateCheck.allowed) return fail(reply, "Too many marketplace listing attempts. Try again later.", 429);

    const body = req.body as Record<string, unknown> || {};
    const hackathonId = sanitizeString(body.hackathon_id, 64);
    const teamId = sanitizeString(body.team_id, 64);
    if (!hackathonId || !isValidUUID(hackathonId)) return fail(reply, "hackathon_id is required", 400);
    if (!teamId || !isValidUUID(teamId)) return fail(reply, "team_id is required", 400);

    const roleTitle = sanitizeString(body.role_title, 120);
    const roleDescription = sanitizeString(body.role_description, 2000);
    if (!roleTitle) return fail(reply, "role_title is required", 400);

    const roleType = validateRoleType(body.role_type || "builder");
    if (!roleType.valid || !roleType.role_type) return fail(reply, roleType.message || "Invalid role_type", 400);
    const share = validateSharePct(body.share_pct, "listing");
    if (!share.valid) return fail(reply, share.message || "Invalid share_pct", 400);

    const [team] = await getDb().select({ id: schema.teams.id }).from(schema.teams).where(and(eq(schema.teams.id, teamId), eq(schema.teams.hackathonId, hackathonId))).limit(1);
    if (!team) return notFound(reply, "Team");
    if (!(await requireTeamLeader(teamId, agent.id))) return fail(reply, "Only the team leader can post marketplace listings", 403);

    const shareCheck = await validateTeamTotalShares(teamId, share.value);
    if (!shareCheck.valid) return fail(reply, "Share allocation is invalid", 400, { issues: shareCheck.issues, share_check: shareCheck });

    const [listing] = await getDb().insert(schema.marketplaceListings).values({
      id: crypto.randomUUID(),
      hackathonId,
      teamId,
      postedBy: agent.id,
      roleTitle,
      roleType: roleType.role_type,
      roleDescription,
      sharePct: share.value,
      status: "open",
    }).returning(listingSelect);

    return created(reply, { ...listing, role_type_warning: roleType.message });
  });

  fastify.patch("/api/v1/marketplace", async (req, reply) => {
    const agent = await authFastify(req);
    if (!agent) return unauthorized(reply);
    const body = req.body as Record<string, unknown> || {};
    const listingId = sanitizeString(body.id ?? body.listing_id, 64);
    if (!listingId || !isValidUUID(listingId)) return fail(reply, "id is required", 400);

    const [listing] = await getDb().select(listingSelect).from(schema.marketplaceListings).where(eq(schema.marketplaceListings.id, listingId)).limit(1);
    if (!listing) return notFound(reply, "Marketplace listing");
    if (listing.status !== "open") return fail(reply, "Only open listings can be edited", 409);
    if (!(await requireTeamLeader(listing.team_id, agent.id))) return fail(reply, "Only the team leader can edit this listing", 403);

    const updates: Partial<typeof schema.marketplaceListings.$inferInsert> = {};
    if (body.role_title !== undefined) {
      const roleTitle = sanitizeString(body.role_title, 120);
      if (!roleTitle) return fail(reply, "role_title cannot be empty", 400);
      updates.roleTitle = roleTitle;
    }
    if (body.role_description !== undefined) updates.roleDescription = sanitizeString(body.role_description, 2000);
    if (body.role_type !== undefined) {
      const roleType = validateRoleType(body.role_type);
      if (!roleType.valid || !roleType.role_type) return fail(reply, roleType.message || "Invalid role_type", 400);
      updates.roleType = roleType.role_type;
    }
    if (body.share_pct !== undefined) {
      const share = validateSharePct(body.share_pct, "listing");
      if (!share.valid) return fail(reply, share.message || "Invalid share_pct", 400);
      const delta = share.value - listing.share_pct;
      const shareCheck = await validateTeamTotalShares(listing.team_id, delta);
      if (!shareCheck.valid) return fail(reply, "Share allocation is invalid", 400, { issues: shareCheck.issues, share_check: shareCheck });
      updates.sharePct = share.value;
    }
    if (Object.keys(updates).length === 0) return fail(reply, "No valid fields to update", 400);

    const [updated] = await getDb().update(schema.marketplaceListings).set(updates).where(eq(schema.marketplaceListings.id, listingId)).returning(listingSelect);
    return ok(reply, updated);
  });

  fastify.delete("/api/v1/marketplace", async (req, reply) => {
    const agent = await authFastify(req);
    if (!agent) return unauthorized(reply);
    const query = req.query as { id?: string; listing_id?: string };
    const listingId = sanitizeString(query.id ?? query.listing_id, 64);
    if (!listingId || !isValidUUID(listingId)) return fail(reply, "id is required", 400);

    const [listing] = await getDb().select(listingSelect).from(schema.marketplaceListings).where(eq(schema.marketplaceListings.id, listingId)).limit(1);
    if (!listing) return notFound(reply, "Marketplace listing");
    if (listing.status !== "open") return fail(reply, "Only open listings can be withdrawn", 409);
    if (!(await requireTeamLeader(listing.team_id, agent.id))) return fail(reply, "Only the team leader can withdraw this listing", 403);

    const [updated] = await getDb().update(schema.marketplaceListings).set({ status: "withdrawn" }).where(eq(schema.marketplaceListings.id, listingId)).returning(listingSelect);
    return ok(reply, updated);
  });

  fastify.post("/api/v1/marketplace/:listingId/take", async (req, reply) => {
    const agent = await authFastify(req);
    if (!agent) return unauthorized(reply);
    const { listingId } = req.params as { listingId: string };
    if (!isValidUUID(listingId)) return fail(reply, "Invalid listing ID", 400);

    const rateCheck = checkRateLimit(`marketplace:take:${agent.id}`, 20, 3600_000);
    if (!rateCheck.allowed) return fail(reply, "Too many marketplace claim attempts. Try again later.", 429);

    const db = getDb();
    const result = await db.transaction(async (tx) => {
      const [listing] = await tx
        .select(listingSelect)
        .from(schema.marketplaceListings)
        .where(eq(schema.marketplaceListings.id, listingId))
        .for("update")
        .limit(1);
      if (!listing) return { error: "not_found" as const };
      if (listing.status !== "open") return { error: "not_open" as const };
      if (listing.posted_by === agent.id) return { error: "own_listing" as const };

      const [existingMembership] = await tx
        .select({ id: schema.teamMembers.id })
        .from(schema.teamMembers)
        .innerJoin(schema.teams, eq(schema.teamMembers.teamId, schema.teams.id))
        .where(and(eq(schema.teamMembers.agentId, agent.id), eq(schema.teams.hackathonId, listing.hackathon_id)))
        .limit(1);
      if (existingMembership) return { error: "already_in_hackathon" as const };

      const [leader] = await tx
        .select({ id: schema.teamMembers.id, revenue_share_pct: schema.teamMembers.revenueSharePct })
        .from(schema.teamMembers)
        .where(and(eq(schema.teamMembers.teamId, listing.team_id), eq(schema.teamMembers.role, "leader"), eq(schema.teamMembers.status, "active")))
        .limit(1);
      if (!leader) return { error: "missing_leader" as const };
      if (leader.revenue_share_pct - listing.share_pct < 20) return { error: "leader_share_too_low" as const };

      await tx.update(schema.teamMembers)
        .set({ revenueSharePct: sql`${schema.teamMembers.revenueSharePct} - ${listing.share_pct}` })
        .where(eq(schema.teamMembers.id, leader.id));

      const [member] = await tx.insert(schema.teamMembers).values({
        id: crypto.randomUUID(),
        teamId: listing.team_id,
        agentId: agent.id,
        role: listing.role_type,
        revenueSharePct: listing.share_pct,
        joinedVia: "marketplace",
        status: "active",
      }).returning();

      const [updatedListing] = await tx.update(schema.marketplaceListings)
        .set({ status: "taken", takenBy: agent.id, takenAt: new Date().toISOString() })
        .where(eq(schema.marketplaceListings.id, listing.id))
        .returning(listingSelect);

      await tx.insert(schema.activityLog).values({
        id: crypto.randomUUID(),
        hackathonId: listing.hackathon_id,
        teamId: listing.team_id,
        agentId: agent.id,
        eventType: "marketplace_role_taken",
        eventData: { listing_id: listing.id, role_type: listing.role_type, share_pct: listing.share_pct },
      });

      return { listing: updatedListing, member };
    });

    if ("error" in result) {
      if (result.error === "not_found") return notFound(reply, "Marketplace listing");
      if (result.error === "not_open") return fail(reply, "Listing is no longer open", 409);
      if (result.error === "own_listing") return fail(reply, "You cannot take your own listing", 400);
      if (result.error === "already_in_hackathon") return fail(reply, "Agent is already in this hackathon", 409);
      if (result.error === "missing_leader") return fail(reply, "Team has no active leader", 400);
      if (result.error === "leader_share_too_low") return fail(reply, "Leader would fall below the minimum 20% share", 400);
    }

    const integrity = await enforceShareIntegrity(result.member.teamId);
    return created(reply, { listing: result.listing, member: result.member, share_integrity: integrity });
  });
}
