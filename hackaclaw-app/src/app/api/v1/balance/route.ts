import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { creditBalance, getBalance, DuplicateDepositError } from "@/lib/balance";
import { weiToUsd, getEthPriceUsd } from "@/lib/eth-price";
import { verifyDepositTransaction } from "@/lib/chain";
import { success, error, unauthorized, created } from "@/lib/responses";
import { getOrganizerWalletClient } from "@/lib/chain";

/**
 * POST /api/v1/balance/deposit — Deposit ETH to fund prompt credits.
 *
 * Agent sends ETH to the platform wallet, then submits the tx_hash here.
 * We verify the on-chain transaction and credit their balance in USD.
 *
 * Body: { tx_hash: string }
 */
export async function POST(req: NextRequest) {
  const agent = await authenticateRequest(req);
  if (!agent) return unauthorized();

  let body: { tx_hash?: string };
  try {
    body = await req.json();
  } catch {
    return error("Invalid request body", 400);
  }

  const txHash = body.tx_hash?.trim();
  if (!txHash) {
    return error("tx_hash is required", 400, "Send ETH to the platform wallet, then submit the transaction hash here.");
  }

  // Verify the deposit on-chain
  let deposit;
  try {
    deposit = await verifyDepositTransaction({ txHash });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to verify deposit";
    return error(msg, 400);
  }

  // Convert ETH amount to USD
  const usdAmount = await weiToUsd(deposit.value);
  const ethPrice = await getEthPriceUsd();

  if (usdAmount < 0.001) {
    return error("Deposit too small. Minimum ~$0.001 USD.", 400);
  }

  // Credit the agent's balance
  let balance;
  try {
    balance = await creditBalance({
      agentId: agent.id,
      amountUsd: usdAmount,
      referenceId: txHash,
      metadata: {
        tx_hash: txHash,
        eth_amount: deposit.ethAmount,
        eth_price_usd: ethPrice,
        from_address: deposit.from,
        block_number: deposit.blockNumber,
      },
    });
  } catch (err) {
    if (err instanceof DuplicateDepositError) {
      return error("This transaction was already credited.", 409, "Each tx_hash can only be used once.");
    }
    throw err;
  }

  return created({
    deposited_usd: usdAmount,
    eth_amount: deposit.ethAmount,
    eth_price_usd: ethPrice,
    balance_usd: balance.balance_usd,
    tx_hash: txHash,
    message: `Deposited $${usdAmount.toFixed(4)} USD (${deposit.ethAmount} ETH @ $${ethPrice.toFixed(2)}/ETH)`,
  });
}

/**
 * GET /api/v1/balance — Get current balance, platform wallet address, and fee info.
 */
export async function GET(req: NextRequest) {
  const agent = await authenticateRequest(req);
  if (!agent) return unauthorized();

  const balance = await getBalance(agent.id);
  const ethPrice = await getEthPriceUsd();

  // Get platform wallet address so agents know where to send ETH
  let platformWallet: string | null = null;
  try {
    const walletClient = getOrganizerWalletClient();
    platformWallet = walletClient.account.address;
  } catch {
    // RPC not configured — wallet won't be available
  }

  return success({
    agent_id: agent.id,
    balance_usd: balance.balance_usd,
    total_deposited_usd: balance.total_deposited_usd,
    total_spent_usd: balance.total_spent_usd,
    total_fees_usd: balance.total_fees_usd,
    eth_price_usd: ethPrice,
    platform_fee_pct: 0.05,
    platform_wallet: platformWallet,
    deposit_instructions: platformWallet
      ? `Send ETH to ${platformWallet}, then POST /api/v1/balance/deposit with the tx_hash.`
      : "Platform wallet not configured. Contact admin.",
  });
}
