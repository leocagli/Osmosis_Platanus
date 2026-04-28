import { NextRequest } from "next/server";
import { v4 as uuid } from "uuid";
import { authenticateAdminRequest } from "@/lib/auth";
import { finalizeHackathonOnChain, normalizeAddress } from "@/lib/chain";
import { formatHackathon, loadHackathonLeaderboard, parseHackathonMeta, sanitizeString, serializeHackathonMeta } from "@/lib/hackathons";
import { error, notFound, success } from "@/lib/responses";
import { supabaseAdmin } from "@/lib/supabase";
import { telegramHackathonFinalized } from "@/lib/telegram";

type RouteParams = { params: Promise<{ id: string }> };

function getConfiguredChainId(): number | null {
  const parsed = Number.parseInt(process.env.CHAIN_ID || "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * POST /api/v1/admin/hackathons/:id/finalize — Manually select a winner and optional scores.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  if (!authenticateAdminRequest(req)) {
    return error("Admin authentication required", 401, "Add 'Authorization: Bearer <ADMIN_API_KEY>' header.");
  }

  const { id: hackathonId } = await params;
  const { data: hackathon } = await supabaseAdmin.from("hackathons").select("*").eq("id", hackathonId).single();

  if (!hackathon) return notFound("Hackathon");

  const body = await req.json().catch(() => ({}));
  const winnerAgentId = sanitizeString(body.winner_agent_id, 64);
  if (!winnerAgentId) return error("winner_agent_id is required", 400);

  const meta = parseHackathonMeta(hackathon.judging_criteria);
  if (!meta.contract_address) {
    return error("Hackathon does not have a configured contract address", 400);
  }

  const { data: winningMembership } = await supabaseAdmin
    .from("team_members")
    .select("team_id, teams!inner(hackathon_id), agents!inner(wallet_address)")
    .eq("agent_id", winnerAgentId)
    .eq("teams.hackathon_id", hackathonId)
    .single();

  if (!winningMembership) return error("winner_agent_id is not registered in this hackathon", 400);

  const { data: winningTeam } = await supabaseAdmin
    .from("teams")
    .select("id, hackathon_id")
    .eq("id", winningMembership.team_id)
    .eq("hackathon_id", hackathonId)
    .single();

  if (!winningTeam) return error("winner_agent_id is not registered in this hackathon", 400);

  const winningAgent = winningMembership.agents as { wallet_address?: string | null } | null;
  if (!winningAgent?.wallet_address) {
    return error("Winning agent does not have a registered wallet address", 400);
  }

  let winnerWallet: string;
  try {
    winnerWallet = normalizeAddress(winningAgent.wallet_address);
  } catch {
    return error("Winning agent wallet address is invalid", 400);
  }

  let finalizeResult;
  try {
    finalizeResult = await finalizeHackathonOnChain({
      contractAddress: meta.contract_address,
      winnerWallet,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to finalize hackathon on-chain";
    return error(message, 400);
  }

  const finalizedAt = new Date().toISOString();
  const notes = sanitizeString(body.notes, 4000);

  const { data: updatedHackathon, error: updateErr } = await supabaseAdmin
    .from("hackathons")
    .update({
      status: "completed",
      updated_at: finalizedAt,
      judging_criteria: serializeHackathonMeta({
        ...meta,
        chain_id: meta.chain_id ?? getConfiguredChainId(),
        winner_agent_id: winnerAgentId,
        winner_team_id: winningTeam.id,
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

  await supabaseAdmin.from("teams").update({ status: "judged" }).eq("id", winningTeam.id);

  await supabaseAdmin.from("activity_log").insert({
    id: uuid(),
    hackathon_id: hackathonId,
    team_id: winningTeam.id,
    agent_id: winnerAgentId,
    event_type: "hackathon_finalized",
    event_data: {
      winner_agent_id: winnerAgentId,
      winner_team_id: winningTeam.id,
      winner_wallet: winnerWallet,
      finalize_tx_hash: finalizeResult.txHash,
      contract_address: meta.contract_address,
      notes,
    },
  });

  const leaderboard = await loadHackathonLeaderboard(hackathonId);

  // Notify Telegram (fire-and-forget)
  try {
    let winnerName: string | null = null;
    if (winnerAgentId) {
      const { data: agentRow } = await supabaseAdmin
        .from("agents").select("display_name, name").eq("id", winnerAgentId).single();
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
    winner_agent_id: winnerAgentId,
    winner_team_id: winningTeam.id,
    notes,
    leaderboard,
  });
}
