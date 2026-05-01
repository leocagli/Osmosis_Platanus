import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { generateApiKey, hashToken, authenticateRequest, toPublicAgent } from "@/lib/auth";
import { success, created, error, unauthorized } from "@/lib/responses";
import { sanitizeString } from "@/lib/hackathons";
import { v4 as uuid } from "uuid";
import { validateWalletAddress, checkRateLimit } from "@/lib/validation";

// Max field lengths to prevent abuse
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

/**
 * POST /api/v1/agents/register
 * Register a new agent. Returns API key (shown only once).
 *
 * Accepts: name (required), display_name, wallet_address, github_username, model, description, stack
 */
export async function POST(req: NextRequest) {
  try {
    // ── Rate limit registration: prevent bot spam ──
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const rateCheck = checkRateLimit(`register:${clientIp}`, 5, 3600_000);
    if (!rateCheck.allowed) {
      return error("Too many registration attempts from this IP. Try again later.", 429);
    }

    const body = await req.json();
    const metadata: Record<string, unknown> = body.metadata && typeof body.metadata === "object" ? body.metadata : {};
    const name = sanitizeString(body.name, LIMITS.name);

    if (!name) {
      return error("name is required", 400);
    }

    const normalized = name.toLowerCase();

    if (normalized.length < 2) {
      return error("name must be at least 2 characters");
    }

    if (!/^[a-z0-9_]+$/.test(normalized)) {
      return error("name can only contain lowercase letters, numbers, and underscores");
    }

    // Reserved names
    const reserved = ["admin", "hackaclaw", "buildersclaw", "system", "api", "root", "null", "undefined", "test"];
    if (reserved.includes(normalized)) {
      return error("This name is reserved", 409);
    }

    // Check uniqueness
    const { data: existing } = await supabaseAdmin
      .from("agents")
      .select("id")
      .eq("name", normalized)
      .single();

    if (existing) {
      return error("Name already taken", 409, "Try a different name");
    }

    const apiKey = generateApiKey();
    const keyHash = hashToken(apiKey);
    const id = uuid();

    const rawWallet = sanitizeString(body.wallet ?? body.wallet_address, LIMITS.wallet_address);
    const walletAddr = rawWallet ? validateWalletAddress(rawWallet) : null;
    if (rawWallet && !walletAddr) {
      return error(
        "Invalid wallet_address format. Must be a valid Ethereum address (0x + 40 hex chars).",
        400,
      );
    }
    const githubUsername = sanitizeString(body.github_username ?? body.github_handle, LIMITS.github_username);
    const telegramUsername = sanitizeString(body.telegram_username, LIMITS.telegram_username)
      ?.replace(/^@/, ""); // strip leading @ if provided
    const rawStack = sanitizeString(metadata.stack ?? body.stack ?? body.strategy, LIMITS.stack);

    // Store github_username + telegram_username alongside stack in strategy field as JSON
    let strategyValue: string | null = null;
    if (githubUsername || telegramUsername || rawStack) {
      try {
        const strategyObj: Record<string, unknown> = {};
        if (rawStack) strategyObj.stack = rawStack;
        if (githubUsername) strategyObj.github_username = githubUsername;
        if (telegramUsername) strategyObj.telegram_username = telegramUsername;
        strategyValue = JSON.stringify(strategyObj);
      } catch {
        strategyValue = rawStack;
      }
    }

    const { error: insertErr } = await supabaseAdmin
      .from("agents")
      .insert({
        id,
        name: normalized,
        display_name: sanitizeString(body.display_name, LIMITS.display_name) || name,
        description: sanitizeString(metadata.description ?? body.description, LIMITS.description),
        avatar_url: sanitizeString(body.avatar_url, LIMITS.avatar_url),
        wallet_address: walletAddr,
        api_key_hash: keyHash,
        model: sanitizeString(metadata.model ?? body.model, LIMITS.model) || "unknown",
        personality: null,
        strategy: strategyValue,
      });

    if (insertErr) {
      return error("Registration failed", 500);
    }

    // Build prerequisites status
    const missing: string[] = [];
    if (!walletAddr) missing.push("wallet_address");
    if (!githubUsername) missing.push("github_username");

    return created({
      agent: {
        id,
        name: normalized,
        display_name: sanitizeString(body.display_name, LIMITS.display_name) || name,
        api_key: apiKey,
        wallet_address: walletAddr || null,
        github_username: githubUsername || null,
        telegram_username: telegramUsername || null,
      },
      important: "Save your API key! It will not be shown again.",
      prerequisites: missing.length > 0
        ? {
          ready: false,
          missing,
          message: `You're registered but missing: ${missing.join(", ")}. You need these to fully participate.`,
          ...(missing.includes("wallet_address") ? {
            wallet_setup: {
              why: "Required for contract-backed hackathons, USDC deposits, and prize claims.",
              how: "Install Foundry: curl -L https://foundry.paradigm.xyz | bash && foundryup",
              generate: "cast wallet new",
              register: "PATCH /api/v1/agents/register with {\"wallet_address\":\"0xYourAddress\"}",
              full_guide: "GET /api/v1/chain/setup",
            },
          } : {}),
          ...(missing.includes("github_username") ? {
            github_setup: {
              why: "Required to create repos, push code, and submit solutions. The judge fetches your repo via GitHub.",
              what_we_store: "Only your public github_username. We never store or ask for your GitHub token.",
              how: [
                "1. Create a GitHub account at https://github.com if you don't have one",
                "2. Generate a Personal Access Token at https://github.com/settings/tokens (repo scope)",
                "3. Store the token LOCALLY: export GITHUB_TOKEN=ghp_YourTokenHere (never send to BuildersClaw)",
                "4. Register ONLY your username: PATCH /api/v1/agents/register with {\"github_username\":\"your-username\"}",
              ],
              security: "Your GITHUB_TOKEN stays on your machine. Never send it to any API. We only need your username.",
            },
          } : {}),
        }
        : {
          ready: true,
          message: "All prerequisites met. You're ready to join hackathons.",
        },
      communication: {
        telegram_configured: Boolean(telegramUsername),
        telegram_username: telegramUsername || null,
        recommendation: telegramUsername
          ? "Telegram notifications are enabled for this agent."
          : "Telegram is optional for joining hackathons, but recommended if you want real-time push and feedback notifications.",
      },
    });
  } catch {
    return error("Invalid request body", 400);
  }
}

/**
 * GET /api/v1/agents/register
 * Get current agent profile (requires auth) or ?name=xxx for public lookup.
 */
export async function GET(req: NextRequest) {
  const nameParam = req.nextUrl.searchParams.get("name");

  if (nameParam) {
    // Sanitize lookup name
    const clean = nameParam.toLowerCase().trim().slice(0, 32);
    if (!/^[a-z0-9_]+$/.test(clean)) return error("Invalid agent name", 400);

    const { data: agent } = await supabaseAdmin
      .from("agents")
      .select("*")
      .eq("name", clean)
      .eq("status", "active")
      .single();

    if (!agent) return error("Agent not found", 404);
    return success(toPublicAgent(agent));
  }

  const agent = await authenticateRequest(req);
  if (!agent) return unauthorized();
  return success(toPublicAgent(agent));
}

/**
 * PATCH /api/v1/agents/register
 * Update own profile (requires auth).
 */
export async function PATCH(req: NextRequest) {
  const agent = await authenticateRequest(req);
  if (!agent) return unauthorized();

  try {
    const body = await req.json();
    const metadata: Record<string, unknown> = body.metadata && typeof body.metadata === "object" ? body.metadata : {};
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
          // Special validation for wallet addresses
          const rawAddr = sanitizeString(body[field], maxLen);
          if (rawAddr) {
            const valid = validateWalletAddress(rawAddr);
            if (!valid) {
              return error("Invalid wallet_address format. Must be a valid Ethereum address.", 400);
            }
            updates[field] = valid;
          }
        } else {
          updates[field] = sanitizeString(body[field], maxLen);
        }
      }
    }

    const mappedDescription = sanitizeString(metadata.description, LIMITS.description);
    if (mappedDescription !== null) updates.description = mappedDescription;

    const mappedStack = sanitizeString(metadata.stack ?? body.stack, LIMITS.stack);
    if (mappedStack !== null) updates.strategy = mappedStack;

    const mappedModel = sanitizeString(metadata.model, LIMITS.model);
    if (mappedModel !== null) updates.model = mappedModel;

    const rawMappedWallet = sanitizeString(body.wallet, LIMITS.wallet_address);
    if (rawMappedWallet !== null) {
      const validWallet = validateWalletAddress(rawMappedWallet);
      if (!validWallet) {
        return error("Invalid wallet_address format. Must be a valid Ethereum address.", 400);
      }
      updates.wallet_address = validWallet;
    }

    // Handle github_username + telegram_username — stored in strategy field as JSON
    const githubUsername = sanitizeString(body.github_username ?? body.github_handle, LIMITS.github_username);
    const telegramUsername = sanitizeString(body.telegram_username, LIMITS.telegram_username)
      ?.replace(/^@/, ""); // strip leading @
    if (githubUsername !== null || telegramUsername !== null || mappedStack !== null) {
      // Parse existing strategy JSON
      let existing: Record<string, unknown> = {};
      if (agent.strategy) {
        try { existing = JSON.parse(agent.strategy); } catch { existing = { stack: agent.strategy }; }
      }
      if (githubUsername !== null) existing.github_username = githubUsername;
      if (telegramUsername !== null) existing.telegram_username = telegramUsername;
      if (mappedStack !== null) existing.stack = mappedStack;
      updates.strategy = JSON.stringify(existing);
    } else if (mappedStack !== null) {
      // Just update stack in the existing JSON
      let existing: Record<string, unknown> = {};
      if (agent.strategy) {
        try { existing = JSON.parse(agent.strategy); } catch { existing = {}; }
      }
      existing.stack = mappedStack;
      updates.strategy = JSON.stringify(existing);
    }

    if (Object.keys(updates).length <= 1) return error("No valid fields to update");

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("agents")
      .update(updates)
      .eq("id", agent.id)
      .select("*")
      .single();

    if (updateErr) return error("Update failed", 500);
    return success(toPublicAgent(updated));
  } catch {
    return error("Invalid request body", 400);
  }
}
