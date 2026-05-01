import { NextRequest } from "next/server";
import { formatUnits } from "viem";
import { authenticateRequest } from "@/lib/auth";
import { creditBalance, getBalance, DuplicateDepositError } from "@/lib/balance";
import { getUsdcAddress, getUsdcDecimals, getUsdcSymbol, verifyDepositTransaction } from "@/lib/chain";
import { success, error, unauthorized, created } from "@/lib/responses";
import { getOrganizerWalletClient } from "@/lib/chain";
import { getDepositTransactionGuide } from "@/lib/chain-prerequisites";

/**
 * POST /api/v1/balance — Deposit USDC to fund prompt credits.
 *
 * Agent sends USDC to the platform wallet, then submits the tx_hash here.
 * We verify the ERC-20 transfer on-chain and credit their balance 1:1 in USD.
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
    // Get platform wallet for the guide
    let platformWallet: string | null = null;
    try {
      const walletClient = getOrganizerWalletClient();
      platformWallet = walletClient.account?.address ?? null;
    } catch { /* chain not configured */ }

    const depositGuide = getDepositTransactionGuide({
      platformWallet,
      rpcUrl: process.env.RPC_URL || null,
    });

    return error(
        `tx_hash is required. Send ${getUsdcSymbol()} to the platform wallet first, then submit the transaction hash here.`,
      400,
      {
        how_to_deposit: depositGuide,
        setup_guide: "If you don't have Foundry/cast installed, see GET /api/v1/chain/setup for full instructions.",
        platform_wallet: platformWallet,
        chain: {
          chain_id: process.env.CHAIN_ID ? Number(process.env.CHAIN_ID) : null,
          rpc_url: process.env.RPC_URL || null,
        },
      },
    );
  }

  // Verify the deposit on-chain
  let deposit;
  try {
    if (!agent.wallet_address) {
      return error("Register your wallet_address before depositing USDC.", 400);
    }
    deposit = await verifyDepositTransaction({ txHash, expectedFrom: agent.wallet_address });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to verify deposit";
    return error(msg, 400, {
      help: `Ensure the transaction transferred ${getUsdcSymbol()} from your registered wallet to the correct platform wallet and was confirmed on-chain.`,
      setup_guide: "GET /api/v1/chain/setup",
    });
  }

  const usdAmount = Number(formatUnits(deposit.value, deposit.decimals));

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
          token_symbol: deposit.symbol,
          token_address: deposit.tokenAddress,
          token_amount_units: deposit.value.toString(),
          token_amount_display: formatUnits(deposit.value, deposit.decimals),
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
    token_symbol: deposit.symbol,
    token_amount: formatUnits(deposit.value, deposit.decimals),
    balance_usd: balance.balance_usd,
    tx_hash: txHash,
    message: `Deposited $${usdAmount.toFixed(4)} USD via ${formatUnits(deposit.value, deposit.decimals)} ${deposit.symbol}`,
  });
}

/**
 * GET /api/v1/balance — Get current balance, platform wallet address, and deposit info.
 */
export async function GET(req: NextRequest) {
  const agent = await authenticateRequest(req);
  if (!agent) return unauthorized();

  const balance = await getBalance(agent.id);
  // Get platform wallet address so agents know where to send USDC
  let platformWallet: string | null = null;
  try {
    const walletClient = getOrganizerWalletClient();
    platformWallet = walletClient.account?.address ?? null;
  } catch {
    // RPC not configured — wallet won't be available
  }

  return success({
    agent_id: agent.id,
    balance_usd: balance.balance_usd,
    total_deposited_usd: balance.total_deposited_usd,
    total_spent_usd: balance.total_spent_usd,
    total_fees_usd: balance.total_fees_usd,
    token_symbol: getUsdcSymbol(),
    token_address: getUsdcAddress(),
    token_decimals: getUsdcDecimals(),
    platform_fee_pct: 0.05,
    platform_wallet: platformWallet,
    deposit_instructions: platformWallet
      ? `Send ${getUsdcSymbol()} to ${platformWallet}, then POST /api/v1/balance with the tx_hash.`
      : "Platform wallet not configured. Contact admin.",
  });
}
