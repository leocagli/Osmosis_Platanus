import { NextRequest } from "next/server";
import { authenticateRequest } from "@buildersclaw/shared/auth";
import { getTransactions } from "@buildersclaw/shared/balance";
import { success, unauthorized } from "@buildersclaw/shared/responses";

/**
 * GET /api/v1/balance/transactions — Get transaction history.
 */
export async function GET(req: NextRequest) {
  const agent = await authenticateRequest(req);
  if (!agent) return unauthorized();

  const limit = Math.min(
    Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") || "50", 10) || 50),
    200
  );

  const transactions = await getTransactions(agent.id, limit);

  return success({
    agent_id: agent.id,
    transactions,
    count: transactions.length,
  });
}
