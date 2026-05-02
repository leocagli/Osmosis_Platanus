import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { authenticateAdminRequest } from "@buildersclaw/shared/auth";
import { getDb, schema } from "@buildersclaw/shared/db";
import { error, notFound, success } from "@buildersclaw/shared/responses";
import { createOrReuseJudgingRun } from "@buildersclaw/shared/judging-runs";
import { isValidUUID } from "@buildersclaw/shared/validation";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/admin/hackathons/:id/judge — Trigger AI judging for a hackathon.
 * 
 * This fetches all submitted repos, analyzes the code, scores each submission,
 * and picks the winner. The hackathon moves to "completed" status.
 * 
 * Requires admin auth OR the hackathon creator's agent key.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id: hackathonId } = await params;

  // ── SECURITY: Validate ID format ──
  if (!isValidUUID(hackathonId)) {
    return error("Invalid hackathon ID format", 400);
  }

  const db = getDb();

  // Allow admin OR check if it's the creator
  const isAdmin = authenticateAdminRequest(req);
  
  if (!isAdmin) {
    // Check if the auth header matches the creator's agent key
    const auth = req.headers.get("authorization");
    if (!auth?.startsWith("Bearer buildersclaw_") && !auth?.startsWith("Bearer hackaclaw_")) {
      return error("Admin or hackathon creator authentication required", 401);
    }
    
    const apiKeyRaw = auth.replace("Bearer ", "");
    const crypto = await import("crypto");
    const hash = crypto.createHash("sha256").update(apiKeyRaw).digest("hex");
    
    const [agent] = await db
      .select({ id: schema.agents.id })
      .from(schema.agents)
      .where(eq(schema.agents.apiKeyHash, hash))
      .limit(1);

    if (!agent) {
      return error("Invalid authentication", 401);
    }

    const [hackathonAuth] = await db
      .select({ created_by: schema.hackathons.createdBy })
      .from(schema.hackathons)
      .where(eq(schema.hackathons.id, hackathonId))
      .limit(1);

    if (!hackathonAuth) return notFound("Hackathon");
    if (hackathonAuth.created_by !== agent.id) {
      return error("Only the hackathon creator or admin can trigger judging", 403);
    }
  }
  
  const [hackathon] = await db
    .select()
    .from(schema.hackathons)
    .where(eq(schema.hackathons.id, hackathonId))
    .limit(1);

  if (!hackathon) return notFound("Hackathon");

  // Check if there are any VIABLE submissions (not just entries)
  const allSubs = await db
    .select({
      id: schema.submissions.id,
      status: schema.submissions.status,
      preview_url: schema.submissions.previewUrl,
      build_log: schema.submissions.buildLog,
    })
    .from(schema.submissions)
    .where(eq(schema.submissions.hackathonId, hackathonId));

  if (!allSubs || allSubs.length === 0) {
    return error("No submissions to judge. Wait for builders to submit their repos.", 400);
  }

  // Check if any submission has a valid repo URL
  const viableCount = allSubs.filter(sub => {
    if (sub.status !== "completed") return false;
    let repoUrl: string | null = null;
    try {
      const meta = JSON.parse(sub.build_log || "{}");
      repoUrl = meta.repo_url || meta.project_url || null;
    } catch { /* ignore */ }
    if (!repoUrl) repoUrl = sub.preview_url;
    return !!repoUrl;
  }).length;

  const count = allSubs.length;

  if (viableCount === 0) {
    return error(
      `Found ${count} submission(s) but none have valid repository URLs. ` +
      `Teams must submit a GitHub repo URL (POST /api/v1/hackathons/:id/teams/:teamId/submit with repo_url). ` +
      `Judging will skip submissions without repos to avoid wasting tokens.`,
      400,
      {
        total_submissions: count,
        viable_submissions: 0,
        hint: "Submissions need a valid repo_url pointing to a GitHub repository.",
      },
    );
  }

  try {
    const { run, created } = await createOrReuseJudgingRun(hackathonId);
    return success({
      message: created ? "Judging accepted and queued." : "Judging is already queued or running.",
      judging_run_id: run.id,
      status: run.status,
      job_id: run.job_id,
      total_submissions: count,
      viable_submissions: viableCount,
    }, 202);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Judging failed";
    console.error(`[JUDGE] Error judging hackathon ${hackathonId}:`, err);
    return error(`Judging failed: ${message}`, 500);
  }
}
