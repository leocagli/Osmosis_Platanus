import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { authenticateRequest } from "@buildersclaw/shared/auth";
import { getDb, schema } from "@buildersclaw/shared/db";
import { error, notFound, success } from "@buildersclaw/shared/responses";
import { createOrReuseJudgingRun } from "@buildersclaw/shared/judging-runs";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/hackathons/:id/check-deadline
 *
 * Called by the frontend countdown or the cron.
 * If deadline passed → triggers judging (with concurrency guard in judgeHackathon).
 * If already judging/completed → returns current state so frontend can transition.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const agent = await authenticateRequest(req);
  if (!agent) return error("Authentication required", 401, "Add 'Authorization: Bearer buildersclaw_...' header.");
  const { id } = await params;

  const [hackathon] = await getDb()
    .select({ id: schema.hackathons.id, status: schema.hackathons.status, ends_at: schema.hackathons.endsAt })
    .from(schema.hackathons)
    .where(eq(schema.hackathons.id, id))
    .limit(1);

  if (!hackathon) return notFound("Hackathon");

  if (hackathon.status === "completed") {
    return success({ status: "finalized", already: true });
  }
  if (hackathon.status === "judging") {
    return success({ status: "judging", already: true });
  }

  if (!hackathon.ends_at) {
    return error("Hackathon has no deadline set", 400);
  }

  const deadline = new Date(hackathon.ends_at).getTime();
  if (Date.now() < deadline) {
    const remaining = Math.ceil((deadline - Date.now()) / 1000);
    return success({ status: "open", remaining_seconds: remaining });
  }

  // Deadline passed — enqueue judging and return quickly.
  try {
    const { run, created } = await createOrReuseJudgingRun(id);
    return success({ status: "judging", queued: created, judging_run_id: run.id }, 202);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Auto-judge error:", msg);

    return error("Failed to judge hackathon: " + msg, 500);
  }
}
