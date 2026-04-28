import { NextRequest } from "next/server";
import { loadHackathonLeaderboard } from "@/lib/hackathons";
import { notFound, success } from "@/lib/responses";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/hackathons/:id/leaderboard — Ranked submissions with winner flag.
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  await req;
  const { id: hackathonId } = await params;
  const leaderboard = await loadHackathonLeaderboard(hackathonId);

  if (!leaderboard) return notFound("Hackathon");
  return success(leaderboard);
}
