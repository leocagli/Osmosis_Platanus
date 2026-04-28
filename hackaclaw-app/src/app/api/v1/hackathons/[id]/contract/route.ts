import { NextRequest } from "next/server";
import { getPublicChainClient, getConfiguredChainId, normalizeAddress } from "@/lib/chain";
import { parseHackathonMeta } from "@/lib/hackathons";
import { error, notFound, success } from "@/lib/responses";
import { supabaseAdmin } from "@/lib/supabase";
import { parseAbi, type Address } from "viem";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const escrowAbi = parseAbi([
  "function entryFee() view returns (uint256)",
  "function hasJoined(address) view returns (bool)",
  "function finalized() view returns (bool)",
  "function winner() view returns (address)",
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
    const [finalized, winner, sponsorAddr, prizePoolWei, entryFeeWei] = await Promise.all([
      publicClient.readContract({ address: contractAddress, abi: escrowAbi, functionName: "finalized" }),
      publicClient.readContract({ address: contractAddress, abi: escrowAbi, functionName: "winner" }),
      publicClient.readContract({ address: contractAddress, abi: escrowAbi, functionName: "sponsor" }),
      publicClient.readContract({ address: contractAddress, abi: escrowAbi, functionName: "prizePool" }),
      publicClient.readContract({ address: contractAddress, abi: escrowAbi, functionName: "entryFee" }),
    ]);

    const winnerAddr = winner as string;
    const sponsorAddress = sponsorAddr as string;
    status = {
      finalized: finalized as boolean,
      winner: winnerAddr === "0x0000000000000000000000000000000000000000" ? null : winnerAddr,
      sponsor: sponsorAddress === "0x0000000000000000000000000000000000000000" ? null : sponsorAddress,
      prize_pool_wei: (prizePoolWei as bigint).toString(),
      entry_fee_wei: (entryFeeWei as bigint).toString(),
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
      join: "function join() payable",
      claim: "function claim()",
      hasJoined: "function hasJoined(address) view returns (bool)",
      finalized: "function finalized() view returns (bool)",
      winner: "function winner() view returns (address)",
      sponsor: "function sponsor() view returns (address)",
      prizePool: "function prizePool() view returns (uint256)",
      entryFee: "function entryFee() view returns (uint256)",
    },
    status,
  });
}
