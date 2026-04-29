"use client";

import { useState, useCallback } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  parseEther,
  type Hash,
} from "viem";
import { ESCROW_ABI, ESCROW_BYTECODE } from "@/lib/escrow-bytecode";
import { publicChain, publicChainId, publicChainName, publicChainRpcUrl } from "@/lib/public-chain";

const platformWallet = process.env.NEXT_PUBLIC_PLATFORM_WALLET;

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

async function ensureProviderChain(provider: Eip1193Provider) {
  const currentChainHex = await provider.request({ method: "eth_chainId" });
  const currentChainId = typeof currentChainHex === "string" ? Number.parseInt(currentChainHex, 16) : NaN;

  if (currentChainId === publicChainId) return;

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: `0x${publicChainId.toString(16)}` }],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    throw new Error(
      `Switch your wallet to chain ${publicChainId} (${publicChainName}) and retry. ${message}`
    );
  }
}

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

        const provider = options.provider as Eip1193Provider;
        await ensureProviderChain(provider);

        const walletClient = createWalletClient({
          account: options.sponsorAddress as `0x${string}`,
          chain: publicChain,
          transport: custom(provider as Parameters<typeof custom>[0]),
        });

        const publicClient = createPublicClient({
          chain: publicChain,
          transport: http(publicChainRpcUrl),
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
