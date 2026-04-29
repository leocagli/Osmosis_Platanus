"use client";

import { useState, useCallback } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  parseAbi,
  parseUnits,
  type Hash,
} from "viem";
import { ESCROW_ABI, ESCROW_BYTECODE } from "@/lib/escrow-bytecode";
import { publicChain, publicChainId, publicChainName, publicChainRpcUrl } from "@/lib/public-chain";

const platformWallet = process.env.NEXT_PUBLIC_PLATFORM_WALLET;
const usdcAddress = process.env.NEXT_PUBLIC_USDC_ADDRESS;
const usdcDecimals = Number(process.env.NEXT_PUBLIC_USDC_DECIMALS || "18");
const erc20Abi = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);

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
        prizeAmountUsdc: string;
        deadlineUnix: number;
        entryFeeUnits?: bigint;
      }) => {
      setIsDeploying(true);
      setError(null);
      setResult(null);

      try {
        if (!platformWallet) {
          throw new Error("Platform wallet not configured (NEXT_PUBLIC_PLATFORM_WALLET)");
        }
        if (!usdcAddress) {
          throw new Error("USDC token not configured (NEXT_PUBLIC_USDC_ADDRESS)");
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

        const prizeUnits = parseUnits(options.prizeAmountUsdc, usdcDecimals);
        const entryFee = options.entryFeeUnits ?? BigInt(0);

        // Deploy HackathonEscrow with platform as owner, sponsor as sponsor
        const txHash = await walletClient.deployContract({
          abi: ESCROW_ABI,
          bytecode: ESCROW_BYTECODE,
          args: [
            usdcAddress as `0x${string}`,
            entryFee,
            BigInt(options.deadlineUnix),
            platformWallet as `0x${string}`,
            options.sponsorAddress as `0x${string}`,
          ],
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

        if (prizeUnits > BigInt(0)) {
          const approveHash = await walletClient.writeContract({
            address: usdcAddress as `0x${string}`,
            abi: erc20Abi,
            functionName: "approve",
            args: [receipt.contractAddress, prizeUnits],
            account: options.sponsorAddress as `0x${string}`,
            chain: publicChain,
          });

          const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveHash as Hash });
          if (approveReceipt.status !== "success") {
            throw new Error("USDC approve transaction failed on-chain");
          }

          const fundHash = await walletClient.writeContract({
            address: receipt.contractAddress,
            abi: ESCROW_ABI,
            functionName: "fund",
            args: [prizeUnits],
            account: options.sponsorAddress as `0x${string}`,
            chain: publicChain,
          });

          const fundReceipt = await publicClient.waitForTransactionReceipt({ hash: fundHash as Hash });
          if (fundReceipt.status !== "success") {
            throw new Error("Escrow funding transaction failed on-chain");
          }
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
