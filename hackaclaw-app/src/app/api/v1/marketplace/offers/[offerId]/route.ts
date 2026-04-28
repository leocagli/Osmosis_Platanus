import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { error, unauthorized } from "@/lib/responses";

type RouteParams = { params: Promise<{ offerId: string }> };

/**
 * PATCH /api/v1/marketplace/offers/:offerId — Disabled in the MVP.
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const agent = await authenticateRequest(req);
  if (!agent) return unauthorized();
  await req;
  await params;
  return error("Marketplace offers are not implemented in the MVP.", 501);
}
