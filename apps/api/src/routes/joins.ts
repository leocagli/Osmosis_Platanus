import crypto from "crypto";
import type { FastifyInstance } from "fastify";
import { and, count, eq, gte, sql } from "drizzle-orm";
import { getDb, schema } from "@buildersclaw/shared/db";
import { createSingleAgentTeam, sanitizeString, calculatePrizePool, parseHackathonMeta } from "@buildersclaw/shared/hackathons";
import { getBalance } from "@buildersclaw/shared/balance";
import { verifyJoinTransaction } from "@buildersclaw/shared/chain";
import { getJoinTransactionGuide, checkAgentChainReadiness } from "@buildersclaw/shared/chain-prerequisites";
import { validateWalletAddress, isValidTxHash, isValidUUID, checkRateLimit } from "@buildersclaw/shared/validation";
import { parseTelegramUsername, verifyTelegramMembership } from "@buildersclaw/shared/telegram";
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

    const db = getDb();
    const [hackathon] = await db
      .select({
        id: schema.hackathons.id,
        title: schema.hackathons.title,
        description: schema.hackathons.description,
        brief: schema.hackathons.brief,
        rules: schema.hackathons.rules,
        entry_fee: schema.hackathons.entryFee,
        max_participants: schema.hackathons.maxParticipants,
        challenge_type: schema.hackathons.challengeType,
        status: schema.hackathons.status,
        ends_at: schema.hackathons.endsAt,
        judging_criteria: schema.hackathons.judgingCriteria,
        github_repo: schema.hackathons.githubRepo,
      })
      .from(schema.hackathons)
      .where(eq(schema.hackathons.id, hackathonId))
      .limit(1);
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

    const [existingMembership] = await db
      .select({ team_id: schema.teamMembers.teamId })
      .from(schema.teamMembers)
      .innerJoin(schema.teams, eq(schema.teamMembers.teamId, schema.teams.id))
      .where(and(eq(schema.teamMembers.agentId, agent.id), eq(schema.teams.hackathonId, hackathonId)))
      .limit(1);

    if (existingMembership) {
      const [existingTeam] = await db
        .select({ id: schema.teams.id, hackathon_id: schema.teams.hackathonId, name: schema.teams.name, color: schema.teams.color, floor_number: schema.teams.floorNumber, status: schema.teams.status, telegram_chat_id: schema.teams.telegramChatId, created_by: schema.teams.createdBy, created_at: schema.teams.createdAt })
        .from(schema.teams)
        .where(eq(schema.teams.id, existingMembership.team_id))
        .limit(1);
      return created(reply, {
        joined: false,
        team: existingTeam,
        agent_id: agent.id,
        hackathon: { id: hackathon.id, title: hackathon.title, brief: hackathon.brief, ends_at: hackathon.ends_at || null },
        message: "Agent was already registered for this hackathon.",
      });
    }

    const [{ value: currentParticipants }] = await db.select({ value: count() }).from(schema.teams).where(eq(schema.teams.hackathonId, hackathonId));
    if (currentParticipants >= hackathon.max_participants) {
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
      const existingTx = await db
        .select({ id: schema.activityLog.id })
        .from(schema.activityLog)
        .where(and(eq(schema.activityLog.eventType, "hackathon_joined"), sql`${schema.activityLog.eventData} @> ${JSON.stringify({ tx_hash: txHash })}::jsonb`))
        .limit(1);
      if (existingTx.length > 0) {
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

      const [updated] = await db.transaction(async (tx) => {
        const rows = await tx
          .update(schema.agentBalances)
          .set({ balanceUsd: balance.balance_usd - entryFee, totalSpentUsd: balance.total_spent_usd + entryFee, updatedAt: new Date().toISOString() })
          .where(and(eq(schema.agentBalances.agentId, agent.id), gte(schema.agentBalances.balanceUsd, entryFee)))
          .returning({ balance_usd: schema.agentBalances.balanceUsd });
        if (rows.length === 0) return [];
        await tx.insert(schema.balanceTransactions).values({
          id: crypto.randomUUID(),
          agentId: agent.id,
          type: "entry_fee",
          amountUsd: -entryFee,
          balanceAfter: rows[0].balance_usd,
          referenceId: hackathonId,
          metadata: { type: "entry_fee", hackathon_id: hackathonId, hackathon_title: hackathon.title },
          createdAt: new Date().toISOString(),
        });
        return rows;
      });

      if (!updated) return fail(reply, "Failed to charge entry fee (balance may have changed). Try again.", 402);

      entryCharge = { entry_fee_usd: entryFee, balance_after_usd: updated.balance_usd };
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
      await db.insert(schema.activityLog).values({
        id: crypto.randomUUID(),
        hackathonId,
        teamId: typeof team.id === "string" ? team.id : null,
        agentId: agent.id,
        eventType: "hackathon_joined",
        eventData: { entry_fee_usd: entryFee, paid_from_balance: entryFee > 0 },
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
