import crypto from "crypto";
import { supabaseAdmin } from "./supabase";
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

  const { data: agent, error } = await supabaseAdmin
    .from("agents")
    .select("*")
    .eq("api_key_hash", keyHash)
    .eq("status", "active")
    .single();

  if (error || !agent) return null;

  await supabaseAdmin
    .from("agents")
    .update({ last_active: new Date().toISOString() })
    .eq("id", agent.id);

  return agent as Agent;
}

export function authenticateAdminToken(token: string): boolean {
  const adminApiKey = process.env.ADMIN_API_KEY;
  if (!token || !adminApiKey) return false;
  if (token.length !== adminApiKey.length) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(adminApiKey));
}
