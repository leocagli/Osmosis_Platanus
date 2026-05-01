import { NextRequest } from "next/server";
import { authenticateAdminRequest } from "@/lib/auth";
import { normalizeAddress } from "@/lib/chain";
import { parseHackathonMeta, sanitizeString } from "@/lib/hackathons";
import { error, notFound, success } from "@/lib/responses";
import { supabaseAdmin } from "@/lib/supabase";
import { createOrReuseFinalizationRun } from "@/lib/finalization";
import { validateWinnerShares, isValidUUID, WINNER_MIN_BPS } from "@/lib/validation";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/admin/hackathons/:id/finalize — Select a winning team and finalize on-chain.
 *
 * Body: { winner_team_id } or { winner_agent_id } (backward compat)
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  if (!authenticateAdminRequest(req)) {
    return error("Admin authentication required", 401, "Add 'Authorization: Bearer <ADMIN_API_KEY>' header.");
  }

  const { id: hackathonId } = await params;

  if (!isValidUUID(hackathonId)) {
    return error("Invalid hackathon ID format", 400);
  }

  const { data: hackathon } = await supabaseAdmin.from("hackathons").select("*").eq("id", hackathonId).single();

  if (!hackathon) return notFound("Hackathon");

  // ── SECURITY: Prevent double finalization ──
  if (hackathon.status === "completed") {
    const existingMeta = parseHackathonMeta(hackathon.judging_criteria);
    return error(
      "Hackathon is already finalized",
      409,
      {
        finalized_at: existingMeta.finalized_at,
        finalize_tx_hash: existingMeta.finalize_tx_hash,
        winner_team_id: existingMeta.winner_team_id,
      }
    );
  }

  const body = await req.json().catch(() => ({}));
  let winnerTeamId = sanitizeString(body.winner_team_id, 64);
  const winnerAgentId = sanitizeString(body.winner_agent_id, 64);

  if (!winnerTeamId && !winnerAgentId) {
    return error("winner_team_id or winner_agent_id is required", 400);
  }

  const meta = parseHackathonMeta(hackathon.judging_criteria);
  if (!meta.contract_address) {
    return error("Hackathon does not have a configured contract address", 400);
  }

  // If only winner_agent_id provided, look up their team (backward compat)
  if (!winnerTeamId && winnerAgentId) {
    const { data: membership } = await supabaseAdmin
      .from("team_members")
      .select("team_id, teams!inner(hackathon_id)")
      .eq("agent_id", winnerAgentId)
      .eq("teams.hackathon_id", hackathonId)
      .single();

    if (!membership) return error("winner_agent_id is not registered in this hackathon", 400);
    winnerTeamId = membership.team_id;
  }

  // Load all active team members with their wallets
  const { data: members } = await supabaseAdmin
    .from("team_members")
    .select("agent_id, revenue_share_pct, role, agents!inner(wallet_address)")
    .eq("team_id", winnerTeamId!)
    .eq("status", "active");

  if (!members || members.length === 0) {
    return error("Winning team has no active members", 400);
  }

  // Validate every member has a wallet
  const missingWallets = members.filter((m) => {
    const agent = m.agents as unknown as { wallet_address?: string | null } | null;
    return !agent?.wallet_address;
  });
  if (missingWallets.length > 0) {
    const ids = missingWallets.map((m) => m.agent_id).join(", ");
    return error(
      `Team members missing wallet addresses: ${ids}. All members must have wallets for on-chain prize splitting.`,
      400,
    );
  }

  // Convert revenue_share_pct (0-100) to basis points (0-10000) with rounding
  const rawBps = members.map((m) => Math.round(m.revenue_share_pct * 100));
  const totalRaw = rawBps.reduce((sum, v) => sum + v, 0);
  // Adjust last member to ensure exact sum of 10000
  if (totalRaw !== 10000) {
    rawBps[rawBps.length - 1] += 10000 - totalRaw;
  }

  const winners = members.map((m, i) => {
    const agent = m.agents as unknown as { wallet_address: string };
    let wallet: string;
    try {
      wallet = normalizeAddress(agent.wallet_address);
    } catch {
      throw new Error(`Invalid wallet address for agent ${m.agent_id}`);
    }
    return { wallet, shareBps: rawBps[i], agent_id: m.agent_id };
  });

  // ── SECURITY: Validate winner shares before on-chain finalization ──
  const shareValidation = validateWinnerShares(winners);
  if (!shareValidation.valid) {
    return error(
      `Winner share validation failed: ${shareValidation.issues.join("; ")}`,
      400,
      {
        issues: shareValidation.issues,
        winners: winners.map((w) => ({
          agent_id: w.agent_id,
          wallet: w.wallet,
          share_bps: w.shareBps,
          share_pct: (w.shareBps / 100).toFixed(1) + "%",
        })),
        min_bps: WINNER_MIN_BPS,
        min_pct: (WINNER_MIN_BPS / 100).toFixed(1) + "%",
      }
    );
  }

  // ── SECURITY: Check for duplicate wallet addresses (different agents, same wallet = scam) ──
  const walletSet = new Set(winners.map((w) => w.wallet.toLowerCase()));
  if (walletSet.size !== winners.length) {
    return error(
      "Duplicate wallet addresses detected. Each team member must have a unique wallet.",
      400
    );
  }

  const notes = sanitizeString(body.notes, 4000);
  const leaderAgentId = members.find((m) => m.role === "leader")?.agent_id ?? members[0].agent_id;

  // Idempotency guard: reuse existing in-flight run instead of broadcasting again.
  try {
    const { run, created } = await createOrReuseFinalizationRun({
      hackathonId,
      winnerTeamId: winnerTeamId!,
      winnerAgentId: leaderAgentId,
      winners,
      notes,
      scores: body.scores ?? meta.scores,
    });

    return success({
      message: created ? "Escrow finalization accepted and queued." : "Escrow finalization is already queued or running.",
      finalization_run_id: run.id,
      status: run.status,
      job_id: run.job_id,
      tx_hash: run.tx_hash,
      winner_team_id: winnerTeamId,
      winners: winners.map((w) => ({ agent_id: w.agent_id, wallet: w.wallet, share_bps: w.shareBps })),
      notes,
    }, 202);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to queue escrow finalization";
    return error(message, 500);
  }
}
