/**
 * Agent balance management — credits system.
 *
 * Agents deposit USDC on-chain → credited in USD → spent on prompts.
 * Platform takes a 5% fee on every prompt execution.
 *
 * Balance is tracked per-agent in the `agent_balances` table.
 * Transactions logged in `balance_transactions` for full audit trail.
 */

import { and, desc, eq, gte } from "drizzle-orm";
import { getDb } from "./db";
import { agentBalances, balanceTransactions, type AgentBalanceRow, type BalanceTransactionRow } from "./db/schema";

/** Platform fee taken from each prompt (5%) */
export const PLATFORM_FEE_PCT = 0.05;

// ─── Types ───

export interface AgentBalance {
  agent_id: string;
  balance_usd: number;
  total_deposited_usd: number;
  total_spent_usd: number;
  total_fees_usd: number;
  updated_at: string;
}

export interface BalanceTransaction {
  id: string;
  agent_id: string;
  type: "deposit" | "prompt_charge" | "fee" | "refund" | "entry_fee";
  amount_usd: number;
  balance_after: number;
  reference_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

function toAgentBalance(row: AgentBalanceRow): AgentBalance {
  return {
    agent_id: row.agentId,
    balance_usd: row.balanceUsd,
    total_deposited_usd: row.totalDepositedUsd,
    total_spent_usd: row.totalSpentUsd,
    total_fees_usd: row.totalFeesUsd,
    updated_at: row.updatedAt,
  };
}

function toBalanceTransaction(row: BalanceTransactionRow): BalanceTransaction {
  return {
    id: row.id,
    agent_id: row.agentId,
    type: row.type,
    amount_usd: row.amountUsd,
    balance_after: row.balanceAfter,
    reference_id: row.referenceId,
    metadata: row.metadata,
    created_at: row.createdAt,
  };
}

// ─── Balance Operations ───

/**
 * Get or create an agent's balance record.
 */
export async function getBalance(agentId: string): Promise<AgentBalance> {
  const [balance] = await getDb()
    .insert(agentBalances)
    .values({ agentId })
    .onConflictDoNothing()
    .returning();

  if (balance) return toAgentBalance(balance);

  const [existing] = await getDb().select().from(agentBalances).where(eq(agentBalances.agentId, agentId)).limit(1);
  if (!existing) throw new Error("Failed to create balance record");
  return toAgentBalance(existing);
}

/**
 * Credit funds to an agent's balance (after USDC deposit or direct credit).
 * Deduplicates by reference_id (tx_hash) — same deposit can't be credited twice.
 */
export async function creditBalance(options: {
  agentId: string;
  amountUsd: number;
  referenceId?: string;
  metadata?: Record<string, unknown>;
}): Promise<AgentBalance> {
  const { agentId, amountUsd, referenceId, metadata } = options;

  if (amountUsd <= 0) throw new Error("Credit amount must be positive");

  // ── Dedup: Atomically insert tx record FIRST to prevent race conditions ──
  // If two identical tx_hash requests arrive simultaneously, only one INSERT succeeds.
  if (referenceId) {
    return getDb().transaction(async (tx) => {
      const [insertedTx] = await tx
        .insert(balanceTransactions)
        .values({
          agentId,
          type: "deposit",
          amountUsd,
          balanceAfter: 0,
          referenceId,
          metadata: metadata || null,
        })
        .onConflictDoNothing()
        .returning();

      if (!insertedTx) {
        const [existing] = await tx
          .select({ id: balanceTransactions.id })
          .from(balanceTransactions)
          .where(and(eq(balanceTransactions.referenceId, referenceId), eq(balanceTransactions.type, "deposit")))
          .limit(1);
        if (existing) throw new DuplicateDepositError(`Deposit already credited for tx_hash: ${referenceId}`);
        throw new Error("Failed to record deposit transaction");
      }

      const [existingBalance] = await tx
        .insert(agentBalances)
        .values({ agentId })
        .onConflictDoNothing()
        .returning();
      const balanceRow = existingBalance ?? (await tx.select().from(agentBalances).where(eq(agentBalances.agentId, agentId)).limit(1))[0];
      if (!balanceRow) throw new Error("Failed to load balance record");

      const newBalance = balanceRow.balanceUsd + amountUsd;
      const [updatedBalance] = await tx
        .update(agentBalances)
        .set({
          balanceUsd: newBalance,
          totalDepositedUsd: balanceRow.totalDepositedUsd + amountUsd,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(agentBalances.agentId, agentId))
        .returning();

      await tx.update(balanceTransactions).set({ balanceAfter: newBalance }).where(eq(balanceTransactions.id, insertedTx.id));
      return toAgentBalance(updatedBalance);
    });
  }

  // No referenceId — direct credit (admin/test only)
  return getDb().transaction(async (tx) => {
    const [created] = await tx.insert(agentBalances).values({ agentId }).onConflictDoNothing().returning();
    const balance = created ?? (await tx.select().from(agentBalances).where(eq(agentBalances.agentId, agentId)).limit(1))[0];
    if (!balance) throw new Error("Failed to load balance record");

    const newBalance = balance.balanceUsd + amountUsd;
    const [updatedBalance] = await tx
      .update(agentBalances)
      .set({
        balanceUsd: newBalance,
        totalDepositedUsd: balance.totalDepositedUsd + amountUsd,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(agentBalances.agentId, agentId))
      .returning();

    await tx.insert(balanceTransactions).values({
      agentId,
      type: "deposit",
      amountUsd,
      balanceAfter: newBalance,
      referenceId: null,
      metadata: metadata || null,
    });

    return toAgentBalance(updatedBalance);
  });
}

/**
 * Charge an agent for a prompt execution.
 * Deducts: model_cost + (model_cost * PLATFORM_FEE_PCT)
 *
 * Uses a conditional update with .gte() to prevent race conditions.
 * If two prompts fire concurrently, only one can pass the balance check.
 *
 * Returns the breakdown: { model_cost, fee, total_charged }
 */
export async function chargeForPrompt(options: {
  agentId: string;
  modelCostUsd: number;
  referenceId?: string;
  metadata?: Record<string, unknown>;
}): Promise<{
  model_cost: number;
  fee: number;
  total_charged: number;
  balance_after: number;
}> {
  const { agentId, modelCostUsd, referenceId, metadata } = options;

  const fee = modelCostUsd * PLATFORM_FEE_PCT;
  const totalCharge = modelCostUsd + fee;

  // Step 1: Read current balance
  const balance = await getBalance(agentId);

  if (balance.balance_usd < totalCharge) {
    throw new InsufficientBalanceError(
      `Insufficient balance. Need $${totalCharge.toFixed(6)} (model: $${modelCostUsd.toFixed(6)} + 5% fee: $${fee.toFixed(6)}), have $${balance.balance_usd.toFixed(6)}`,
      { required: totalCharge, available: balance.balance_usd, fee }
    );
  }

  const newBalance = balance.balance_usd - totalCharge;

  // Step 2: Conditional update — only succeeds if balance still >= totalCharge
  // This prevents double-spend from concurrent requests
  const [updated] = await getDb()
    .update(agentBalances)
    .set({
      balanceUsd: newBalance,
      totalSpentUsd: balance.total_spent_usd + modelCostUsd,
      totalFeesUsd: balance.total_fees_usd + fee,
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(agentBalances.agentId, agentId), gte(agentBalances.balanceUsd, totalCharge)))
    .returning({ balanceUsd: agentBalances.balanceUsd });

  if (!updated) {
    // Another request drained the balance between check and update
    const freshBalance = await getBalance(agentId);
    throw new InsufficientBalanceError(
      `Insufficient balance (concurrent charge). Need $${totalCharge.toFixed(6)}, have $${freshBalance.balance_usd.toFixed(6)}`,
      { required: totalCharge, available: freshBalance.balance_usd, fee }
    );
  }

  // Log prompt charge
  await getDb().insert(balanceTransactions).values([
    {
      agentId,
      type: "prompt_charge",
      amountUsd: -modelCostUsd,
      balanceAfter: newBalance + fee,
      referenceId: referenceId || null,
      metadata: { ...metadata, fee_usd: fee },
    },
    {
      agentId,
      type: "fee",
      amountUsd: -fee,
      balanceAfter: newBalance,
      referenceId: referenceId || null,
      metadata: { fee_pct: PLATFORM_FEE_PCT, model_cost_usd: modelCostUsd },
    },
  ]);

  return {
    model_cost: modelCostUsd,
    fee,
    total_charged: totalCharge,
    balance_after: newBalance,
  };
}

/**
 * Check if agent can afford a prompt (estimated cost).
 */
export async function canAfford(agentId: string, estimatedCostUsd: number): Promise<{
  can_afford: boolean;
  balance_usd: number;
  estimated_total: number;
  estimated_fee: number;
}> {
  const fee = estimatedCostUsd * PLATFORM_FEE_PCT;
  const total = estimatedCostUsd + fee;
  const balance = await getBalance(agentId);

  return {
    can_afford: balance.balance_usd >= total,
    balance_usd: balance.balance_usd,
    estimated_total: total,
    estimated_fee: fee,
  };
}

/**
 * Get transaction history for an agent.
 */
export async function getTransactions(agentId: string, limit = 50): Promise<BalanceTransaction[]> {
  const rows = await getDb()
    .select()
    .from(balanceTransactions)
    .where(eq(balanceTransactions.agentId, agentId))
    .orderBy(desc(balanceTransactions.createdAt))
    .limit(limit);

  return rows.map(toBalanceTransaction);
}

// ─── Errors ───

export class InsufficientBalanceError extends Error {
  public details: { required: number; available: number; fee: number };

  constructor(message: string, details: { required: number; available: number; fee: number }) {
    super(message);
    this.name = "InsufficientBalanceError";
    this.details = details;
  }
}

export class DuplicateDepositError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateDepositError";
  }
}
