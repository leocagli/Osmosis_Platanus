import { defineChain, type Chain } from "viem";
import { avalancheFuji, foundry, localhost } from "viem/chains";

type ChainOverrideOptions = {
  chainId: number;
  rpcUrl?: string;
  fallbackName?: string;
  fallbackCurrencyName?: string;
  fallbackCurrencySymbol?: string;
};

const KNOWN_CHAINS: Record<number, Chain> = {
  43113: avalancheFuji,
  31337: foundry,
  1337: localhost,
};

function withRpcOverride(chain: Chain, rpcUrl?: string): Chain {
  if (!rpcUrl) return chain;

  return {
    ...chain,
    rpcUrls: {
      ...chain.rpcUrls,
      default: {
        ...chain.rpcUrls.default,
        http: [rpcUrl],
      },
    },
  };
}

export function resolveChain(options: ChainOverrideOptions): Chain {
  const knownChain = KNOWN_CHAINS[options.chainId];
  if (knownChain) {
    return withRpcOverride(knownChain, options.rpcUrl);
  }

  return defineChain({
    id: options.chainId,
    name: options.fallbackName || `chain-${options.chainId}`,
    nativeCurrency: {
      name: options.fallbackCurrencyName || "Ether",
      symbol: options.fallbackCurrencySymbol || "ETH",
      decimals: 18,
    },
    rpcUrls: {
      default: {
        http: [options.rpcUrl || "http://127.0.0.1:8545"],
      },
    },
  });
}
