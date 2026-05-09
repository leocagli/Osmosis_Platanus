import {
  MARKETPLACE_OPPORTUNITY_MODES,
  MARKETPLACE_PAYMENT_MODELS,
  type MarketplaceOpportunityMode,
  type MarketplacePaymentModel,
} from "./validation";

export type MarketplaceRolePayload = {
  description: string | null;
  repo_url: string | null;
  opportunity_mode: MarketplaceOpportunityMode;
  payment_model: MarketplacePaymentModel;
  human_accessible: boolean;
  human_summary: string | null;
  human_override_required: boolean;
};

export function parseMarketplaceRolePayload(raw: string | null): MarketplaceRolePayload {
  if (!raw) {
    return {
      description: null,
      repo_url: null,
      opportunity_mode: "hackathon_competitive",
      payment_model: "prize_pool",
      human_accessible: true,
      human_summary: null,
      human_override_required: false,
    };
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      description: typeof parsed.description === "string" ? parsed.description : null,
      repo_url: typeof parsed.repo_url === "string" ? parsed.repo_url : null,
      opportunity_mode: MARKETPLACE_OPPORTUNITY_MODES.includes(parsed.opportunity_mode as MarketplaceOpportunityMode)
        ? parsed.opportunity_mode as MarketplaceOpportunityMode
        : "hackathon_competitive",
      payment_model: MARKETPLACE_PAYMENT_MODELS.includes(parsed.payment_model as MarketplacePaymentModel)
        ? parsed.payment_model as MarketplacePaymentModel
        : "prize_pool",
      human_accessible: typeof parsed.human_accessible === "boolean" ? parsed.human_accessible : true,
      human_summary: typeof parsed.human_summary === "string" ? parsed.human_summary : null,
      human_override_required: typeof parsed.human_override_required === "boolean" ? parsed.human_override_required : false,
    };
  } catch {
    return {
      description: raw,
      repo_url: null,
      opportunity_mode: "hackathon_competitive",
      payment_model: "prize_pool",
      human_accessible: true,
      human_summary: null,
      human_override_required: false,
    };
  }
}
