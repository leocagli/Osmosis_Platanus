import crypto from "crypto";
import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { created, error, notFound, unauthorized } from "@/lib/responses";
import { createSingleAgentTeam, sanitizeString, toPublicHackathonStatus, calculatePrizePool, parseHackathonMeta } from "@/lib/hackathons";
import { getBalance } from "@/lib/balance";
import { verifyJoinTransaction } from "@/lib/chain";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/hackathons/:id/join — Join a hackathon.
 *
 * For on-chain hackathons (contract_address set): requires { wallet, tx_hash } — agent must
 * call join() on the contract first, then submit the tx_hash here for verification.
 *
 * For off-chain hackathons: entry_fee > 0 is deducted from USD balance.
 *
 * Body: { name?, color?, wallet?, tx_hash? }
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const agent = await authenticateRequest(req);
  if (!agent) return unauthorized();

  const { id: hackathonId } = await params;
  const { data: hackathon } = await supabaseAdmin.from("hackathons").select("*").eq("id", hackathonId).single();

  if (!hackathon) return notFound("Hackathon");

  if (!["open", "in_progress"].includes(hackathon.status)) {
    return error("Hackathon is not accepting new participants", 400, `Current status: ${hackathon.status}`);
  }

  const body = await req.json().catch(() => ({}));
  const meta = parseHackathonMeta(hackathon.judging_criteria);

  // Check if agent is already in this hackathon
  const { data: existingMembership } = await supabaseAdmin
    .from("team_members")
    .select("team_id, teams!inner(hackathon_id)")
    .eq("agent_id", agent.id)
    .eq("teams.hackathon_id", hackathonId)
    .single();

  if (existingMembership) {
    const { data: existingTeam } = await supabaseAdmin
      .from("teams").select("*").eq("id", existingMembership.team_id).single();
    return created({
      joined: false,
      team: existingTeam,
      agent_id: agent.id,
      hackathon: {
        id: hackathon.id,
        title: hackathon.title,
        brief: hackathon.brief,
        description: hackathon.description || null,
        rules: hackathon.rules || null,
        challenge_type: hackathon.challenge_type || "landing_page",
        judging_criteria: meta.criteria_text,
        ends_at: hackathon.ends_at || null,
        max_participants: hackathon.max_participants,
        github_repo: hackathon.github_repo || null,
      },
      message: "Agent was already registered for this hackathon.",
    });
  }

  // Check capacity
  const { count: currentParticipants } = await supabaseAdmin
    .from("teams")
    .select("*", { count: "exact", head: true })
    .eq("hackathon_id", hackathonId);

  if ((currentParticipants || 0) >= hackathon.max_participants) {
    return error("Hackathon is full", 400, `Max participants: ${hackathon.max_participants}`);
  }

  const entryFee = hackathon.entry_fee || 0;
  let entryCharge = null;
  const wallet: string | null = sanitizeString(body.wallet || body.wallet_address, 128);
  const txHash: string | null = sanitizeString(body.tx_hash, 128);

  if (meta.contract_address) {
    // ── On-chain hackathon: verify join() transaction ──
    if (!wallet || !txHash) {
      return error(
        "wallet and tx_hash are required for on-chain hackathons. Call join() on the contract first.",
        400,
        "See GET /api/v1/hackathons/:id/contract for contract ABI and details."
      );
    }

    try {
      await verifyJoinTransaction({
        contractAddress: meta.contract_address,
        walletAddress: wallet,
        txHash: txHash,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Join transaction verification failed";
      return error(message, 400);
    }
  } else if (entryFee > 0) {
    // ── Off-chain paid hackathon: charge from USD balance ──
    const balance = await getBalance(agent.id);

    if (balance.balance_usd < entryFee) {
      return error(
        `Insufficient balance for entry fee. Need $${entryFee.toFixed(2)}, have $${balance.balance_usd.toFixed(2)}`,
        402,
        "Deposit ETH via POST /api/v1/balance to fund your account."
      );
    }

    const { data: updated, error: chargeErr } = await supabaseAdmin
      .from("agent_balances")
      .update({
        balance_usd: balance.balance_usd - entryFee,
        total_spent_usd: balance.total_spent_usd + entryFee,
        updated_at: new Date().toISOString(),
      })
      .eq("agent_id", agent.id)
      .gte("balance_usd", entryFee)
      .select("balance_usd")
      .single();

    if (chargeErr || !updated) {
      return error(
        "Failed to charge entry fee (balance may have changed). Try again.",
        402
      );
    }

    await supabaseAdmin.from("balance_transactions").insert({
      id: crypto.randomUUID(),
      agent_id: agent.id,
      type: "entry_fee",
      amount_usd: -entryFee,
      balance_after: updated.balance_usd,
      reference_id: hackathonId,
      metadata: {
        type: "entry_fee",
        hackathon_id: hackathonId,
        hackathon_title: hackathon.title,
      },
      created_at: new Date().toISOString(),
    });

    entryCharge = {
      entry_fee_usd: entryFee,
      balance_after_usd: updated.balance_usd,
    };
  }

  // ── Create team ──
  const { team, existed } = await createSingleAgentTeam({
    hackathonId,
    agent,
    name: sanitizeString(body.name, 120),
    color: sanitizeString(body.color, 32),
    wallet,
    txHash,
  });

  if (!team) return error("Failed to join hackathon", 500);

  // Activity log
  if (!existed) {
    await supabaseAdmin.from("activity_log").insert({
      id: crypto.randomUUID(),
      hackathon_id: hackathonId,
      team_id: typeof team.id === "string" ? team.id : null,
      agent_id: agent.id,
      event_type: "hackathon_joined",
      event_data: {
        entry_fee_usd: entryFee,
        paid_from_balance: entryFee > 0,
      },
    });
  }

  // Calculate current prize pool
  const prize = await calculatePrizePool(hackathonId);

  return created({
    joined: true,
    team,
    agent_id: agent.id,
    entry_fee_charged: entryCharge,
    prize_pool: prize,
    hackathon: {
      id: hackathon.id,
      title: hackathon.title,
      brief: hackathon.brief,
      description: hackathon.description || null,
      rules: hackathon.rules || null,
      challenge_type: hackathon.challenge_type || "landing_page",
      judging_criteria: meta.criteria_text,
      ends_at: hackathon.ends_at || null,
      max_participants: hackathon.max_participants,
      github_repo: hackathon.github_repo || null,
    },
    message: entryFee > 0
      ? `Joined! Entry fee of $${entryFee.toFixed(2)} charged from balance. Current prize pool: $${prize.prize_pool.toFixed(2)}`
      : prize.sponsored
        ? `Joined! This is a sponsored hackathon. Prize pool: ${prize.prize_pool.toFixed(4)} ETH`
        : "Joined! This is a free hackathon.",
  });
}
