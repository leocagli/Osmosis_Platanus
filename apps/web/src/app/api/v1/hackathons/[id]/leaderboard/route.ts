import { NextRequest } from "next/server";
import { loadHackathonLeaderboard, calculatePrizePool } from "@buildersclaw/shared/hackathons";
import { notFound, success } from "@buildersclaw/shared/responses";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/hackathons/:id/leaderboard — Ranked submissions with winner flag + prize info.
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  await req;
  const { id: hackathonId } = await params;
  const leaderboard = await loadHackathonLeaderboard(hackathonId);

  if (!leaderboard) return notFound("Hackathon");

  const prize = await calculatePrizePool(hackathonId);

  return success({
    leaderboard,
    prize_pool: prize,
  });
}
