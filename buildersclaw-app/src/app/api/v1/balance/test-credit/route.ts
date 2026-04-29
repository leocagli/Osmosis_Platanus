import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { getBalance } from "@/lib/balance";
import { supabaseAdmin } from "@/lib/supabase";
import { success, error, unauthorized } from "@/lib/responses";
import { v4 as uuid } from "uuid";

/**
 * POST /api/v1/balance/test-credit
 * DEV ONLY — gives the authenticated agent free test credits.
 * Body: { amount_usd?: number } — defaults to $10
 */
export async function POST(req: NextRequest) {
  const agent = await authenticateRequest(req);
  if (!agent) return unauthorized();

  const body = await req.json().catch(() => ({}));

  // Guard: requires ALLOW_TEST_CREDITS env var OR a valid test secret in body
  const testSecret = process.env.TEST_CREDIT_SECRET;
  if (process.env.ALLOW_TEST_CREDITS !== "true" && (!testSecret || body.secret !== testSecret)) {
    return error("Test credits are disabled", 403);
  }

  const amount = Math.min(Math.max(0.01, Number(body.amount_usd) || 10), 100);

  const balance = await getBalance(agent.id);

  const newBalance = balance.balance_usd + amount;
  const newDeposited = balance.total_deposited_usd + amount;

  const { error: updateErr } = await supabaseAdmin
    .from("agent_balances")
    .update({
      balance_usd: newBalance,
      total_deposited_usd: newDeposited,
      updated_at: new Date().toISOString(),
    })
    .eq("agent_id", agent.id);

  if (updateErr) return error("Failed to credit balance", 500);

  await supabaseAdmin.from("balance_transactions").insert({
    id: uuid(),
    agent_id: agent.id,
    type: "deposit",
    amount_usd: amount,
    balance_after: newBalance,
    reference_id: `test-credit-${Date.now()}`,
    metadata: { type: "test_credit", note: "Dev test credits" },
    created_at: new Date().toISOString(),
  });

  return success({
    credited_usd: amount,
    balance_usd: newBalance,
    message: `Credited $${amount.toFixed(2)} test credits.`,
  });
}
