import crypto from "crypto";
import { supabaseAdmin } from "./supabase";
import type { Agent } from "./types";
import { NextRequest } from "next/server";

const TOKEN_PREFIX = "hackaclaw_";
const TOKEN_BYTES = 32;

/** Generate a new API key with hackaclaw_ prefix */
export function generateApiKey(): string {
  return `${TOKEN_PREFIX}${crypto.randomBytes(TOKEN_BYTES).toString("hex")}`;
}

/** SHA-256 hash for secure storage */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Validate API key format */
export function validateApiKey(token: string): boolean {
  if (!token || typeof token !== "string") return false;
  if (!token.startsWith(TOKEN_PREFIX)) return false;
  const expectedLength = TOKEN_PREFIX.length + TOKEN_BYTES * 2;
  if (token.length !== expectedLength) return false;
  const body = token.slice(TOKEN_PREFIX.length);
  return /^[0-9a-f]+$/i.test(body);
}

/** Extract Bearer token from Authorization header */
export function extractToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const parts = authHeader.split(" ");
  if (parts.length !== 2) return null;
  if (parts[0].toLowerCase() !== "bearer") return null;
  return parts[1];
}

/** Authenticate request, return agent or null */
export async function authenticateRequest(req: NextRequest): Promise<Agent | null> {
  const authHeader = req.headers.get("authorization");
  const token = extractToken(authHeader);

  if (!token || !validateApiKey(token)) return null;

  const keyHash = hashToken(token);

  const { data: agent, error } = await supabaseAdmin
    .from("agents")
    .select("*")
    .eq("api_key_hash", keyHash)
    .eq("status", "active")
    .single();

  if (error || !agent) return null;

  // Update last_active
  await supabaseAdmin
    .from("agents")
    .update({ last_active: new Date().toISOString() })
    .eq("id", agent.id);

  return agent as Agent;
}

export function authenticateAdminRequest(req: NextRequest): boolean {
  const token = extractToken(req.headers.get("authorization"));
  const adminApiKey = process.env.ADMIN_API_KEY;

  if (!token || !adminApiKey) return false;
  if (token.length !== adminApiKey.length) return false;

  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(adminApiKey));
}

/** Require auth — returns agent or throws error response */
export async function requireAuth(req: NextRequest): Promise<Agent> {
  const agent = await authenticateRequest(req);
  if (!agent) {
    throw new AuthError("Authentication required. Use 'Authorization: Bearer hackaclaw_...' header.");
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
  return {
    id: agent.id,
    name: agent.name,
    display_name: agent.display_name,
    description: agent.description,
    avatar_url: agent.avatar_url,
    wallet_address: agent.wallet_address,
    model: agent.model,
    metadata: {
      description: agent.description,
      stack: agent.strategy,
      model: agent.model,
    },
    total_hackathons: agent.total_hackathons,
    total_wins: agent.total_wins,
    reputation_score: agent.reputation_score,
    status: agent.status,
    created_at: agent.created_at,
  };
}
