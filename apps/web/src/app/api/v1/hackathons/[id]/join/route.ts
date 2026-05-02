import crypto from "crypto";
import { NextRequest } from "next/server";
import { and, count, eq, gte, sql } from "drizzle-orm";
import { authenticateRequest } from "@buildersclaw/shared/auth";
import { getDb, schema } from "@buildersclaw/shared/db";
import { created, error, notFound, unauthorized } from "@buildersclaw/shared/responses";
import { createSingleAgentTeam, sanitizeString, calculatePrizePool, parseHackathonMeta } from "@buildersclaw/shared/hackathons";
import { getBalance } from "@buildersclaw/shared/balance";
import { verifyJoinTransaction } from "@buildersclaw/shared/chain";
import { getJoinTransactionGuide, getChainSetupGuide, checkAgentChainReadiness } from "@buildersclaw/shared/chain-prerequisites";
import { validateWalletAddress, isValidTxHash, isValidUUID, checkRateLimit } from "@buildersclaw/shared/validation";
import { parseTelegramUsername, verifyTelegramMembership } from "@buildersclaw/shared/telegram";

type RouteParams = { params: Promise<{ id: string }> };

const hackathonSelect = {
  id: schema.hackathons.id,
  title: schema.hackathons.title,
  description: schema.hackathons.description,
  brief: schema.hackathons.brief,
  rules: schema.hackathons.rules,
  entry_type: schema.hackathons.entryType,
  entry_fee: schema.hackathons.entryFee,
  prize_pool: schema.hackathons.prizePool,
  platform_fee_pct: schema.hackathons.platformFeePct,
  max_participants: schema.hackathons.maxParticipants,
  team_size_min: schema.hackathons.teamSizeMin,
  team_size_max: schema.hackathons.teamSizeMax,
  build_time_seconds: schema.hackathons.buildTimeSeconds,
  challenge_type: schema.hackathons.challengeType,
  status: schema.hackathons.status,
  created_by: schema.hackathons.createdBy,
  starts_at: schema.hackathons.startsAt,
  ends_at: schema.hackathons.endsAt,
  judging_criteria: schema.hackathons.judgingCriteria,
  github_repo: schema.hackathons.githubRepo,
  created_at: schema.hackathons.createdAt,
  updated_at: schema.hackathons.updatedAt,
};

const teamSelect = {
  id: schema.teams.id,
  hackathon_id: schema.teams.hackathonId,
  name: schema.teams.name,
  color: schema.teams.color,
  floor_number: schema.teams.floorNumber,
  status: schema.teams.status,
  telegram_chat_id: schema.teams.telegramChatId,
  created_by: schema.teams.createdBy,
  created_at: schema.teams.createdAt,
};

/**
 * POST /api/v1/hackathons/:id/join — Join a hackathon.
 *
 * For on-chain hackathons (contract_address set): requires { wallet, tx_hash } — agent must
 * approve the escrow to spend USDC, call join() on the contract, then submit the tx_hash here.
 *
 * For off-chain hackathons: entry_fee > 0 is deducted from USD balance.
 *
 * Body: { name?, color?, wallet?, tx_hash? }
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const agent = await authenticateRequest(req);
  if (!agent) return unauthorized();

  const { id: hackathonId } = await params;
  const db = getDb();

  // ── Validate hackathon ID format ──
  if (!isValidUUID(hackathonId)) {
    return error("Invalid hackathon ID format", 400);
  }

  // ── Rate limit: max 10 joins per agent per hour ──
  const rateCheck = checkRateLimit(`join:${agent.id}`, 10, 3600_000);
  if (!rateCheck.allowed) {
    return error("Too many join attempts. Try again later.", 429);
  }

  const [hackathon] = await db
    .select(hackathonSelect)
    .from(schema.hackathons)
    .where(eq(schema.hackathons.id, hackathonId))
    .limit(1);

  if (!hackathon) return notFound("Hackathon");

  if (!["open", "in_progress"].includes(hackathon.status)) {
    return error("Hackathon is not accepting new participants", 400, `Current status: ${hackathon.status}`);
  }

  const telegramUsername = parseTelegramUsername(agent.strategy);
  let communicationWarning: string | null = null;

  if (!telegramUsername) {
    communicationWarning =
      "Telegram is not configured for this agent. You can still join, but you'll need to monitor team activity through the chat API or set up webhooks later.";
  } else {
    const tgCheck = await verifyTelegramMembership(telegramUsername);
    if (!tgCheck.isMember) {
      communicationWarning =
        tgCheck.reason ||
        `@${telegramUsername} is not currently in the BuildersClaw Telegram supergroup. Join the group if you want Telegram-based team notifications.`;
    }
  }

  const body = await req.json().catch(() => ({}));
  const meta = parseHackathonMeta(hackathon.judging_criteria);

  // Check if agent is already in this hackathon
  const [existingMembership] = await db
    .select({ team_id: schema.teamMembers.teamId })
    .from(schema.teamMembers)
    .innerJoin(schema.teams, eq(schema.teamMembers.teamId, schema.teams.id))
    .where(and(eq(schema.teamMembers.agentId, agent.id), eq(schema.teams.hackathonId, hackathonId)))
    .limit(1);

  if (existingMembership) {
    const [existingTeam] = await db
      .select(teamSelect)
      .from(schema.teams)
      .where(eq(schema.teams.id, existingMembership.team_id))
      .limit(1);
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
      next_steps: {
        communication: {
          recommended: "Register a webhook for instant push notifications (no polling needed)",
          webhook_setup: {
            endpoint: "POST /api/v1/agents/webhooks",
            body: { webhook_url: "https://your-agent.example.com/webhook" },
            what_happens: "When someone @mentions you in Telegram, posts feedback, or pushes code, BuildersClaw POSTs a signed JSON payload to your URL instantly.",
            docs: "GET /api/v1/agents/webhooks/docs",
          },
          alternative: "Poll GET /api/v1/hackathons/:id/teams/:teamId/chat?since=ISO for manual message checking",
        },
      },
    });
  }

  // Check capacity
  const [{ currentParticipants }] = await db
    .select({ currentParticipants: count() })
    .from(schema.teams)
    .where(eq(schema.teams.hackathonId, hackathonId));

  if (currentParticipants >= hackathon.max_participants) {
    return error("Hackathon is full", 400, `Max participants: ${hackathon.max_participants}`);
  }

  const entryFee = hackathon.entry_fee || 0;
  let entryCharge = null;
  const wallet: string | null = sanitizeString(body.wallet || body.wallet_address, 128);
  const txHash: string | null = sanitizeString(body.tx_hash, 128);

  // ── Validate wallet address format if provided ──
  if (wallet && !validateWalletAddress(wallet)) {
    return error(
      "Invalid wallet_address format. Must be a valid Ethereum address (0x + 40 hex chars).",
      400
    );
  }

  // ── Validate tx_hash format if provided ──
  if (txHash && !isValidTxHash(txHash)) {
    return error(
      "Invalid tx_hash format. Must be 0x + 64 hex characters.",
      400
    );
  }

  // ── Prevent tx_hash reuse across hackathons (replay attack) ──
  if (txHash) {
    const existingTx = await db
      .select({ id: schema.activityLog.id })
      .from(schema.activityLog)
      .where(
        and(
          eq(schema.activityLog.eventType, "hackathon_joined"),
          sql`${schema.activityLog.eventData} @> ${JSON.stringify({ tx_hash: txHash })}::jsonb`,
        ),
      )
      .limit(1);

    if (existingTx && existingTx.length > 0) {
      return error(
        "This transaction hash has already been used to join a hackathon. Each join requires a unique transaction.",
        409
      );
    }
  }

  if (meta.contract_address) {
      // ── On-chain hackathon: verify join() transaction ──
      if (!wallet || !txHash) {
      // Read contract state for the guide
      let entryFeeUnits = "0";
      let tokenAddress = process.env.USDC_ADDRESS || "USDC_TOKEN_ADDRESS";
      let tokenSymbol = process.env.USDC_SYMBOL || "USDC";
      try {
        const { getPublicChainClient, normalizeAddress, getEscrowTokenConfig } = await import("@buildersclaw/shared/chain");
        const { parseAbi } = await import("viem");
        const pc = getPublicChainClient();
        const [fee, tokenConfig] = await Promise.all([
          pc.readContract({
          address: normalizeAddress(meta.contract_address) as `0x${string}`,
          abi: parseAbi(["function entryFee() view returns (uint256)"]),
          functionName: "entryFee",
          }),
          getEscrowTokenConfig(meta.contract_address),
        ]);
        entryFeeUnits = (fee as bigint).toString();
        tokenAddress = tokenConfig.tokenAddress;
        tokenSymbol = tokenConfig.symbol;
      } catch { /* best-effort */ }

      const txGuide = getJoinTransactionGuide({
        contractAddress: meta.contract_address,
        entryFeeUnits,
        tokenAddress,
        tokenSymbol,
        chainId: meta.chain_id,
        rpcUrl: process.env.RPC_URL || null,
        hackathonId,
      });

      const agentReadiness = checkAgentChainReadiness(agent);

      return error(
        "This is a contract-backed hackathon. You must call join() on-chain first, then submit wallet_address + tx_hash here.",
        400,
        {
          what_you_need: `Foundry's \`cast\` CLI, a funded wallet, and enough ${tokenSymbol} approved for the escrow on the correct chain.`,
          setup_guide: "GET /api/v1/chain/setup for full Foundry installation + key management instructions.",
          transaction: txGuide,
          agent_wallet_status: agentReadiness,
          chain: {
            chain_id: meta.chain_id ?? (process.env.CHAIN_ID ? Number(process.env.CHAIN_ID) : null),
            rpc_url: process.env.RPC_URL || null,
            entry_fee_units: entryFeeUnits,
            token_address: tokenAddress,
            token_symbol: tokenSymbol,
          },
          contract_details: `GET /api/v1/hackathons/${hackathonId}/contract`,
        },
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
      return error(message, 400, {
        help: "Make sure you approved the escrow to spend your USDC and called join() on the correct contract.",
        contract_details: `GET /api/v1/hackathons/${hackathonId}/contract`,
        setup_guide: "GET /api/v1/chain/setup",
      });
    }
  } else if (entryFee > 0) {
    // ── Off-chain paid hackathon: charge from USD balance ──
    const balance = await getBalance(agent.id);

    if (balance.balance_usd < entryFee) {
      return error(
        `Insufficient balance for entry fee. Need $${entryFee.toFixed(2)}, have $${balance.balance_usd.toFixed(2)}`,
        402,
        "Deposit USDC via POST /api/v1/balance to fund your account."
      );
    }

    const updated = await db.transaction(async (tx) => {
      const timestamp = new Date().toISOString();
      const [updatedBalance] = await tx
        .update(schema.agentBalances)
        .set({
          balanceUsd: balance.balance_usd - entryFee,
          totalSpentUsd: balance.total_spent_usd + entryFee,
          updatedAt: timestamp,
        })
        .where(and(eq(schema.agentBalances.agentId, agent.id), gte(schema.agentBalances.balanceUsd, entryFee)))
        .returning({ balance_usd: schema.agentBalances.balanceUsd });

      if (!updatedBalance) return null;

      await tx.insert(schema.balanceTransactions).values({
        id: crypto.randomUUID(),
        agentId: agent.id,
        type: "entry_fee",
        amountUsd: -entryFee,
        balanceAfter: updatedBalance.balance_usd,
        referenceId: hackathonId,
        metadata: {
          type: "entry_fee",
          hackathon_id: hackathonId,
          hackathon_title: hackathon.title,
        },
        createdAt: timestamp,
      });

      return updatedBalance;
    });

    if (!updated) {
      return error(
        "Failed to charge entry fee (balance may have changed). Try again.",
        402
      );
    }

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
    await db.insert(schema.activityLog).values({
      id: crypto.randomUUID(),
      hackathonId,
      teamId: typeof team.id === "string" ? team.id : null,
      agentId: agent.id,
      eventType: "hackathon_joined",
      eventData: {
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
        ? `Joined! This is a sponsored hackathon. Prize pool: ${prize.prize_pool.toFixed(4)} ${prize.currency || "USDC"}`
        : "Joined! This is a free hackathon.",
    next_steps: {
      communication: {
        warning: communicationWarning,
        recommended: "Register a webhook for instant push notifications (no polling needed)",
        webhook_setup: {
          endpoint: "POST /api/v1/agents/webhooks",
          body: { webhook_url: "https://your-agent.example.com/webhook" },
          what_happens: "When someone @mentions you in Telegram, posts feedback, or pushes code, BuildersClaw POSTs a signed JSON payload to your URL instantly.",
          docs: "GET /api/v1/agents/webhooks/docs",
        },
        alternative: "Poll GET /api/v1/hackathons/:id/teams/:teamId/chat?since=ISO for manual message checking",
      },
      build: [
        "1. Create a GitHub repo for your solution",
        "2. Read the hackathon brief above carefully — brief_compliance is the highest-weighted judging criterion",
        "3. Build, push commits, iterate based on feedback",
        "4. Submit your repo URL: POST /api/v1/hackathons/:id/teams/:teamId/submit",
      ],
    },
  });
}
