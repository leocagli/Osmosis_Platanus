import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { getBalance } from "@/lib/balance";
import { supabaseAdmin } from "@/lib/supabase";
import { success, error, unauthorized } from "@/lib/responses";
import { checkRateLimit } from "@/lib/validation";
import { v4 as uuid } from "uuid";

/**
 * POST /api/v1/balance/test-credit
 * DEV ONLY — gives the authenticated agent free test credits.
 * Body: { amount_usd?: number } — defaults to $10
 *
 * SECURITY: Completely blocked in production.
 * SECURITY: Requires separate TEST_CREDIT_SECRET (must differ from ADMIN_API_KEY).
 * SECURITY: Uses timing-safe comparison for secret validation.
 */
export async function POST(req: NextRequest) {
  const agent = await authenticateRequest(req);
  if (!agent) return unauthorized();

  const body = await req.json().catch(() => ({}));

  // ── SECURITY: Completely disabled in production — NO bypass via env var ──
  if (process.env.NODE_ENV === "production") {
    return error(
      "Test credits are disabled in production. Use POST /api/v1/balance to deposit real funds.",
      403,
    );
  }

  // ── SECURITY: TEST_CREDIT_SECRET must be configured and must differ from ADMIN_API_KEY ──
  const testSecret = process.env.TEST_CREDIT_SECRET;
  const adminKey = process.env.ADMIN_API_KEY;

  if (!testSecret) {
    return error("TEST_CREDIT_SECRET not configured", 500);
  }

  if (testSecret === adminKey) {
    console.error("[SECURITY] TEST_CREDIT_SECRET must be different from ADMIN_API_KEY!");
    return error("Server misconfiguration. Contact admin.", 500);
  }

  // ── SECURITY: Timing-safe secret comparison ──
  const providedSecret = typeof body.secret === "string" ? body.secret : "";
  if (!providedSecret || providedSecret.length !== testSecret.length) {
    return error("Test credits require a valid secret", 403);
  }

  const crypto = await import("crypto");
  const secretsMatch = crypto.timingSafeEqual(
    Buffer.from(providedSecret, "utf-8"),
    Buffer.from(testSecret, "utf-8")
  );
  if (!secretsMatch) {
    return error("Test credits require a valid secret", 403);
  }

  // Rate limit: max 3 test credits per agent per hour
  const rateCheck = checkRateLimit(`test-credit:${agent.id}`, 3, 3600_000);
  if (!rateCheck.allowed) {
    return error("Too many test credit requests. Try again later.", 429);
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
