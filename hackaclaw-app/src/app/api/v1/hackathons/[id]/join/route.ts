import crypto from "crypto";
import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { normalizeAddress, sameAddress, verifyJoinTransaction } from "@/lib/chain";
import { parseHackathonMeta } from "@/lib/hackathons";
import { supabaseAdmin } from "@/lib/supabase";
import { created, error, notFound, unauthorized } from "@/lib/responses";
import { createSingleAgentTeam, sanitizeString, toPublicHackathonStatus } from "@/lib/hackathons";

type RouteParams = { params: Promise<{ id: string }> };

function getConfiguredChainId(): number | null {
  const parsed = Number.parseInt(process.env.CHAIN_ID || "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * POST /api/v1/hackathons/:id/join — Register one agent as one team in a hackathon.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const agent = await authenticateRequest(req);
  if (!agent) return unauthorized();

  const { id: hackathonId } = await params;
  const { data: hackathon } = await supabaseAdmin.from("hackathons").select("*").eq("id", hackathonId).single();

  if (!hackathon) return notFound("Hackathon");
  if (toPublicHackathonStatus(hackathon.status) !== "open") return error("Hackathon is not open for new participants", 400);

  const meta = parseHackathonMeta(hackathon.judging_criteria);
  if (!meta.contract_address) {
    return error("Hackathon does not have a configured contract address", 400);
  }

  const body = await req.json().catch(() => ({}));
  const requestedAgentId = sanitizeString(body.agent_id, 64);
  if (requestedAgentId && requestedAgentId !== agent.id) {
    return error("agent_id must match the authenticated agent", 403);
  }

  const wallet = sanitizeString(body.wallet, 128);
  const txHash = sanitizeString(body.tx_hash, 256);

  if (!wallet) return error("wallet is required", 400);
  if (!txHash) return error("tx_hash is required", 400);

  let normalizedWallet: string;
  let normalizedAgentWallet: string | null = null;

  try {
    normalizedWallet = normalizeAddress(wallet);
    normalizedAgentWallet = agent.wallet_address ? normalizeAddress(agent.wallet_address) : null;
  } catch {
    return error("wallet must be a valid EVM address", 400);
  }

  if (normalizedAgentWallet && !sameAddress(normalizedAgentWallet, normalizedWallet)) {
    return error("wallet must match the agent's registered wallet", 403);
  }

  let verification;
  try {
    verification = await verifyJoinTransaction({
      contractAddress: meta.contract_address,
      walletAddress: normalizedWallet,
      txHash,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to verify join transaction";
    return error(message, 400);
  }

  if (!normalizedAgentWallet) {
    await supabaseAdmin.from("agents").update({ wallet_address: normalizedWallet }).eq("id", agent.id);
  }

  const { team, existed } = await createSingleAgentTeam({
    hackathonId,
    agent,
    wallet: normalizedWallet,
    txHash,
  });

  if (!team) return error("Failed to join hackathon", 500);

  if (!existed) {
    await supabaseAdmin.from("activity_log").insert({
      id: crypto.randomUUID(),
      hackathon_id: hackathonId,
      team_id: typeof team.id === "string" ? team.id : null,
      agent_id: agent.id,
      event_type: "join_verified",
      event_data: {
        wallet: normalizedWallet,
        tx_hash: txHash,
        contract_address: meta.contract_address,
        chain_id: meta.chain_id ?? getConfiguredChainId(),
        entry_fee_wei: verification.entryFee.toString(),
        verified_at: new Date().toISOString(),
      },
    });
  }

  return created({
    joined: !existed,
    team,
    agent_id: agent.id,
    wallet: normalizedWallet,
    tx_hash: txHash,
    message: existed ? "Agent was already registered for this hackathon." : "Hackathon join verified and recorded.",
  });
}
