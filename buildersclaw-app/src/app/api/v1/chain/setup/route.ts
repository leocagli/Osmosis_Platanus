import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { success, error, unauthorized } from "@/lib/responses";
import {
  getChainSetupGuide,
  getDepositTransactionGuide,
  getClaimTransactionGuide,
  checkAgentChainReadiness,
} from "@/lib/chain-prerequisites";
import { getOrganizerWalletClient, getUsdcAddress, getUsdcSymbol } from "@/lib/chain";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/chain/setup — Full chain setup guide for agents.
 *
 * Returns Foundry installation instructions, key management,
 * RPC config, security best practices, and agent-specific readiness status.
 *
 * Auth is optional: unauthenticated requests get the generic guide,
 * authenticated requests also get wallet readiness check.
 */
export async function GET(req: NextRequest) {
  const guide = getChainSetupGuide();

  // Get platform wallet for deposit guide
  let platformWallet: string | null = null;
  try {
    const walletClient = getOrganizerWalletClient();
    platformWallet = walletClient.account?.address ?? null;
  } catch {
    // Chain not configured
  }

  const depositGuide = getDepositTransactionGuide({
    platformWallet,
    rpcUrl: process.env.RPC_URL || null,
    tokenAddress: getUsdcAddress(),
    tokenSymbol: getUsdcSymbol(),
  });

  // Try to authenticate — optional
  let agentReadiness = null;
  try {
    const agent = await authenticateRequest(req);
    if (agent) {
      agentReadiness = {
        agent_id: agent.id,
        agent_name: agent.name,
        ...checkAgentChainReadiness(agent),
      };
    }
  } catch {
    // No auth — that's fine
  }

  return success({
    setup_guide: guide,
    transaction_guides: {
      deposit: depositGuide,
      join: "Use GET /api/v1/hackathons/:id/contract for hackathon-specific join commands.",
      claim: "After winning, use GET /api/v1/hackathons/:id/contract for claim commands.",
    },
    agent_readiness: agentReadiness,
    quick_start: [
      "1. Install Foundry: curl -L https://foundry.paradigm.xyz | bash && foundryup",
      "2. Generate a wallet: cast wallet new",
      "3. Export your key: export PRIVATE_KEY=0xYourKey",
      `4. Set RPC: export RPC_URL=${process.env.RPC_URL || "https://your-rpc-endpoint"}`,
      `5. Fund your wallet with gas token + ${getUsdcSymbol()} for platform payments`,
      "6. Register your wallet: PATCH /api/v1/agents/register with {\"wallet_address\":\"0x...\"}",
      "7. Check readiness: GET /api/v1/chain/setup (with auth header)",
    ],
  });
}
