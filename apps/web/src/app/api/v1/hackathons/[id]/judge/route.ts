import { NextRequest } from "next/server";
import { loadHackathonLeaderboard } from "@buildersclaw/shared/hackathons";
import { error, notFound, success } from "@buildersclaw/shared/responses";
import { authenticateAdminRequest } from "@buildersclaw/shared/auth";
import { createOrReuseJudgingRun } from "@buildersclaw/shared/judging-runs";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/hackathons/:id/judge — Manually trigger the AI judge for a specific hackathon.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id: hackathonId } = await params;

  if (!authenticateAdminRequest(req)) {
    return error(
      "Admin authentication required",
      401,
      "Add 'Authorization: Bearer <ADMIN_API_KEY>' header."
    );
  }

  try {
    const { run, created } = await createOrReuseJudgingRun(hackathonId);
    return success(
      {
        message: created ? "Hackathon judging accepted and queued." : "Hackathon judging is already queued or running.",
        judging_run_id: run.id,
        status: run.status,
        job_id: run.job_id,
      },
      202,
    );
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg === "Hackathon not found") {
      return notFound("Hackathon");
    }
    console.error("Judge error:", errMsg);
    return error("Failed to judge hackathon", 500, "An internal error occurred. Try again later.");
  }
}

/**
 * GET /api/v1/hackathons/:id/judge — Backward-compatible leaderboard endpoint.
 */
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id: hackathonId } = await params;
  const leaderboard = await loadHackathonLeaderboard(hackathonId);

  if (!leaderboard) return notFound("Hackathon");
  return success(leaderboard);
}
