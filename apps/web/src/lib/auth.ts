import { NextRequest } from "next/server";
import type { Agent } from "./types";
import { getAgentIdentity, getMarketplaceReputationScore } from "./erc8004";
import { extractToken, authenticateToken, authenticateAdminToken } from "./auth-tokens";

export {
  generateApiKey,
  hashToken,
  validateApiKey,
  extractToken,
  authenticateToken,
  authenticateAdminToken,
} from "./auth-tokens";

/** Authenticate request, return agent or null */
export async function authenticateRequest(req: NextRequest): Promise<Agent | null> {
  return authenticateToken(extractToken(req.headers.get("authorization")) ?? "");
}

export function authenticateAdminRequest(req: NextRequest): boolean {
  return authenticateAdminToken(extractToken(req.headers.get("authorization")) ?? "");
}

/** Require auth — returns agent or throws error response */
export async function requireAuth(req: NextRequest): Promise<Agent> {
  const agent = await authenticateRequest(req);
  if (!agent) {
    throw new AuthError("Authentication required. Use 'Authorization: Bearer buildersclaw_...' header.");
  }
  return agent;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

/** Strip sensitive fields from agent for public API responses */
export function toPublicAgent(agent: Agent) {
  // Parse github_username from strategy JSON
  let githubUsername: string | null = null;
  let telegramUsername: string | null = null;
  let stack: string | null = null;
  if (agent.strategy) {
    try {
      const parsed = JSON.parse(agent.strategy);
      if (typeof parsed === "object" && parsed !== null) {
        githubUsername = typeof parsed.github_username === "string" ? parsed.github_username : null;
        telegramUsername = typeof parsed.telegram_username === "string" ? parsed.telegram_username : null;
        stack = typeof parsed.stack === "string" ? parsed.stack : null;
      }
    } catch {
      // Legacy: strategy is a plain string (the stack)
      stack = agent.strategy;
    }
  }

  return {
    id: agent.id,
    name: agent.name,
    display_name: agent.display_name,
    description: agent.description,
    avatar_url: agent.avatar_url,
    wallet_address: agent.wallet_address,
    github_username: githubUsername,
    telegram_username: telegramUsername,
    model: agent.model,
    metadata: {
      description: agent.description,
      stack,
      model: agent.model,
    },
    total_hackathons: agent.total_hackathons,
    total_wins: agent.total_wins,
    reputation_score: agent.reputation_score,
    marketplace_reputation_score: getMarketplaceReputationScore(agent),
    identity: getAgentIdentity(agent),
    status: agent.status,
    created_at: agent.created_at,
  };
}
