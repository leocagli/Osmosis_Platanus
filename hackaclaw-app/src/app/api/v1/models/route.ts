import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { listModels } from "@/lib/openrouter";
import { success, error, unauthorized } from "@/lib/responses";
import { PLATFORM_FEE_PCT } from "@/lib/balance";

/**
 * GET /api/v1/models — List available OpenRouter models with pricing.
 *
 * Shows the actual model cost + our 5% fee so agents know what they'll pay.
 * Optional query params: ?search=claude&max_price=0.01
 */
export async function GET(req: NextRequest) {
  const agent = await authenticateRequest(req);
  if (!agent) return unauthorized();

  try {
    const models = await listModels();

    const search = req.nextUrl.searchParams.get("search")?.toLowerCase();
    const maxPrice = parseFloat(req.nextUrl.searchParams.get("max_price") || "") || null;

    let filtered = models;

    if (search) {
      filtered = filtered.filter(
        (m) =>
          m.id.toLowerCase().includes(search) ||
          m.name.toLowerCase().includes(search)
      );
    }

    // Map to our pricing format (model cost + 5% fee)
    const result = filtered.map((m) => {
      const promptPrice = parseFloat(m.pricing.prompt) || 0;
      const completionPrice = parseFloat(m.pricing.completion) || 0;

      const promptWithFee = promptPrice * (1 + PLATFORM_FEE_PCT);
      const completionWithFee = completionPrice * (1 + PLATFORM_FEE_PCT);

      return {
        id: m.id,
        name: m.name,
        description: m.description || null,
        context_length: m.context_length,
        pricing: {
          prompt_per_token: promptPrice,
          completion_per_token: completionPrice,
          prompt_per_million: promptPrice * 1_000_000,
          completion_per_million: completionPrice * 1_000_000,
        },
        pricing_with_fee: {
          prompt_per_token: promptWithFee,
          completion_per_token: completionWithFee,
          prompt_per_million: promptWithFee * 1_000_000,
          completion_per_million: completionWithFee * 1_000_000,
          fee_pct: PLATFORM_FEE_PCT,
        },
      };
    });

    // Filter by max price if specified
    const finalResult = maxPrice
      ? result.filter((m) => m.pricing.prompt_per_million <= maxPrice)
      : result;

    return success({
      models: finalResult.slice(0, 200),
      total: finalResult.length,
      platform_fee_pct: PLATFORM_FEE_PCT,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to fetch models";
    return error(msg, 502);
  }
}
