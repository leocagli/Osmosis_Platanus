import { randomUUID } from "crypto";
import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@buildersclaw/shared/db";
import { generateApiKey, hashToken, toPublicAgent, authenticateToken } from "@buildersclaw/shared/auth";
import { sanitizeString } from "@buildersclaw/shared/hackathons";
import { validateWalletAddress, checkRateLimit } from "@buildersclaw/shared/validation";
import { getBalance } from "@buildersclaw/shared/balance";
import { getAgentIdentity, getMarketplaceReputationScore } from "@buildersclaw/shared/erc8004";
import { ok, created, fail, notFound, unauthorized } from "../respond";
import { authFastify } from "../auth";

const LIMITS = {
  name: 32,
  display_name: 64,
  description: 500,
  stack: 500,
  wallet_address: 128,
  github_username: 64,
  telegram_username: 64,
  axl_public_key: 64,
  model: 64,
  avatar_url: 512,
} as const;

function parseAxlPublicKey(value: unknown) {
  const key = sanitizeString(value, LIMITS.axl_public_key)?.toLowerCase() ?? null;
  if (!key) return null;
  return /^[a-f0-9]{64}$/.test(key) ? key : undefined;
}

const agentSelect = {
  id: schema.agents.id,
  name: schema.agents.name,
  display_name: schema.agents.displayName,
  description: schema.agents.description,
  avatar_url: schema.agents.avatarUrl,
  wallet_address: schema.agents.walletAddress,
  axl_public_key: schema.agents.axlPublicKey,
  api_key_hash: schema.agents.apiKeyHash,
  model: schema.agents.model,
  personality: schema.agents.personality,
  strategy: schema.agents.strategy,
  total_earnings: schema.agents.totalEarnings,
  total_hackathons: schema.agents.totalHackathons,
  total_wins: schema.agents.totalWins,
  reputation_score: schema.agents.reputationScore,
  status: schema.agents.status,
  identity_registry: schema.agents.identityRegistry,
  identity_agent_id: schema.agents.identityAgentId,
  identity_chain_id: schema.agents.identityChainId,
  identity_agent_uri: schema.agents.identityAgentUri,
  identity_wallet: schema.agents.identityWallet,
  identity_owner_wallet: schema.agents.identityOwnerWallet,
  identity_source: schema.agents.identitySource,
  identity_link_status: schema.agents.identityLinkStatus,
  identity_verified_at: schema.agents.identityVerifiedAt,
  marketplace_reputation_score: schema.agents.marketplaceReputationScore,
  marketplace_completed_roles: schema.agents.marketplaceCompletedRoles,
  marketplace_successful_roles: schema.agents.marketplaceSuccessfulRoles,
  marketplace_failed_roles: schema.agents.marketplaceFailedRoles,
  marketplace_review_approvals: schema.agents.marketplaceReviewApprovals,
  marketplace_no_show_count: schema.agents.marketplaceNoShowCount,
  ens_subname_claimed_at: schema.agents.ensSubnameClaimedAt,
  created_at: schema.agents.createdAt,
  last_active: schema.agents.lastActive,
};

function ensNameFor(slug: string): string {
  return `${slug}.agents.buildersclaw.eth`;
}

export async function agentRoutes(fastify: FastifyInstance) {
  // POST /api/v1/agents/register
  fastify.post("/api/v1/agents/register", async (req, reply) => {
    const db = getDb();
    const clientIp = ((req.headers as Record<string, string>)["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
    const rateCheck = checkRateLimit(`register:${clientIp}`, 5, 3600_000);
    if (!rateCheck.allowed) {
      return fail(reply, "Too many registration attempts from this IP. Try again later.", 429);
    }

    const body = req.body as Record<string, unknown>;
    if (!body) return fail(reply, "Invalid request body", 400);

    const metadata: Record<string, unknown> = body.metadata && typeof body.metadata === "object" ? body.metadata as Record<string, unknown> : {};
    const name = sanitizeString(body.name as string, LIMITS.name);
    if (!name) return fail(reply, "name is required", 400);

    const normalized = name.toLowerCase();
    if (normalized.length < 2) return fail(reply, "name must be at least 2 characters");
    if (!/^[a-z0-9_]+$/.test(normalized)) return fail(reply, "name can only contain lowercase letters, numbers, and underscores");

    const reserved = ["admin", "hackaclaw", "buildersclaw", "system", "api", "root", "null", "undefined", "test"];
    if (reserved.includes(normalized)) return fail(reply, "This name is reserved", 409);

    const [existing] = await db.select({ id: schema.agents.id }).from(schema.agents).where(eq(schema.agents.name, normalized)).limit(1);
    if (existing) return fail(reply, "Name already taken", 409, "Try a different name");

    const apiKey = generateApiKey();
    const keyHash = hashToken(apiKey);
    const id = randomUUID();

    const rawWallet = sanitizeString((body.wallet ?? body.wallet_address) as string, LIMITS.wallet_address);
    const walletAddr = rawWallet ? validateWalletAddress(rawWallet) : null;
    if (rawWallet && !walletAddr) {
      return fail(reply, "Invalid wallet_address format. Must be a valid Ethereum address (0x + 40 hex chars).", 400);
    }

    const githubUsername = sanitizeString((body.github_username ?? body.github_handle) as string, LIMITS.github_username);
    const telegramUsername = sanitizeString(body.telegram_username as string, LIMITS.telegram_username)?.replace(/^@/, "");
    const axlPublicKey = parseAxlPublicKey(body.axl_public_key ?? metadata.axl_public_key);
    if (axlPublicKey === undefined) return fail(reply, "Invalid axl_public_key format. Must be a 64-character lowercase hex Gensyn AXL public key.", 400);
    const rawStack = sanitizeString((metadata.stack ?? body.stack ?? body.strategy) as string, LIMITS.stack);

    let strategyValue: string | null = null;
    if (githubUsername || telegramUsername || rawStack) {
      const strategyObj: Record<string, unknown> = {};
      if (rawStack) strategyObj.stack = rawStack;
      if (githubUsername) strategyObj.github_username = githubUsername;
      if (telegramUsername) strategyObj.telegram_username = telegramUsername;
      strategyValue = JSON.stringify(strategyObj);
    }

    try {
      await db.insert(schema.agents).values({
        id,
        name: normalized,
        displayName: sanitizeString(body.display_name as string, LIMITS.display_name) || name,
        description: sanitizeString((metadata.description ?? body.description) as string, LIMITS.description),
        avatarUrl: sanitizeString(body.avatar_url as string, LIMITS.avatar_url),
        walletAddress: walletAddr,
        axlPublicKey,
        apiKeyHash: keyHash,
        model: sanitizeString((metadata.model ?? body.model) as string, LIMITS.model) || "unknown",
        personality: null,
        strategy: strategyValue,
      });
    } catch {
      return fail(reply, "Registration failed", 500);
    }

    const missing: string[] = [];
    if (!walletAddr) missing.push("wallet_address");
    if (!githubUsername) missing.push("github_username");

    return created(reply, {
      agent: { id, name: normalized, display_name: sanitizeString(body.display_name as string, LIMITS.display_name) || name, api_key: apiKey, wallet_address: walletAddr || null, github_username: githubUsername || null, telegram_username: telegramUsername || null, axl_public_key: axlPublicKey, ens_name: ensNameFor(normalized) },
      important: "Save your API key! It will not be shown again.",
      prerequisites: missing.length > 0
        ? { ready: false, missing, message: `You're registered but missing: ${missing.join(", ")}. You need these to fully participate.` }
        : { ready: true, message: "All prerequisites met. You're ready to join hackathons." },
      communication: {
        telegram_configured: Boolean(telegramUsername),
        telegram_username: telegramUsername || null,
        recommendation: telegramUsername
          ? "Telegram notifications are enabled for this agent."
          : "Telegram is optional for joining hackathons, but recommended if you want real-time push and feedback notifications.",
      },
    });
  });

  // GET /api/v1/agents/register — public lookup or own profile
  fastify.get("/api/v1/agents/register", async (req, reply) => {
    const query = req.query as { name?: string };
    if (query.name) {
      const db = getDb();
      const clean = query.name.toLowerCase().trim().slice(0, 32);
      if (!/^[a-z0-9_]+$/.test(clean)) return fail(reply, "Invalid agent name", 400);
      const [agent] = await db.select(agentSelect).from(schema.agents).where(and(eq(schema.agents.name, clean), eq(schema.agents.status, "active"))).limit(1);
      if (!agent) return fail(reply, "Agent not found", 404);
      return ok(reply, { ...toPublicAgent(agent), ens_name: ensNameFor(agent.name) });
    }

    const agent = await authFastify(req);
    if (!agent) return unauthorized(reply);
    return ok(reply, { ...toPublicAgent(agent), ens_name: ensNameFor(agent.name) });
  });

  // PATCH /api/v1/agents/register — update own profile
  fastify.patch("/api/v1/agents/register", async (req, reply) => {
    const db = getDb();
    const agent = await authFastify(req);
    if (!agent) return unauthorized(reply);

    const body = req.body as Record<string, unknown>;
    if (!body) return fail(reply, "Invalid request body", 400);

    const metadata: Record<string, unknown> = body.metadata && typeof body.metadata === "object" ? body.metadata as Record<string, unknown> : {};
    const updates: Record<string, unknown> = { lastActive: new Date().toISOString() };

    const fieldLimits: Record<string, number> = {
      description: LIMITS.description,
      display_name: LIMITS.display_name,
      avatar_url: LIMITS.avatar_url,
      wallet_address: LIMITS.wallet_address,
      model: LIMITS.model,
      axl_public_key: LIMITS.axl_public_key,
    };

    for (const [field, maxLen] of Object.entries(fieldLimits)) {
      if (body[field] !== undefined) {
        if (field === "wallet_address") {
          const rawAddr = sanitizeString(body[field] as string, maxLen);
          if (rawAddr) {
            const valid = validateWalletAddress(rawAddr);
            if (!valid) return fail(reply, "Invalid wallet_address format. Must be a valid Ethereum address.", 400);
            updates.walletAddress = valid;
          }
        } else if (field === "axl_public_key") {
          const value = parseAxlPublicKey(body[field]);
          if (value === undefined) return fail(reply, "Invalid axl_public_key format. Must be a 64-character lowercase hex Gensyn AXL public key.", 400);
          updates.axlPublicKey = value;
        } else {
          const value = sanitizeString(body[field] as string, maxLen);
          if (field === "display_name") updates.displayName = value;
          if (field === "avatar_url") updates.avatarUrl = value;
          if (field === "description") updates.description = value;
          if (field === "model") updates.model = value;
        }
      }
    }

    const mappedDescription = sanitizeString(metadata.description as string, LIMITS.description);
    if (mappedDescription !== null) updates.description = mappedDescription;
    const mappedStack = sanitizeString((metadata.stack ?? body.stack) as string, LIMITS.stack);
    const mappedModel = sanitizeString(metadata.model as string, LIMITS.model);
    if (mappedModel !== null) updates.model = mappedModel;

    const githubUsername = sanitizeString((body.github_username ?? body.github_handle) as string, LIMITS.github_username);
    const telegramUsername = sanitizeString(body.telegram_username as string, LIMITS.telegram_username)?.replace(/^@/, "");

    if (githubUsername !== null || telegramUsername !== null || mappedStack !== null) {
      let existing: Record<string, unknown> = {};
      if (agent.strategy) { try { existing = JSON.parse(agent.strategy); } catch { existing = { stack: agent.strategy }; } }
      if (githubUsername !== null) existing.github_username = githubUsername;
      if (telegramUsername !== null) existing.telegram_username = telegramUsername;
      if (mappedStack !== null) existing.stack = mappedStack;
      updates.strategy = JSON.stringify(existing);
    }

    if (Object.keys(updates).length <= 1) return fail(reply, "No valid fields to update");

    const [updated] = await db.update(schema.agents).set(updates).where(eq(schema.agents.id, agent.id)).returning(agentSelect);
    if (!updated) return fail(reply, "Update failed", 500);
    return ok(reply, toPublicAgent(updated));
  });

  // GET /api/v1/agents/me
  fastify.get("/api/v1/agents/me", async (req, reply) => {
    const agent = await authFastify(req);
    if (!agent) return unauthorized(reply);

    const balance = await getBalance(agent.id);

    let githubUsername: string | null = null;
    let telegramUsername: string | null = null;
    if (agent.strategy) {
      try {
        const parsed = JSON.parse(agent.strategy);
        if (typeof parsed === "object" && parsed !== null) {
          if (typeof parsed.github_username === "string") githubUsername = parsed.github_username;
          if (typeof parsed.telegram_username === "string") telegramUsername = parsed.telegram_username;
        }
      } catch { /* legacy stack string */ }
    }

    const missingPrereqs: string[] = [];
    if (!agent.wallet_address) missingPrereqs.push("wallet_address");
    if (!githubUsername) missingPrereqs.push("github_username");

    const memberships = await getDb()
      .select({
        team: {
          id: schema.teams.id,
          name: schema.teams.name,
          hackathon_id: schema.teams.hackathonId,
          status: schema.teams.status,
          color: schema.teams.color,
        },
      })
      .from(schema.teamMembers)
      .innerJoin(schema.teams, eq(schema.teamMembers.teamId, schema.teams.id))
      .where(eq(schema.teamMembers.agentId, agent.id));

    return ok(reply, {
      ...toPublicAgent(agent),
      ens_name: ensNameFor(agent.name),
      balance_usd: balance.balance_usd,
      github_username: githubUsername,
      telegram_username: telegramUsername,
      prerequisites: {
        ready: missingPrereqs.length === 0,
        missing: missingPrereqs,
        message: missingPrereqs.length === 0
          ? "All prerequisites met. You're ready to join hackathons."
          : `Missing: ${missingPrereqs.join(", ")}. Set these up before joining hackathons.`,
      },
      teams: memberships.map((m) => m.team),
      identity: getAgentIdentity(agent),
      marketplace_reputation_score: getMarketplaceReputationScore(agent),
    });
  });
}
