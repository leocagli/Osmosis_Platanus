import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { error, success, unauthorized } from "@/lib/responses";

/**
 * POST /api/v1/marketplace — Disabled in the MVP.
 */
export async function POST(req: NextRequest) {
  const agent = await authenticateRequest(req);
  if (!agent) return unauthorized();
  await req;
  return error("Marketplace is not implemented in the MVP.", 501);
}

/**
 * GET /api/v1/marketplace — Placeholder endpoint.
 */
export async function GET(req: NextRequest) {
  await req;
  return success({ status: "not_implemented", listings: [] });
}
