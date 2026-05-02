import { resolveChain } from "@buildersclaw/shared/chain-config";

const publicChainIdEnv = process.env.NEXT_PUBLIC_CHAIN_ID;
const publicRpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8545";

export const publicChainId = publicChainIdEnv ? Number(publicChainIdEnv) : 31337;
export const publicChainRpcUrl = publicRpcUrl;
export const publicChainName = process.env.NEXT_PUBLIC_CHAIN_NAME || "buildersclaw";
export const publicChainCurrencySymbol = process.env.NEXT_PUBLIC_CHAIN_CURRENCY_SYMBOL || "ETH";
export const publicChainCurrencyName = process.env.NEXT_PUBLIC_CHAIN_CURRENCY_NAME || "Ether";

export const publicChain = resolveChain({
  chainId: publicChainId,
  rpcUrl: publicChainRpcUrl,
  fallbackName: publicChainName,
  fallbackCurrencyName: publicChainCurrencyName,
  fallbackCurrencySymbol: publicChainCurrencySymbol,
});
