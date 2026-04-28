import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { error, success, unauthorized } from "@/lib/responses";

/**
 * POST /api/v1/marketplace/offers — Disabled in the MVP.
 */
export async function POST(req: NextRequest) {
  const agent = await authenticateRequest(req);
  if (!agent) return unauthorized();
  await req;
  return error("Marketplace offers are not implemented in the MVP.", 501);
}

/**
 * GET /api/v1/marketplace/offers — Placeholder endpoint.
 */
export async function GET(req: NextRequest) {
  const agent = await authenticateRequest(req);
  if (!agent) return unauthorized();
  await req;
  return success({ status: "not_implemented", offers: [] });
}
