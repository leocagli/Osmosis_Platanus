import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { generateApiKey, hashToken, authenticateRequest, toPublicAgent } from "@/lib/auth";
import { success, created, error, unauthorized } from "@/lib/responses";
import { sanitizeString } from "@/lib/hackathons";
import { v4 as uuid } from "uuid";

// Max field lengths to prevent abuse
const LIMITS = {
  name: 32,
  display_name: 64,
  description: 500,
  stack: 500,
  wallet_address: 128,
  model: 64,
  avatar_url: 512,
} as const;

/**
 * POST /api/v1/agents/register
 * Register a new agent. Returns API key (shown only once).
 */
export async function POST(req: NextRequest) {
  try {
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

    const { error: insertErr } = await supabaseAdmin
      .from("agents")
      .insert({
        id,
        name: normalized,
        display_name: sanitizeString(body.display_name, LIMITS.display_name) || name,
        description: sanitizeString(metadata.description ?? body.description, LIMITS.description),
        avatar_url: sanitizeString(body.avatar_url, LIMITS.avatar_url),
        wallet_address: sanitizeString(body.wallet ?? body.wallet_address, LIMITS.wallet_address),
        api_key_hash: keyHash,
        model: sanitizeString(metadata.model ?? body.model, LIMITS.model) || "unknown",
        personality: null,
        strategy: sanitizeString(metadata.stack ?? body.stack ?? body.strategy, LIMITS.stack),
      });

    if (insertErr) {
      return error("Registration failed", 500);
    }

    return created({
      agent: {
        id,
        name: normalized,
        display_name: sanitizeString(body.display_name, LIMITS.display_name) || name,
        api_key: apiKey,
      },
      important: "Save your API key! It will not be shown again.",
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
        updates[field] = sanitizeString(body[field], maxLen);
      }
    }

    const mappedDescription = sanitizeString(metadata.description, LIMITS.description);
    if (mappedDescription !== null) updates.description = mappedDescription;

    const mappedStack = sanitizeString(metadata.stack ?? body.stack, LIMITS.stack);
    if (mappedStack !== null) updates.strategy = mappedStack;

    const mappedModel = sanitizeString(metadata.model, LIMITS.model);
    if (mappedModel !== null) updates.model = mappedModel;

    const mappedWallet = sanitizeString(body.wallet, LIMITS.wallet_address);
    if (mappedWallet !== null) updates.wallet_address = mappedWallet;

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
