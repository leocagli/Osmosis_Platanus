import type { FastifyInstance } from "fastify";
import { creditBalance, getBalance, DuplicateDepositError } from "@buildersclaw/shared/balance";
import { getUsdcAddress, getUsdcDecimals, getUsdcSymbol, verifyDepositTransaction, getOrganizerWalletClient } from "@buildersclaw/shared/chain";
import { getDepositTransactionGuide } from "@buildersclaw/shared/chain-prerequisites";
import { ok, created, fail, unauthorized } from "../respond";

function fmt(value: bigint, decimals: number): string {
  const s = value.toString().padStart(decimals + 1, "0");
  const int = s.slice(0, s.length - decimals) || "0";
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}
import { authFastify } from "../auth";

export async function balanceRoutes(fastify: FastifyInstance) {
  // POST /api/v1/balance — Verify a deposit tx and credit balance
  fastify.post("/api/v1/balance", async (req, reply) => {
    const agent = await authFastify(req);
    if (!agent) return unauthorized(reply);

    const body = req.body as { tx_hash?: string } || {};
    const txHash = body.tx_hash?.trim();

    if (!txHash) {
      let platformWallet: string | null = null;
      try { const wc = getOrganizerWalletClient(); platformWallet = wc.account?.address ?? null; } catch { /* chain not configured */ }
      const depositGuide = getDepositTransactionGuide({ platformWallet, rpcUrl: process.env.RPC_URL || null });
      return fail(reply, `tx_hash is required. Send ${getUsdcSymbol()} to the platform wallet first, then submit the transaction hash here.`, 400, {
        how_to_deposit: depositGuide,
        platform_wallet: platformWallet,
        chain: { chain_id: process.env.CHAIN_ID ? Number(process.env.CHAIN_ID) : null, rpc_url: process.env.RPC_URL || null },
      });
    }

    if (!agent.wallet_address) {
      return fail(reply, "Register your wallet_address before depositing USDC.", 400);
    }

    let deposit;
    try {
      deposit = await verifyDepositTransaction({ txHash, expectedFrom: agent.wallet_address });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to verify deposit";
      return fail(reply, msg, 400, {
        help: `Ensure the transaction transferred ${getUsdcSymbol()} from your registered wallet to the correct platform wallet and was confirmed on-chain.`,
        setup_guide: "GET /api/v1/chain/setup",
      });
    }

    const usdAmount = Number(fmt(deposit.value, deposit.decimals));
    if (usdAmount < 0.001) return fail(reply, "Deposit too small. Minimum ~$0.001 USD.", 400);

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
          token_amount_display: fmt(deposit.value, deposit.decimals),
          from_address: deposit.from,
          block_number: deposit.blockNumber,
        },
      });
    } catch (err) {
      if (err instanceof DuplicateDepositError) {
        return fail(reply, "This transaction was already credited.", 409, "Each tx_hash can only be used once.");
      }
      throw err;
    }

    return created(reply, {
      deposited_usd: usdAmount,
      token_symbol: deposit.symbol,
      token_amount: fmt(deposit.value, deposit.decimals),
      balance_usd: balance.balance_usd,
      tx_hash: txHash,
      message: `Deposited $${usdAmount.toFixed(4)} USD via ${fmt(deposit.value, deposit.decimals)} ${deposit.symbol}`,
    });
  });

  // GET /api/v1/balance — Current balance and deposit instructions
  fastify.get("/api/v1/balance", async (req, reply) => {
    const agent = await authFastify(req);
    if (!agent) return unauthorized(reply);

    const balance = await getBalance(agent.id);
    let platformWallet: string | null = null;
    try { const wc = getOrganizerWalletClient(); platformWallet = wc.account?.address ?? null; } catch { /* */ }

    return ok(reply, {
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
  });
}
