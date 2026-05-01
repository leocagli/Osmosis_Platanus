import { randomUUID } from "crypto";
import type { FastifyInstance } from "fastify";
import { supabaseAdmin } from "../../../web/src/lib/supabase";
import { generateApiKey, hashToken, toPublicAgent, authenticateToken } from "../../../web/src/lib/auth";
import { sanitizeString } from "../../../web/src/lib/hackathons";
import { validateWalletAddress, checkRateLimit } from "../../../web/src/lib/validation";
import { getBalance } from "../../../web/src/lib/balance";
import { getAgentIdentity, getMarketplaceReputationScore } from "../../../web/src/lib/erc8004";
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
  model: 64,
  avatar_url: 512,
} as const;

export async function agentRoutes(fastify: FastifyInstance) {
  // POST /api/v1/agents/register
  fastify.post("/api/v1/agents/register", async (req, reply) => {
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

    const { data: existing } = await supabaseAdmin.from("agents").select("id").eq("name", normalized).single();
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
    const rawStack = sanitizeString((metadata.stack ?? body.stack ?? body.strategy) as string, LIMITS.stack);

    let strategyValue: string | null = null;
    if (githubUsername || telegramUsername || rawStack) {
      const strategyObj: Record<string, unknown> = {};
      if (rawStack) strategyObj.stack = rawStack;
      if (githubUsername) strategyObj.github_username = githubUsername;
      if (telegramUsername) strategyObj.telegram_username = telegramUsername;
      strategyValue = JSON.stringify(strategyObj);
    }

    const { error: insertErr } = await supabaseAdmin.from("agents").insert({
      id,
      name: normalized,
      display_name: sanitizeString(body.display_name as string, LIMITS.display_name) || name,
      description: sanitizeString((metadata.description ?? body.description) as string, LIMITS.description),
      avatar_url: sanitizeString(body.avatar_url as string, LIMITS.avatar_url),
      wallet_address: walletAddr,
      api_key_hash: keyHash,
      model: sanitizeString((metadata.model ?? body.model) as string, LIMITS.model) || "unknown",
      personality: null,
      strategy: strategyValue,
    });

    if (insertErr) return fail(reply, "Registration failed", 500);

    const missing: string[] = [];
    if (!walletAddr) missing.push("wallet_address");
    if (!githubUsername) missing.push("github_username");

    return created(reply, {
      agent: { id, name: normalized, display_name: sanitizeString(body.display_name as string, LIMITS.display_name) || name, api_key: apiKey, wallet_address: walletAddr || null, github_username: githubUsername || null, telegram_username: telegramUsername || null },
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
      const clean = query.name.toLowerCase().trim().slice(0, 32);
      if (!/^[a-z0-9_]+$/.test(clean)) return fail(reply, "Invalid agent name", 400);
      const { data: agent } = await supabaseAdmin.from("agents").select("*").eq("name", clean).eq("status", "active").single();
      if (!agent) return fail(reply, "Agent not found", 404);
      return ok(reply, toPublicAgent(agent));
    }

    const agent = await authFastify(req);
    if (!agent) return unauthorized(reply);
    return ok(reply, toPublicAgent(agent));
  });

  // PATCH /api/v1/agents/register — update own profile
  fastify.patch("/api/v1/agents/register", async (req, reply) => {
    const agent = await authFastify(req);
    if (!agent) return unauthorized(reply);

    const body = req.body as Record<string, unknown>;
    if (!body) return fail(reply, "Invalid request body", 400);

    const metadata: Record<string, unknown> = body.metadata && typeof body.metadata === "object" ? body.metadata as Record<string, unknown> : {};
    const updates: Record<string, unknown> = { last_active: new Date().toISOString() };

    const fieldLimits: Record<string, number> = {
      description: LIMITS.description,
      display_name: LIMITS.display_name,
      avatar_url: LIMITS.avatar_url,
      wallet_address: LIMITS.wallet_address,
      model: LIMITS.model,
    };

    for (const [field, maxLen] of Object.entries(fieldLimits)) {
      if (body[field] !== undefined) {
        if (field === "wallet_address") {
          const rawAddr = sanitizeString(body[field] as string, maxLen);
          if (rawAddr) {
            const valid = validateWalletAddress(rawAddr);
            if (!valid) return fail(reply, "Invalid wallet_address format. Must be a valid Ethereum address.", 400);
            updates[field] = valid;
          }
        } else {
          updates[field] = sanitizeString(body[field] as string, maxLen);
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

    const { data: updated, error: updateErr } = await supabaseAdmin.from("agents").update(updates).eq("id", agent.id).select("*").single();
    if (updateErr) return fail(reply, "Update failed", 500);
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

    const { data: memberships } = await supabaseAdmin
      .from("team_members")
      .select("team_id, role, revenue_share_pct, teams(id, name, hackathon_id, status, color)")
      .eq("agent_id", agent.id);

    return ok(reply, {
      ...toPublicAgent(agent),
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
      teams: (memberships || []).map((m: Record<string, unknown>) => m.teams),
      identity: getAgentIdentity(agent),
      marketplace_reputation_score: getMarketplaceReputationScore(agent),
    });
  });
}
