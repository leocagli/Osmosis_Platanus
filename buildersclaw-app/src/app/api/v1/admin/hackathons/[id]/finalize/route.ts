import { NextRequest } from "next/server";
import { v4 as uuid } from "uuid";
import { authenticateAdminRequest } from "@/lib/auth";
import { finalizeHackathonOnChain, normalizeAddress } from "@/lib/chain";
import { formatHackathon, loadHackathonLeaderboard, parseHackathonMeta, sanitizeString, serializeHackathonMeta } from "@/lib/hackathons";
import { error, notFound, success } from "@/lib/responses";
import { supabaseAdmin } from "@/lib/supabase";
import { telegramHackathonFinalized } from "@/lib/telegram";
import { validateWinnerShares, validateWalletAddress, isValidUUID, WINNER_MIN_BPS } from "@/lib/validation";

type RouteParams = { params: Promise<{ id: string }> };

function getConfiguredChainId(): number | null {
  const parsed = Number.parseInt(process.env.CHAIN_ID || "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

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

  let finalizeResult;
  try {
    finalizeResult = await finalizeHackathonOnChain({
      contractAddress: meta.contract_address,
      winners: winners.map((w) => ({ wallet: w.wallet, shareBps: w.shareBps })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to finalize hackathon on-chain";
    return error(message, 400);
  }

  const finalizedAt = new Date().toISOString();
  const notes = sanitizeString(body.notes, 4000);
  const leaderAgentId = members.find((m) => m.role === "leader")?.agent_id ?? members[0].agent_id;

  const { data: updatedHackathon, error: updateErr } = await supabaseAdmin
    .from("hackathons")
    .update({
      status: "completed",
      updated_at: finalizedAt,
      judging_criteria: serializeHackathonMeta({
        ...meta,
        chain_id: meta.chain_id ?? getConfiguredChainId(),
        winner_agent_id: leaderAgentId,
        winner_team_id: winnerTeamId,
        winners: winners.map((w) => ({
          agent_id: w.agent_id,
          wallet: w.wallet,
          share_bps: w.shareBps,
        })),
        finalization_notes: notes,
        finalized_at: finalizedAt,
        finalize_tx_hash: finalizeResult.txHash,
        scores: body.scores ?? meta.scores,
      }),
    })
    .eq("id", hackathonId)
    .select("*")
    .single();

  if (updateErr) return error("Failed to finalize hackathon", 500);

  await supabaseAdmin.from("teams").update({ status: "judged" }).eq("id", winnerTeamId!);

  await supabaseAdmin.from("activity_log").insert({
    id: uuid(),
    hackathon_id: hackathonId,
    team_id: winnerTeamId,
    agent_id: leaderAgentId,
    event_type: "hackathon_finalized",
    event_data: {
      winner_team_id: winnerTeamId,
      winners: winners.map((w) => ({
        agent_id: w.agent_id,
        wallet: w.wallet,
        share_bps: w.shareBps,
      })),
      finalize_tx_hash: finalizeResult.txHash,
      contract_address: meta.contract_address,
      notes,
    },
  });

  const leaderboard = await loadHackathonLeaderboard(hackathonId);

  // Notify Telegram (fire-and-forget)
  try {
    let winnerName: string | null = null;
    if (leaderAgentId) {
      const { data: agentRow } = await supabaseAdmin
        .from("agents").select("display_name, name").eq("id", leaderAgentId).single();
      winnerName = agentRow?.display_name || agentRow?.name || null;
    }
    telegramHackathonFinalized({
      id: hackathonId,
      title: hackathon.title,
      winner_name: winnerName,
    }).catch(() => {});
  } catch { /* best-effort */ }

  return success({
    hackathon: formatHackathon(updatedHackathon as Record<string, unknown>),
    winner_team_id: winnerTeamId,
    winners: winners.map((w) => ({
      agent_id: w.agent_id,
      wallet: w.wallet,
      share_bps: w.shareBps,
    })),
    notes,
    leaderboard,
  });
}
