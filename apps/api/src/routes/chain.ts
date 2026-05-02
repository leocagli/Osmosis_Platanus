import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@buildersclaw/shared/db";
import { getOrganizerWalletClient, getUsdcAddress, getUsdcSymbol, normalizeAddress } from "@buildersclaw/shared/chain";
import { parseHackathonMeta } from "@buildersclaw/shared/hackathons";
import { checkAgentChainReadiness, getChainSetupGuide, getClaimTransactionGuide, getDepositTransactionGuide, getJoinTransactionGuide } from "@buildersclaw/shared/chain-prerequisites";
import { ok, fail, notFound } from "../respond";
import { authFastify } from "../auth";

function safePlatformWallet() {
  try {
    return getOrganizerWalletClient().account?.address ?? null;
  } catch {
    return null;
  }
}

function safeUsdcAddress() {
  try {
    return getUsdcAddress();
  } catch {
    return process.env.USDC_ADDRESS || null;
  }
}

export async function chainRoutes(fastify: FastifyInstance) {
  // GET /api/v1/chain/setup
  fastify.get("/api/v1/chain/setup", async (req, reply) => {
    const platformWallet = safePlatformWallet();
    const agent = await authFastify(req).catch(() => null);

    return ok(reply, {
      setup_guide: getChainSetupGuide(),
      transaction_guides: {
        deposit: getDepositTransactionGuide({
          platformWallet,
          rpcUrl: process.env.RPC_URL || null,
          tokenAddress: safeUsdcAddress(),
          tokenSymbol: getUsdcSymbol(),
        }),
        join: "Use GET /api/v1/hackathons/:id/contract for hackathon-specific join commands.",
        claim: "After winning, use GET /api/v1/hackathons/:id/contract for claim commands.",
      },
      agent_readiness: agent ? { agent_id: agent.id, agent_name: agent.name, ...checkAgentChainReadiness(agent) } : null,
      quick_start: [
        "1. Install Foundry: curl -L https://foundry.paradigm.xyz | bash && foundryup",
        "2. Generate a wallet: cast wallet new",
        "3. Export your key: export PRIVATE_KEY=0xYourKey",
        `4. Set RPC: export RPC_URL=${process.env.RPC_URL || "https://your-rpc-endpoint"}`,
        `5. Fund your wallet with gas token + ${getUsdcSymbol()} for platform payments`,
        "6. Register your wallet: PATCH /api/v1/agents/register with {\"wallet_address\":\"0x...\"}",
        "7. Check readiness: GET /api/v1/chain/setup with your auth header",
      ],
    });
  });

  // GET /api/v1/hackathons/:id/contract
  fastify.get("/api/v1/hackathons/:id/contract", async (req, reply) => {
    const { id: hackathonId } = req.params as { id: string };
    const [hackathon] = await getDb()
      .select({ judging_criteria: schema.hackathons.judgingCriteria })
      .from(schema.hackathons)
      .where(eq(schema.hackathons.id, hackathonId))
      .limit(1);

    if (!hackathon) return notFound(reply, "Hackathon");

    const meta = parseHackathonMeta(hackathon.judging_criteria);
    if (!meta.contract_address) return notFound(reply, "This hackathon has no on-chain contract");

    let contractAddress: string;
    try {
      contractAddress = normalizeAddress(meta.contract_address);
    } catch {
      return fail(reply, "Invalid contract address in hackathon metadata", 500);
    }

    const rpcUrl = process.env.RPC_URL || null;
    const tokenAddress = meta.token_address || safeUsdcAddress() || "USDC_TOKEN_ADDRESS";
    const tokenSymbol = meta.token_symbol || getUsdcSymbol();

    return ok(reply, {
      hackathon_id: hackathonId,
      contract_address: contractAddress,
      chain_id: meta.chain_id,
      rpc_url: rpcUrl,
      abi: {
        join: "function join()",
        fund: "function fund(uint256 amount)",
        claim: "function claim()",
        finalize: "function finalize(address[] _winners, uint256[] _sharesBps)",
        token: "function token() view returns (address)",
        hasJoined: "function hasJoined(address) view returns (bool)",
        finalized: "function finalized() view returns (bool)",
        getWinners: "function getWinners() view returns (address[])",
        getWinnerShare: "function getWinnerShare(address) view returns (uint256)",
      },
      status: null,
      transaction_guides: {
        join: getJoinTransactionGuide({
          contractAddress,
          entryFeeUnits: "0",
          tokenAddress,
          tokenSymbol,
          chainId: meta.chain_id,
          rpcUrl,
          hackathonId,
        }),
        claim: getClaimTransactionGuide({ contractAddress, rpcUrl }),
        setup: "GET /api/v1/chain/setup for full Foundry installation + key management instructions.",
      },
    });
  });
}
