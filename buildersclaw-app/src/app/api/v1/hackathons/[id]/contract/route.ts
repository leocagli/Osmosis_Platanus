import { NextRequest } from "next/server";
import { getEscrowTokenConfig, getPublicChainClient, getConfiguredChainId, normalizeAddress } from "@/lib/chain";
import { parseHackathonMeta } from "@/lib/hackathons";
import { error, notFound, success } from "@/lib/responses";
import { supabaseAdmin } from "@/lib/supabase";
import { parseAbi, type Address } from "viem";
import { getJoinTransactionGuide, getClaimTransactionGuide, getChainSetupGuide } from "@/lib/chain-prerequisites";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const escrowAbi = parseAbi([
  "function entryFee() view returns (uint256)",
  "function hasJoined(address) view returns (bool)",
  "function finalized() view returns (bool)",
  "function getWinners() view returns (address[])",
  "function getWinnerShare(address) view returns (uint256)",
  "function winnerCount() view returns (uint256)",
  "function hasClaimed(address) view returns (bool)",
  "function totalPrizeAtFinalize() view returns (uint256)",
  "function sponsor() view returns (address)",
  "function prizePool() view returns (uint256)",
]);

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/hackathons/:id/contract — Contract info for on-chain interaction.
 * Public endpoint (no auth). Returns ABI, chain info, and live contract state.
 */
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id: hackathonId } = await params;
  const { data: hackathon } = await supabaseAdmin
    .from("hackathons").select("judging_criteria").eq("id", hackathonId).single();

  if (!hackathon) return notFound("Hackathon");

  const meta = parseHackathonMeta(hackathon.judging_criteria);
  if (!meta.contract_address) {
    return notFound("This hackathon has no on-chain contract");
  }

  let contractAddress: Address;
  try {
    contractAddress = normalizeAddress(meta.contract_address);
  } catch {
    return error("Invalid contract address in hackathon metadata", 500);
  }

  const chainId = meta.chain_id ?? getConfiguredChainId();
  const rpcUrl = process.env.RPC_URL || null;

  // Read live contract state
  const publicClient = getPublicChainClient();
  let status;
  try {
    const [finalized, winnersArr, winnerCountVal, sponsorAddr, prizePoolUnits, entryFeeUnits, totalPrizeUnits] = await Promise.all([
      publicClient.readContract({ address: contractAddress, abi: escrowAbi, functionName: "finalized" }),
      publicClient.readContract({ address: contractAddress, abi: escrowAbi, functionName: "getWinners" }),
      publicClient.readContract({ address: contractAddress, abi: escrowAbi, functionName: "winnerCount" }),
      publicClient.readContract({ address: contractAddress, abi: escrowAbi, functionName: "sponsor" }),
      publicClient.readContract({ address: contractAddress, abi: escrowAbi, functionName: "prizePool" }),
      publicClient.readContract({ address: contractAddress, abi: escrowAbi, functionName: "entryFee" }),
      publicClient.readContract({ address: contractAddress, abi: escrowAbi, functionName: "totalPrizeAtFinalize" }),
    ]);

    const winners = (winnersArr as string[]).filter(
      (w) => w !== "0x0000000000000000000000000000000000000000",
    );
    const sponsorAddress = sponsorAddr as string;
    const token = await getEscrowTokenConfig(contractAddress);

    status = {
      finalized: finalized as boolean,
      winners,
      winner_count: Number(winnerCountVal),
      sponsor: sponsorAddress === "0x0000000000000000000000000000000000000000" ? null : sponsorAddress,
      prize_pool_units: (prizePoolUnits as bigint).toString(),
      total_prize_at_finalize_units: (totalPrizeUnits as bigint).toString(),
      entry_fee_units: (entryFeeUnits as bigint).toString(),
      token_address: token.tokenAddress,
      token_symbol: token.symbol,
      token_decimals: token.decimals,
    };
  } catch {
    status = null;
  }

  return success({
    hackathon_id: hackathonId,
    contract_address: contractAddress,
    chain_id: chainId,
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
      winnerCount: "function winnerCount() view returns (uint256)",
      hasClaimed: "function hasClaimed(address) view returns (bool)",
      totalPrizeAtFinalize: "function totalPrizeAtFinalize() view returns (uint256)",
      sponsor: "function sponsor() view returns (address)",
      prizePool: "function prizePool() view returns (uint256)",
      entryFee: "function entryFee() view returns (uint256)",
    },
    status,
    transaction_guides: {
      join: getJoinTransactionGuide({
        contractAddress,
        entryFeeUnits: status?.entry_fee_units ?? "0",
        tokenAddress: status?.token_address ?? (process.env.USDC_ADDRESS || "USDC_TOKEN_ADDRESS"),
        tokenSymbol: status?.token_symbol ?? (process.env.USDC_SYMBOL || "USDC"),
        chainId,
        rpcUrl,
        hackathonId,
      }),
      claim: getClaimTransactionGuide({
        contractAddress,
        rpcUrl,
      }),
      setup: "GET /api/v1/chain/setup for full Foundry installation + key management instructions.",
    },
  });
}
