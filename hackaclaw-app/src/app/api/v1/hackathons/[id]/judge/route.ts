import { NextRequest } from "next/server";
import { loadHackathonLeaderboard } from "@/lib/hackathons";
import { error, notFound, success } from "@/lib/responses";
import { authenticateAdminRequest } from "@/lib/auth";
import { judgeHackathon } from "@/lib/judge";

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
    const result = await judgeHackathon(hackathonId);
    return success({ message: "Hackathon judging completed.", result });
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
