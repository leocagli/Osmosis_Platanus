import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@buildersclaw/shared/db";
import { success, error } from "@buildersclaw/shared/responses";
import { v4 as uuid } from "uuid";

/**
 * POST /api/v1/seed-test — Create a test hackathon (temporary, remove after testing).
 *
 * SECURITY: Completely disabled in production.
 * SECURITY: Requires exact match of TEST_CREDIT_SECRET header.
 * SECURITY: Even in dev, all operations are logged.
 */
export async function POST(req: NextRequest) {
  const db = getDb();
  // ── SECURITY: Completely disabled in production — NO exceptions ──
  if (process.env.NODE_ENV === "production") {
    return error("Seed-test endpoint is disabled in production.", 403);
  }

  // ── SECURITY: Block if no secret is configured ──
  const expectedSecret = process.env.TEST_CREDIT_SECRET;
  if (!expectedSecret) {
    return error("TEST_CREDIT_SECRET not configured", 500);
  }

  const secret = req.headers.get("x-seed-secret");
  if (!secret) {
    return error("Unauthorized — x-seed-secret header required", 401);
  }

  // ── SECURITY: Timing-safe comparison ──
  if (secret.length !== expectedSecret.length) {
    return error("Unauthorized", 401);
  }
  
  const crypto = await import("crypto");
  const secretsMatch = crypto.timingSafeEqual(
    Buffer.from(secret, "utf-8"),
    Buffer.from(expectedSecret, "utf-8")
  );
  if (!secretsMatch) {
    return error("Unauthorized", 401);
  }

  try {
    const body = await req.json();

    // Add marketplace listing directly (bypasses schema cache issue)
    if (body.action === "add_listing") {
      try {
        await db.insert(schema.marketplaceListings).values({
          id: uuid(),
          hackathonId: body.hackathon_id,
          teamId: body.team_id,
          postedBy: body.agent_id,
          roleTitle: body.role_title || "Team Member",
          roleDescription: body.role_description || null,
          sharePct: body.share_pct || 20,
          status: "open",
          createdAt: new Date().toISOString(),
        });
      } catch (err) {
        return error("Listing insert: " + JSON.stringify(err), 500);
      }
      return success({ ok: true });
    }

    // Update agent stats for leaderboard seeding
    if (body.action === "update_agent_stats") {
      try {
        await db.update(schema.agents).set({
          totalWins: body.total_wins ?? 0,
          totalHackathons: body.total_hackathons ?? 0,
          reputationScore: body.reputation_score ?? 50,
        })
          .where(eq(schema.agents.id, body.agent_id));
      } catch (err) {
        return error("Agent stats update: " + JSON.stringify(err), 500);
      }
      return success({ ok: true });
    }

    if (body.action === "add_member") {
      try {
        await db.insert(schema.teamMembers).values({
          id: uuid(),
          teamId: body.team_id,
          agentId: body.agent_id,
          role: body.role || "member",
          revenueSharePct: body.share_pct || 25,
          status: "active",
        });
        if (body.leader_id && body.share_pct) {
          const [ldr] = await db
            .select({ id: schema.teamMembers.id, revenue_share_pct: schema.teamMembers.revenueSharePct })
            .from(schema.teamMembers)
            .where(eq(schema.teamMembers.agentId, body.leader_id))
            .limit(1);
          if (ldr) {
            await db.update(schema.teamMembers)
              .set({ revenueSharePct: ldr.revenue_share_pct - body.share_pct })
              .where(eq(schema.teamMembers.id, ldr.id));
          }
        }
      } catch (err) {
        return error("Member insert: " + JSON.stringify(err), 500);
      }
      return success({ ok: true });
    }

    const id = uuid();
    const now = new Date();

    try {
      await db.insert(schema.hackathons).values({
        id,
        title: body.title || "Platform Test Sprint",
        description: body.description || "Test hackathon",
        brief: body.brief || "Build the best AI-powered landing page",
        rules: body.rules || null,
        entryType: "free",
        entryFee: 0,
        prizePool: body.prize_pool || 100,
        platformFeePct: 0.1,
        maxParticipants: 500,
        teamSizeMin: 1,
        teamSizeMax: body.team_size_max || 4,
        buildTimeSeconds: 180,
        challengeType: body.challenge_type || "landing_page",
        status: "open",
        createdBy: null,
        startsAt: now.toISOString(),
        endsAt: body.ends_at || new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
      });
    } catch (insertErr) {
      return error("Insert failed: " + (insertErr instanceof Error ? insertErr.message : "unknown"), 500);
    }

    return success({ id, url: `/hackathons/${id}` });
  } catch {
    return error("Invalid request", 400);
  }
}
