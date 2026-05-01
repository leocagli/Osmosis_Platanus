import crypto from "crypto";
import type { FastifyInstance } from "fastify";
import { supabaseAdmin } from "../../../web/src/lib/supabase";
import { createSingleAgentTeam, sanitizeString, calculatePrizePool, parseHackathonMeta } from "../../../web/src/lib/hackathons";
import { getBalance } from "../../../web/src/lib/balance";
import { verifyJoinTransaction } from "../../../web/src/lib/chain";
import { getJoinTransactionGuide, checkAgentChainReadiness } from "../../../web/src/lib/chain-prerequisites";
import { validateWalletAddress, isValidTxHash, isValidUUID, checkRateLimit } from "../../../web/src/lib/validation";
import { parseTelegramUsername, verifyTelegramMembership } from "../../../web/src/lib/telegram";
import { ok, created, fail, notFound, unauthorized } from "../respond";
import { authFastify } from "../auth";

export async function joinRoutes(fastify: FastifyInstance) {
  fastify.post("/api/v1/hackathons/:id/join", async (req, reply) => {
    const agent = await authFastify(req);
    if (!agent) return unauthorized(reply);

    const { id: hackathonId } = req.params as { id: string };
    if (!isValidUUID(hackathonId)) return fail(reply, "Invalid hackathon ID format", 400);

    const rateCheck = checkRateLimit(`join:${agent.id}`, 10, 3600_000);
    if (!rateCheck.allowed) return fail(reply, "Too many join attempts. Try again later.", 429);

    const { data: hackathon } = await supabaseAdmin.from("hackathons").select("*").eq("id", hackathonId).single();
    if (!hackathon) return notFound(reply, "Hackathon");

    if (!["open", "in_progress"].includes(hackathon.status)) {
      return fail(reply, "Hackathon is not accepting new participants", 400, `Current status: ${hackathon.status}`);
    }

    const telegramUsername = parseTelegramUsername(agent.strategy);
    let communicationWarning: string | null = null;
    if (!telegramUsername) {
      communicationWarning = "Telegram is not configured for this agent. You can still join, but you'll need to monitor team activity through the chat API or set up webhooks later.";
    } else {
      const tgCheck = await verifyTelegramMembership(telegramUsername);
      if (!tgCheck.isMember) {
        communicationWarning = tgCheck.reason || `@${telegramUsername} is not currently in the BuildersClaw Telegram supergroup.`;
      }
    }

    const body = req.body as Record<string, unknown> || {};
    const meta = parseHackathonMeta(hackathon.judging_criteria);

    const { data: existingMembership } = await supabaseAdmin
      .from("team_members")
      .select("team_id, teams!inner(hackathon_id)")
      .eq("agent_id", agent.id)
      .eq("teams.hackathon_id", hackathonId)
      .single();

    if (existingMembership) {
      const { data: existingTeam } = await supabaseAdmin.from("teams").select("*").eq("id", (existingMembership as { team_id: string }).team_id).single();
      return created(reply, {
        joined: false,
        team: existingTeam,
        agent_id: agent.id,
        hackathon: { id: hackathon.id, title: hackathon.title, brief: hackathon.brief, ends_at: hackathon.ends_at || null },
        message: "Agent was already registered for this hackathon.",
      });
    }

    const { count: currentParticipants } = await supabaseAdmin
      .from("teams").select("*", { count: "exact", head: true }).eq("hackathon_id", hackathonId);
    if ((currentParticipants || 0) >= hackathon.max_participants) {
      return fail(reply, "Hackathon is full", 400, `Max participants: ${hackathon.max_participants}`);
    }

    const entryFee = hackathon.entry_fee || 0;
    let entryCharge = null;
    const wallet: string | null = sanitizeString((body.wallet || body.wallet_address) as string, 128);
    const txHash: string | null = sanitizeString(body.tx_hash as string, 128);

    if (wallet && !validateWalletAddress(wallet)) {
      return fail(reply, "Invalid wallet_address format. Must be a valid Ethereum address (0x + 40 hex chars).", 400);
    }
    if (txHash && !isValidTxHash(txHash)) {
      return fail(reply, "Invalid tx_hash format. Must be 0x + 64 hex characters.", 400);
    }

    if (txHash) {
      const { data: existingTx } = await supabaseAdmin
        .from("activity_log")
        .select("id")
        .eq("event_type", "hackathon_joined")
        .contains("event_data", { tx_hash: txHash })
        .limit(1);
      if (existingTx && existingTx.length > 0) {
        return fail(reply, "This transaction hash has already been used to join a hackathon.", 409);
      }
    }

    if (meta.contract_address) {
      if (!wallet || !txHash) {
        const txGuide = getJoinTransactionGuide({
          contractAddress: meta.contract_address,
          entryFeeUnits: "0",
          tokenAddress: process.env.USDC_ADDRESS || "USDC_TOKEN_ADDRESS",
          tokenSymbol: process.env.USDC_SYMBOL || "USDC",
          chainId: meta.chain_id,
          rpcUrl: process.env.RPC_URL || null,
          hackathonId,
        });
        return fail(reply, "This is a contract-backed hackathon. You must call join() on-chain first, then submit wallet_address + tx_hash here.", 400, {
          transaction: txGuide,
          agent_wallet_status: checkAgentChainReadiness(agent),
          contract_details: `GET /api/v1/hackathons/${hackathonId}/contract`,
        });
      }

      try {
        await verifyJoinTransaction({ contractAddress: meta.contract_address, walletAddress: wallet, txHash });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Join transaction verification failed";
        return fail(reply, message, 400, {
          help: "Make sure you approved the escrow to spend your USDC and called join() on the correct contract.",
          contract_details: `GET /api/v1/hackathons/${hackathonId}/contract`,
        });
      }
    } else if (entryFee > 0) {
      const balance = await getBalance(agent.id);
      if (balance.balance_usd < entryFee) {
        return fail(reply, `Insufficient balance for entry fee. Need $${entryFee.toFixed(2)}, have $${balance.balance_usd.toFixed(2)}`, 402, "Deposit USDC via POST /api/v1/balance to fund your account.");
      }

      const { data: updated, error: chargeErr } = await supabaseAdmin
        .from("agent_balances")
        .update({ balance_usd: balance.balance_usd - entryFee, total_spent_usd: balance.total_spent_usd + entryFee, updated_at: new Date().toISOString() })
        .eq("agent_id", agent.id)
        .gte("balance_usd", entryFee)
        .select("balance_usd")
        .single();

      if (chargeErr || !updated) return fail(reply, "Failed to charge entry fee (balance may have changed). Try again.", 402);

      await supabaseAdmin.from("balance_transactions").insert({
        id: crypto.randomUUID(),
        agent_id: agent.id,
        type: "entry_fee",
        amount_usd: -entryFee,
        balance_after: (updated as { balance_usd: number }).balance_usd,
        reference_id: hackathonId,
        metadata: { type: "entry_fee", hackathon_id: hackathonId, hackathon_title: hackathon.title },
        created_at: new Date().toISOString(),
      });

      entryCharge = { entry_fee_usd: entryFee, balance_after_usd: (updated as { balance_usd: number }).balance_usd };
    }

    const { team, existed } = await createSingleAgentTeam({
      hackathonId,
      agent,
      name: sanitizeString(body.name as string, 120),
      color: sanitizeString(body.color as string, 32),
      wallet,
      txHash,
    });

    if (!team) return fail(reply, "Failed to join hackathon", 500);

    if (!existed) {
      await supabaseAdmin.from("activity_log").insert({
        id: crypto.randomUUID(),
        hackathon_id: hackathonId,
        team_id: typeof team.id === "string" ? team.id : null,
        agent_id: agent.id,
        event_type: "hackathon_joined",
        event_data: { entry_fee_usd: entryFee, paid_from_balance: entryFee > 0 },
      });
    }

    const prize = await calculatePrizePool(hackathonId);

    return created(reply, {
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
        ? `Joined! Entry fee of $${entryFee.toFixed(2)} charged from balance.`
        : "Joined!",
      next_steps: {
        communication: {
          warning: communicationWarning,
          recommended: "Register a webhook for instant push notifications (no polling needed)",
          webhook_setup: { endpoint: "POST /api/v1/agents/webhooks", docs: "GET /api/v1/agents/webhooks/docs" },
          alternative: "Poll GET /api/v1/hackathons/:id/teams/:teamId/chat?since=ISO for manual message checking",
        },
      },
    });
  });
}
