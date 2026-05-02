import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "./db";
import { agents, type AgentRow } from "./db/schema";
import type { Agent } from "./types";

const TOKEN_PREFIX = "buildersclaw_";
const LEGACY_TOKEN_PREFIX = "hackaclaw_";
const TOKEN_BYTES = 32;

export function generateApiKey(): string {
  return `${TOKEN_PREFIX}${crypto.randomBytes(TOKEN_BYTES).toString("hex")}`;
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function validateApiKey(token: string): boolean {
  if (!token || typeof token !== "string") return false;

  let prefix: string;
  if (token.startsWith(TOKEN_PREFIX)) {
    prefix = TOKEN_PREFIX;
  } else if (token.startsWith(LEGACY_TOKEN_PREFIX)) {
    prefix = LEGACY_TOKEN_PREFIX;
  } else {
    return false;
  }

  const expectedLength = prefix.length + TOKEN_BYTES * 2;
  if (token.length !== expectedLength) return false;
  const body = token.slice(prefix.length);
  return /^[0-9a-f]+$/i.test(body);
}

export function extractToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const parts = authHeader.split(" ");
  if (parts.length !== 2) return null;
  if (parts[0].toLowerCase() !== "bearer") return null;
  return parts[1];
}

export async function authenticateToken(token: string): Promise<Agent | null> {
  if (!token || !validateApiKey(token)) return null;

  const keyHash = hashToken(token);

  const [agent] = await getDb()
    .select()
    .from(agents)
    .where(and(eq(agents.apiKeyHash, keyHash), eq(agents.status, "active")))
    .limit(1);

  if (!agent) return null;

  await getDb().update(agents).set({ lastActive: new Date().toISOString() }).where(eq(agents.id, agent.id));

  return toAgent(agent);
}

function toAgent(agent: AgentRow): Agent {
  return {
    id: agent.id,
    name: agent.name,
    display_name: agent.displayName,
    description: agent.description,
    avatar_url: agent.avatarUrl,
    wallet_address: agent.walletAddress,
    api_key_hash: agent.apiKeyHash,
    model: agent.model,
    personality: agent.personality,
    strategy: agent.strategy,
    total_earnings: agent.totalEarnings,
    total_hackathons: agent.totalHackathons,
    total_wins: agent.totalWins,
    reputation_score: agent.reputationScore,
    identity_registry: agent.identityRegistry,
    identity_agent_id: agent.identityAgentId,
    identity_chain_id: agent.identityChainId,
    identity_agent_uri: agent.identityAgentUri,
    identity_wallet: agent.identityWallet,
    identity_owner_wallet: agent.identityOwnerWallet,
    identity_source: agent.identitySource,
    identity_link_status: agent.identityLinkStatus,
    identity_verified_at: agent.identityVerifiedAt,
    marketplace_reputation_score: agent.marketplaceReputationScore,
    marketplace_completed_roles: agent.marketplaceCompletedRoles,
    marketplace_successful_roles: agent.marketplaceSuccessfulRoles,
    marketplace_failed_roles: agent.marketplaceFailedRoles,
    marketplace_review_approvals: agent.marketplaceReviewApprovals,
    marketplace_no_show_count: agent.marketplaceNoShowCount,
    status: agent.status,
    created_at: agent.createdAt,
    last_active: agent.lastActive,
  };
}

export function authenticateAdminToken(token: string): boolean {
  const adminApiKey = process.env.ADMIN_API_KEY;
  if (!token || !adminApiKey) return false;
  if (token.length !== adminApiKey.length) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(adminApiKey));
}
