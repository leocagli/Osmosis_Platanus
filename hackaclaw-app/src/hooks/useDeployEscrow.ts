"use client";

import { useState, useCallback } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  http,
  parseEther,
  type Hash,
} from "viem";
import { ESCROW_ABI, ESCROW_BYTECODE } from "@/lib/escrow-bytecode";

const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || "31337");
const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8545";
const platformWallet = process.env.NEXT_PUBLIC_PLATFORM_WALLET;

const appChain = defineChain({
  id: chainId,
  name: "hackaclaw",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});

interface DeployResult {
  contractAddress: string;
  txHash: string;
}

export function useDeployEscrow() {
  const [isDeploying, setIsDeploying] = useState(false);
  const [result, setResult] = useState<DeployResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const deploy = useCallback(
    async (options: {
      provider: unknown; // EIP-1193 provider from Privy wallet
      sponsorAddress: string;
      prizeAmountEth: string;
      deadlineUnix: number;
      entryFeeWei?: bigint;
    }) => {
      setIsDeploying(true);
      setError(null);
      setResult(null);

      try {
        if (!platformWallet) {
          throw new Error("Platform wallet not configured (NEXT_PUBLIC_PLATFORM_WALLET)");
        }

        const walletClient = createWalletClient({
          account: options.sponsorAddress as `0x${string}`,
          chain: appChain,
          transport: custom(options.provider as Parameters<typeof custom>[0]),
        });

        const publicClient = createPublicClient({
          chain: appChain,
          transport: http(rpcUrl),
        });

        const prizeWei = parseEther(options.prizeAmountEth);
        const entryFee = options.entryFeeWei ?? BigInt(0);

        // Deploy HackathonEscrow with platform as owner, sponsor as sponsor
        const txHash = await walletClient.deployContract({
          abi: ESCROW_ABI,
          bytecode: ESCROW_BYTECODE,
          args: [
            entryFee,
            BigInt(options.deadlineUnix),
            platformWallet as `0x${string}`,
            options.sponsorAddress as `0x${string}`,
          ],
          value: prizeWei,
        });

        // Wait for deployment receipt
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: txHash as Hash,
        });

        if (receipt.status !== "success") {
          throw new Error("Deploy transaction failed on-chain");
        }

        if (!receipt.contractAddress) {
          throw new Error("No contract address in deploy receipt");
        }

        const deployResult: DeployResult = {
          contractAddress: receipt.contractAddress,
          txHash,
        };
        setResult(deployResult);
        return deployResult;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Deploy failed";
        setError(message);
        return null;
      } finally {
        setIsDeploying(false);
      }
    },
    []
  );

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
    setIsDeploying(false);
  }, []);

  return { deploy, isDeploying, result, error, reset };
}
