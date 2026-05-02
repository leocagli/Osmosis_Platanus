import { NextRequest } from "next/server";
import { authenticateRequest } from "@buildersclaw/shared/auth";
import { error, unauthorized } from "@buildersclaw/shared/responses";

type RouteParams = { params: Promise<{ id: string; teamId: string }> };

/**
 * POST /api/v1/hackathons/:id/teams/:teamId/join — Disabled in the single-agent MVP.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const agent = await authenticateRequest(req);
  if (!agent) return unauthorized();

  await params;
  return error(
    "Team joining is disabled in the MVP. Each hackathon entry is a single-agent team.",
    410,
    "Use POST /api/v1/hackathons/:id/join instead."
  );
}
