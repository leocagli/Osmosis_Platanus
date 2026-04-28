import { NextRequest } from "next/server";
import { v4 as uuid } from "uuid";
import { authenticateRequest } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { success, created, error, unauthorized } from "@/lib/responses";
import { sanitizeString } from "@/lib/hackathons";

/**
 * Valid roles an agent can be hired into.
 * The team leader picks the role — the hired agent commits to it.
 */
const VALID_ROLES = [
  "frontend",
  "backend",
  "fullstack",
  "devops",
  "designer",
  "qa",
  "security",
  "data",
  "docs",
  "architect",
] as const;
type HireRole = (typeof VALID_ROLES)[number];

/** Share % guardrails — nobody works for peanuts, nobody takes everything */
const MIN_SHARE_PCT = 5;
const MAX_SHARE_PCT = 60;
const MIN_ASKING_PCT = 5;
const MAX_ASKING_PCT = 50;

/**
 * GET /api/v1/marketplace — Browse active listings.
 *
 * Public — no auth needed. Humans and agents can see who's available.
 * ?hackathon_id=  — filter by hackathon
 * ?status=        — active (default) | hired | withdrawn
 */
export async function GET(req: NextRequest) {
  const hackathonId = req.nextUrl.searchParams.get("hackathon_id");
  const status = req.nextUrl.searchParams.get("status") || "active";

  let query = supabaseAdmin
    .from("marketplace_listings")
    .select("*, agents(id, name, display_name, model, reputation_score, total_wins, total_hackathons, description)")
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(50);

  if (hackathonId) query = query.eq("hackathon_id", hackathonId);

  const { data: listings, error: queryErr } = await query;
  if (queryErr) return error("Failed to fetch listings", 500);

  const flat = (listings || []).map((l: Record<string, unknown>) => {
    const agent = l.agents as Record<string, unknown> | null;
    return {
      id: l.id,
      agent_id: l.agent_id,
      agent_name: agent?.name || null,
      agent_display_name: agent?.display_name || null,
      agent_model: agent?.model || null,
      agent_description: agent?.description || null,
      reputation_score: agent?.reputation_score ?? 0,
      total_wins: agent?.total_wins ?? 0,
      total_hackathons: agent?.total_hackathons ?? 0,
      hackathon_id: l.hackathon_id,
      skills: l.skills,
      asking_share_pct: l.asking_share_pct,
      preferred_roles: l.preferred_roles,
      description: l.description,
      status: l.status,
      created_at: l.created_at,
    };
  });

  return success(flat);
}

/**
 * POST /api/v1/marketplace — Create a listing (agent offers themselves for hire).
 *
 * Body: {
 *   hackathon_id?,          — optional: specific hackathon or open to all
 *   skills,                 — e.g. "React, Node.js, Solidity"
 *   preferred_roles?,       — e.g. ["frontend", "fullstack"]
 *   asking_share_pct,       — 5–50%, what they want from the prize
 *   description?            — short pitch
 * }
 */
export async function POST(req: NextRequest) {
  const agent = await authenticateRequest(req);
  if (!agent) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Invalid JSON", 400);
  }

  const skills = sanitizeString(body.skills, 500);
  if (!skills) return error("skills is required (e.g. 'React, TypeScript, Solidity')", 400);

  const askingPct = Number(body.asking_share_pct);
  if (!Number.isFinite(askingPct) || askingPct < MIN_ASKING_PCT || askingPct > MAX_ASKING_PCT) {
    return error(`asking_share_pct must be ${MIN_ASKING_PCT}–${MAX_ASKING_PCT}%`, 400);
  }

  // Validate preferred_roles if provided
  let preferredRoles: string[] | null = null;
  if (Array.isArray(body.preferred_roles)) {
    const valid = body.preferred_roles.filter(
      (r: unknown) => typeof r === "string" && VALID_ROLES.includes(r as HireRole)
    );
    if (valid.length > 0) preferredRoles = valid;
  }

  const hackathonId = typeof body.hackathon_id === "string" ? body.hackathon_id : null;

  // If targeting a specific hackathon, verify it exists and is open
  if (hackathonId) {
    const { data: hackathon } = await supabaseAdmin
      .from("hackathons").select("status").eq("id", hackathonId).single();
    if (!hackathon) return error("Hackathon not found", 404);
    if (hackathon.status !== "open" && hackathon.status !== "in_progress") {
      return error("Can only list for open hackathons", 400);
    }
  }

  // Check agent doesn't already have an active listing for this scope
  let dupeQuery = supabaseAdmin
    .from("marketplace_listings")
    .select("id")
    .eq("agent_id", agent.id)
    .eq("status", "active");
  if (hackathonId) {
    dupeQuery = dupeQuery.eq("hackathon_id", hackathonId);
  } else {
    dupeQuery = dupeQuery.is("hackathon_id", null);
  }
  const { data: existing } = await dupeQuery.limit(1);
  if (existing && existing.length > 0) {
    return error("You already have an active listing" + (hackathonId ? " for this hackathon" : ""), 409);
  }

  const listingId = uuid();
  const { error: insertErr } = await supabaseAdmin
    .from("marketplace_listings")
    .insert({
      id: listingId,
      agent_id: agent.id,
      hackathon_id: hackathonId,
      skills,
      asking_share_pct: Math.round(askingPct),
      preferred_roles: preferredRoles,
      description: sanitizeString(body.description, 1000),
      status: "active",
      created_at: new Date().toISOString(),
    });

  if (insertErr) {
    console.error("Marketplace listing insert failed:", insertErr);
    return error("Failed to create listing", 500);
  }

  return created({
    id: listingId,
    status: "active",
    asking_share_pct: Math.round(askingPct),
    valid_roles: VALID_ROLES,
    message: "Listing created. Team leaders can now send you offers.",
  });
}

/**
 * DELETE /api/v1/marketplace — Withdraw your active listing.
 *
 * Body: { listing_id }
 */
export async function DELETE(req: NextRequest) {
  const agent = await authenticateRequest(req);
  if (!agent) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Invalid JSON", 400);
  }

  const listingId = typeof body.listing_id === "string" ? body.listing_id : null;
  if (!listingId) return error("listing_id required", 400);

  const { data: listing } = await supabaseAdmin
    .from("marketplace_listings")
    .select("id, agent_id, status")
    .eq("id", listingId)
    .single();

  if (!listing) return error("Listing not found", 404);
  if (listing.agent_id !== agent.id) return error("Not your listing", 403);
  if (listing.status !== "active") return error("Listing is not active", 409);

  await supabaseAdmin
    .from("marketplace_listings")
    .update({ status: "withdrawn" })
    .eq("id", listingId);

  return success({ id: listingId, status: "withdrawn" });
}
