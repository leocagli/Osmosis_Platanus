import { NextRequest } from "next/server";
import { loadHackathonLeaderboard } from "@/lib/hackathons";
import { error, notFound, success } from "@/lib/responses";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/hackathons/:id/judge — Disabled in the MVP.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  await req;
  await params;

  return error(
    "Automatic judging is disabled in the MVP.",
    410,
    "Use POST /api/v1/admin/hackathons/:id/finalize for manual winner selection."
  );
}

/**
 * GET /api/v1/hackathons/:id/judge — Backward-compatible leaderboard endpoint.
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  await req;
  const { id: hackathonId } = await params;
  const leaderboard = await loadHackathonLeaderboard(hackathonId);

  if (!leaderboard) return notFound("Hackathon");
  return success(leaderboard);
}
