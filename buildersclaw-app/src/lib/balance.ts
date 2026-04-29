/**
 * Agent balance management — credits system.
 *
 * Agents deposit ETH on-chain → credited in USD → spent on prompts.
 * Platform takes a 5% fee on every prompt execution.
 *
 * Balance is tracked per-agent in the `agent_balances` table.
 * Transactions logged in `balance_transactions` for full audit trail.
 */

import { supabaseAdmin } from "./supabase";
import { v4 as uuid } from "uuid";

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

// ─── Balance Operations ───

/**
 * Get or create an agent's balance record.
 */
export async function getBalance(agentId: string): Promise<AgentBalance> {
  const { data: existing } = await supabaseAdmin
    .from("agent_balances")
    .select("*")
    .eq("agent_id", agentId)
    .single();

  if (existing) return existing as AgentBalance;

  // Create new balance record
  const newBalance: AgentBalance = {
    agent_id: agentId,
    balance_usd: 0,
    total_deposited_usd: 0,
    total_spent_usd: 0,
    total_fees_usd: 0,
    updated_at: new Date().toISOString(),
  };

  await supabaseAdmin.from("agent_balances").insert(newBalance);
  return newBalance;
}

/**
 * Credit funds to an agent's balance (after ETH deposit or direct credit).
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
    const txId = uuid();
    const { error: insertErr } = await supabaseAdmin
      .from("balance_transactions")
      .insert({
        id: txId,
        agent_id: agentId,
        type: "deposit",
        amount_usd: amountUsd,
        balance_after: 0, // Placeholder — updated below
        reference_id: referenceId,
        metadata: metadata || null,
        created_at: new Date().toISOString(),
      });

    // If insert fails due to unique constraint on reference_id, it's a duplicate
    if (insertErr) {
      // Check if it's actually a duplicate (reference_id conflict)
      const { data: existing } = await supabaseAdmin
        .from("balance_transactions")
        .select("id")
        .eq("reference_id", referenceId)
        .eq("type", "deposit")
        .limit(1);

      if (existing && existing.length > 0) {
        throw new DuplicateDepositError(
          `Deposit already credited for tx_hash: ${referenceId}`
        );
      }
      // If not a duplicate, it's some other error
      throw new Error(`Failed to record deposit transaction: ${insertErr.message}`);
    }

    // Transaction record claimed — now safe to update balance
    const balance = await getBalance(agentId);
    const newBalance = balance.balance_usd + amountUsd;

    await supabaseAdmin
      .from("agent_balances")
      .upsert({
        agent_id: agentId,
        balance_usd: newBalance,
        total_deposited_usd: balance.total_deposited_usd + amountUsd,
        total_spent_usd: balance.total_spent_usd,
        total_fees_usd: balance.total_fees_usd,
        updated_at: new Date().toISOString(),
      });

    // Update the placeholder balance_after
    await supabaseAdmin
      .from("balance_transactions")
      .update({ balance_after: newBalance })
      .eq("id", txId);

    return { ...balance, balance_usd: newBalance, total_deposited_usd: balance.total_deposited_usd + amountUsd };
  }

  // No referenceId — direct credit (admin/test only)
  const balance = await getBalance(agentId);
  const newBalance = balance.balance_usd + amountUsd;

  await supabaseAdmin
    .from("agent_balances")
    .upsert({
      agent_id: agentId,
      balance_usd: newBalance,
      total_deposited_usd: balance.total_deposited_usd + amountUsd,
      total_spent_usd: balance.total_spent_usd,
      total_fees_usd: balance.total_fees_usd,
      updated_at: new Date().toISOString(),
    });

  await supabaseAdmin.from("balance_transactions").insert({
    id: uuid(),
    agent_id: agentId,
    type: "deposit",
    amount_usd: amountUsd,
    balance_after: newBalance,
    reference_id: null,
    metadata: metadata || null,
    created_at: new Date().toISOString(),
  });

  return { ...balance, balance_usd: newBalance, total_deposited_usd: balance.total_deposited_usd + amountUsd };
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
  const { data: updated, error: updateErr } = await supabaseAdmin
    .from("agent_balances")
    .update({
      balance_usd: newBalance,
      total_spent_usd: balance.total_spent_usd + modelCostUsd,
      total_fees_usd: balance.total_fees_usd + fee,
      updated_at: new Date().toISOString(),
    })
    .eq("agent_id", agentId)
    .gte("balance_usd", totalCharge)
    .select("balance_usd")
    .single();

  if (updateErr || !updated) {
    // Another request drained the balance between check and update
    const freshBalance = await getBalance(agentId);
    throw new InsufficientBalanceError(
      `Insufficient balance (concurrent charge). Need $${totalCharge.toFixed(6)}, have $${freshBalance.balance_usd.toFixed(6)}`,
      { required: totalCharge, available: freshBalance.balance_usd, fee }
    );
  }

  // Log prompt charge
  await supabaseAdmin.from("balance_transactions").insert({
    id: uuid(),
    agent_id: agentId,
    type: "prompt_charge",
    amount_usd: -modelCostUsd,
    balance_after: newBalance + fee, // before fee
    reference_id: referenceId || null,
    metadata: { ...metadata, fee_usd: fee },
    created_at: new Date().toISOString(),
  });

  // Log fee separately for accounting
  await supabaseAdmin.from("balance_transactions").insert({
    id: uuid(),
    agent_id: agentId,
    type: "fee",
    amount_usd: -fee,
    balance_after: newBalance,
    reference_id: referenceId || null,
    metadata: { fee_pct: PLATFORM_FEE_PCT, model_cost_usd: modelCostUsd },
    created_at: new Date().toISOString(),
  });

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
  const { data } = await supabaseAdmin
    .from("balance_transactions")
    .select("*")
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data || []) as BalanceTransaction[];
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
