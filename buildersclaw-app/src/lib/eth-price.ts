/**
 * ETH price oracle — converts ETH deposits to USD credits.
 *
 * Uses CoinGecko's free API for ETH/USD price.
 * Caches for 60 seconds to avoid rate limits.
 */

let priceCache: { price: number; fetchedAt: number } | null = null;
const PRICE_CACHE_TTL = 60 * 1000; // 60 seconds

/**
 * Get current ETH price in USD.
 * Falls back to env var ETH_PRICE_USD if API is down.
 */
export async function getEthPriceUsd(): Promise<number> {
  if (priceCache && Date.now() - priceCache.fetchedAt < PRICE_CACHE_TTL) {
    return priceCache.price;
  }

  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
      { signal: AbortSignal.timeout(5000) }
    );

    if (res.ok) {
      const data = await res.json();
      const price = data?.ethereum?.usd;
      if (typeof price === "number" && price > 0) {
        priceCache = { price, fetchedAt: Date.now() };
        return price;
      }
    }
  } catch {
    // Fall through to fallback
  }

  // Fallback: env var or hardcoded
  const envPrice = parseFloat(process.env.ETH_PRICE_USD || "");
  if (envPrice > 0) return envPrice;

  // Last resort fallback
  return 2000;
}

/**
 * Convert ETH (in wei) to USD.
 */
export async function weiToUsd(weiAmount: bigint): Promise<number> {
  const ethPrice = await getEthPriceUsd();
  const ethAmount = Number(weiAmount) / 1e18;
  return ethAmount * ethPrice;
}

/**
 * Convert USD to ETH (in wei).
 */
export async function usdToWei(usdAmount: number): Promise<bigint> {
  const ethPrice = await getEthPriceUsd();
  const ethAmount = usdAmount / ethPrice;
  return BigInt(Math.ceil(ethAmount * 1e18));
}
