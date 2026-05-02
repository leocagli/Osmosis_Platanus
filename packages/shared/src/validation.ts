/**
 * ═══════════════════════════════════════════════════════════════
 * VALIDATION — Central security & integrity checks.
 *
 * Prevents:
 *   - Share splits exceeding 100%
 *   - Team members ending up with 0% (unpaid)
 *   - Race conditions on concurrent marketplace claims
 *   - Invalid wallet addresses
 *   - Stale listings staying open after share changes
 * ═══════════════════════════════════════════════════════════════
 */

import { and, desc, eq } from "drizzle-orm";
import { isAddress, getAddress } from "viem";
import { getDb, schema } from "./db";

// ─── Constants ───

/** No team member can have less than this share */
export const MEMBER_MIN_SHARE_PCT = 5;
/** Leader must keep at least this % after all allocations */
export const LEADER_MIN_KEEP_PCT = 20;
/** Maximum share for a single listing */
export const LISTING_MAX_SHARE_PCT = 50;
/** On-chain: minimum basis points per winner (prevents dust payouts) */
export const WINNER_MIN_BPS = 500; // 5%
/** Maximum open listings per team at any time */
export const MAX_OPEN_LISTINGS_PER_TEAM = 5;
/** Registration rate limit: max agents per IP per hour */
export const REGISTRATION_RATE_LIMIT = process.env.NODE_ENV === "development" ? 100 : 5;

// ─── Types ───

export interface ShareValidationResult {
  valid: boolean;
  total_pct: number;
  leader_pct: number;
  member_count: number;
  issues: string[];
}

export interface TeamShareSnapshot {
  members: Array<{
    id: string;
    agent_id: string;
    role: string;
    revenue_share_pct: number;
  }>;
  open_listings_pct: number;
  total_allocated_pct: number;
  leader_pct: number;
}

// ─── Wallet Validation ───

/**
 * Validate an Ethereum address strictly.
 * Returns the checksummed address or null if invalid.
 */
export function validateWalletAddress(address: unknown): string | null {
  if (!address || typeof address !== "string") return null;
  const trimmed = address.trim();
  if (!trimmed) return null;

  // Must start with 0x
  if (!trimmed.startsWith("0x")) return null;

  // Must be exactly 42 chars (0x + 40 hex)
  if (trimmed.length !== 42) return null;

  // Must be a valid hex address
  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) return null;

  // Use viem's isAddress for full validation including EIP-55 checksum
  if (!isAddress(trimmed)) return null;

  try {
    return getAddress(trimmed);
  } catch {
    return null;
  }
}

// ─── Share Validation ───

/**
 * Get a snapshot of the team's current share distribution.
 * Includes members AND pending open listings.
 */
export async function getTeamShareSnapshot(teamId: string): Promise<TeamShareSnapshot> {
  const db = getDb();

  // Fetch all active team members
  const members = await db
    .select({
      id: schema.teamMembers.id,
      agent_id: schema.teamMembers.agentId,
      role: schema.teamMembers.role,
      revenue_share_pct: schema.teamMembers.revenueSharePct,
    })
    .from(schema.teamMembers)
    .where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.status, "active")));

  const membersList = members.map((m) => ({
    id: m.id,
    agent_id: m.agent_id,
    role: m.role as string,
    revenue_share_pct: m.revenue_share_pct as number,
  }));

  // Sum share_pct of open listings (committed but not yet claimed)
  const openListings = await db
    .select({ share_pct: schema.marketplaceListings.sharePct })
    .from(schema.marketplaceListings)
    .where(and(eq(schema.marketplaceListings.teamId, teamId), eq(schema.marketplaceListings.status, "open")));

  const openListingsPct = openListings.reduce(
    (sum, l) => sum + (l.share_pct || 0),
    0
  );

  const totalMembers = membersList.reduce((sum, m) => sum + m.revenue_share_pct, 0);
  const leaderMember = membersList.find((m) => m.role === "leader");
  const leaderPct = leaderMember?.revenue_share_pct ?? 0;

  return {
    members: membersList,
    open_listings_pct: openListingsPct,
    total_allocated_pct: totalMembers + openListingsPct,
    leader_pct: leaderPct,
  };
}

/**
 * Validate that a team's share distribution is consistent:
 *   1. All member shares sum to exactly 100%
 *   2. Leader keeps ≥ LEADER_MIN_KEEP_PCT
 *   3. Every member has ≥ MEMBER_MIN_SHARE_PCT
 *   4. No negative shares
 */
export async function validateTeamShares(teamId: string): Promise<ShareValidationResult> {
  const snapshot = await getTeamShareSnapshot(teamId);
  const issues: string[] = [];

  const totalMemberPct = snapshot.members.reduce((sum, m) => sum + m.revenue_share_pct, 0);

  // Check total = 100
  if (Math.abs(totalMemberPct - 100) > 0.01) {
    issues.push(`Member shares sum to ${totalMemberPct}%, expected 100%`);
  }

  // Check leader minimum
  if (snapshot.leader_pct < LEADER_MIN_KEEP_PCT) {
    issues.push(`Leader has ${snapshot.leader_pct}%, minimum is ${LEADER_MIN_KEEP_PCT}%`);
  }

  // Check each member's minimum
  for (const member of snapshot.members) {
    if (member.revenue_share_pct < MEMBER_MIN_SHARE_PCT) {
      issues.push(`Member ${member.agent_id} (${member.role}) has ${member.revenue_share_pct}%, minimum is ${MEMBER_MIN_SHARE_PCT}%`);
    }
    if (member.revenue_share_pct < 0) {
      issues.push(`Member ${member.agent_id} has negative share: ${member.revenue_share_pct}%`);
    }
  }

  // Check open listings won't violate leader minimum
  const leaderAfterListings = snapshot.leader_pct - snapshot.open_listings_pct;
  if (leaderAfterListings < LEADER_MIN_KEEP_PCT && snapshot.open_listings_pct > 0) {
    issues.push(
      `Open listings (${snapshot.open_listings_pct}%) would reduce leader to ${leaderAfterListings}%. ` +
      `Some listings should be withdrawn.`
    );
  }

  return {
    valid: issues.length === 0,
    total_pct: totalMemberPct,
    leader_pct: snapshot.leader_pct,
    member_count: snapshot.members.length,
    issues,
  };
}

/**
 * After a marketplace claim, verify share integrity.
 * If total ≠ 100%, attempt auto-correction by adjusting leader share.
 * Returns true if shares are valid (or were corrected).
 */
export async function enforceShareIntegrity(teamId: string): Promise<{
  valid: boolean;
  corrected: boolean;
  issues: string[];
}> {
  const db = getDb();

  const members = await db
    .select({
      id: schema.teamMembers.id,
      agent_id: schema.teamMembers.agentId,
      role: schema.teamMembers.role,
      revenue_share_pct: schema.teamMembers.revenueSharePct,
    })
    .from(schema.teamMembers)
    .where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.status, "active")));

  if (members.length === 0) {
    return { valid: false, corrected: false, issues: ["Team has no active members"] };
  }

  const totalPct = members.reduce((sum, m) => sum + (m.revenue_share_pct || 0), 0);
  const issues: string[] = [];

  // Check for impossible states
  for (const m of members) {
    if ((m.revenue_share_pct || 0) < 0) {
      issues.push(`CRITICAL: Member ${m.agent_id} has negative share ${m.revenue_share_pct}%`);
    }
  }

  if (issues.length > 0) {
    return { valid: false, corrected: false, issues };
  }

  // If total is exactly 100, all good
  if (Math.abs(totalPct - 100) < 0.01) {
    return { valid: true, corrected: false, issues: [] };
  }

  // Auto-correct: adjust leader's share to make total = 100
  const leader = members.find((m) => m.role === "leader");
  if (!leader) {
    issues.push(`Total is ${totalPct}% but no leader to adjust`);
    return { valid: false, corrected: false, issues };
  }

  const nonLeaderTotal = members
    .filter((m) => m.role !== "leader")
    .reduce((sum, m) => sum + (m.revenue_share_pct || 0), 0);

  const correctedLeaderPct = 100 - nonLeaderTotal;

  if (correctedLeaderPct < LEADER_MIN_KEEP_PCT) {
    issues.push(
      `Cannot auto-correct: leader would have ${correctedLeaderPct}% (min ${LEADER_MIN_KEEP_PCT}%). ` +
      `Non-leader members have ${nonLeaderTotal}%.`
    );
    return { valid: false, corrected: false, issues };
  }

  // Apply correction
  await db.transaction(async (tx) => {
    await tx
      .update(schema.teamMembers)
      .set({ revenueSharePct: correctedLeaderPct })
      .where(eq(schema.teamMembers.id, leader.id));
  });

  console.warn(
    `[SHARE_INTEGRITY] Auto-corrected team ${teamId}: leader share ${leader.revenue_share_pct}% → ${correctedLeaderPct}%`
  );

  return {
    valid: true,
    corrected: true,
    issues: [`Leader share auto-corrected from ${leader.revenue_share_pct}% to ${correctedLeaderPct}%`],
  };
}

/**
 * Auto-withdraw open marketplace listings that can no longer be fulfilled
 * because the leader's remaining share is too low.
 *
 * Called after a marketplace claim to clean up stale listings.
 */
export async function autoWithdrawInvalidListings(teamId: string): Promise<string[]> {
  const db = getDb();
  const snapshot = await getTeamShareSnapshot(teamId);
  const withdrawnIds: string[] = [];

  // Get all open listings for this team, ordered by newest first
  const openListings = await db
    .select({ id: schema.marketplaceListings.id, share_pct: schema.marketplaceListings.sharePct })
    .from(schema.marketplaceListings)
    .where(and(eq(schema.marketplaceListings.teamId, teamId), eq(schema.marketplaceListings.status, "open")))
    .orderBy(desc(schema.marketplaceListings.createdAt));

  if (openListings.length === 0) return withdrawnIds;

  // Calculate how much share the leader has available
  // (leader's current share minus LEADER_MIN_KEEP_PCT)
  const availableForListings = snapshot.leader_pct - LEADER_MIN_KEEP_PCT;

  let remainingBudget = availableForListings;

  for (const listing of openListings) {
    if (remainingBudget >= listing.share_pct) {
      remainingBudget -= listing.share_pct;
    } else {
      // This listing can't be fulfilled — auto-withdraw it
      const updated = await db
        .update(schema.marketplaceListings)
        .set({ status: "withdrawn" })
        .where(and(eq(schema.marketplaceListings.id, listing.id), eq(schema.marketplaceListings.status, "open")))
        .returning({ id: schema.marketplaceListings.id }); // Optimistic lock

      if (updated.length > 0) {
        withdrawnIds.push(listing.id);
        console.warn(
          `[MARKETPLACE] Auto-withdrew listing ${listing.id} (${listing.share_pct}%) — ` +
          `leader only has ${snapshot.leader_pct}% remaining`
        );
      }
    }
  }

  return withdrawnIds;
}

// ─── Finalize Validation ───

/**
 * Validate winner shares before on-chain finalization.
 * Ensures:
 *   1. Shares sum to exactly 10000 bps
 *   2. Every winner gets ≥ WINNER_MIN_BPS (can't be scammed with dust)
 *   3. No duplicate wallets
 *   4. All wallets are valid
 */
export function validateWinnerShares(
  winners: Array<{ wallet: string; shareBps: number; agent_id: string }>
): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  if (winners.length === 0) {
    issues.push("No winners provided");
    return { valid: false, issues };
  }

  // Check total = 10000
  const totalBps = winners.reduce((sum, w) => sum + w.shareBps, 0);
  if (totalBps !== 10000) {
    issues.push(`Winner shares must sum to 10000 bps, got ${totalBps}`);
  }

  // Check minimum per winner
  for (const w of winners) {
    if (w.shareBps < WINNER_MIN_BPS) {
      issues.push(
        `Agent ${w.agent_id} would receive ${w.shareBps} bps (${(w.shareBps / 100).toFixed(1)}%). ` +
        `Minimum is ${WINNER_MIN_BPS} bps (${(WINNER_MIN_BPS / 100).toFixed(1)}%) to prevent dust payouts.`
      );
    }

    if (w.shareBps < 0) {
      issues.push(`Agent ${w.agent_id} has negative share: ${w.shareBps} bps`);
    }

    if (w.shareBps === 0) {
      issues.push(`Agent ${w.agent_id} has 0 bps — they would receive nothing. Remove them or assign a share.`);
    }
  }

  // Check for duplicate wallets
  const wallets = new Set<string>();
  for (const w of winners) {
    const normalized = w.wallet.toLowerCase();
    if (wallets.has(normalized)) {
      issues.push(`Duplicate wallet address: ${w.wallet}`);
    }
    wallets.add(normalized);
  }

  // Validate all wallet addresses
  for (const w of winners) {
    if (!validateWalletAddress(w.wallet)) {
      issues.push(`Invalid wallet address for agent ${w.agent_id}: ${w.wallet}`);
    }
  }

  return { valid: issues.length === 0, issues };
}

// ─── Rate Limiting ───

/**
 * Simple in-memory rate limiter.
 * In production, use Redis or a database-backed solution.
 */
const rateLimitStore = new Map<string, { count: number; resetsAt: number }>();

export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; remaining: number; resetsAt: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now > entry.resetsAt) {
    // New window
    const resetsAt = now + windowMs;
    rateLimitStore.set(key, { count: 1, resetsAt });
    return { allowed: true, remaining: maxRequests - 1, resetsAt };
  }

  if (entry.count >= maxRequests) {
    return { allowed: false, remaining: 0, resetsAt: entry.resetsAt };
  }

  entry.count++;
  return { allowed: true, remaining: maxRequests - entry.count, resetsAt: entry.resetsAt };
}

// Clean up expired entries every 5 minutes
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore) {
      if (now > entry.resetsAt) rateLimitStore.delete(key);
    }
  }, 5 * 60 * 1000);
}

// ─── Input Validation Helpers ───

/**
 * Validate a UUID string strictly.
 */
export function isValidUUID(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Validate a transaction hash (0x + 64 hex chars).
 */
export function isValidTxHash(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

/**
 * Validate a GitHub repository URL strictly.
 * Prevents open redirect, SSRF, and injection attacks.
 */
export function isValidGitHubUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    if (url.hostname !== "github.com") return false;
    // Must have at least /owner/repo
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return false;
    // Validate owner/repo format (alphanumeric, hyphens, underscores, dots)
    if (!/^[a-zA-Z0-9._-]+$/.test(parts[0])) return false;
    if (!/^[a-zA-Z0-9._-]+$/.test(parts[1])) return false;
    return true;
  } catch {
    return false;
  }
}

// ─── Security Hardening Constants ───

/** Absolute minimum share any role listing can offer (prevents 0% scam listings) */
export const LISTING_MIN_SHARE_PCT = 5;

/** Maximum total share that can be allocated away from leader (members + open listings) */
export const MAX_ALLOCATED_PCT = 80;

/** Maximum chat messages per agent per minute */
export const CHAT_RATE_LIMIT_PER_MIN = process.env.NODE_ENV === "development" ? 120 : 15;

/** Maximum submissions per team per hour */
export const SUBMISSION_RATE_LIMIT_PER_HOUR = 10;

/** Minimum viable repo: at least this many files to be considered a real submission */
export const MIN_REPO_FILES_FOR_JUDGING = 2;

// ─── Security Hardening Validators ───

/**
 * Validate that role_type is a known marketplace role.
 * Accepts custom roles but flags them.
 */
export function validateRoleType(roleType: unknown): {
  valid: boolean;
  known: boolean;
  role_type: string | null;
  message: string | null;
} {
  if (!roleType || typeof roleType !== "string") {
    return { valid: false, known: false, role_type: null, message: "role_type is required" };
  }
  const trimmed = roleType.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.length > 50) {
    return { valid: false, known: false, role_type: null, message: "role_type must be 1-50 characters" };
  }
  // Prevent injection via role_type
  if (!/^[a-z0-9_-]+$/.test(trimmed)) {
    return { valid: false, known: false, role_type: null, message: "role_type can only contain lowercase letters, numbers, hyphens, and underscores" };
  }
  const knownRoles = ["feedback", "builder", "architect", "tester", "devops", "docs", "security"];
  const known = knownRoles.includes(trimmed);
  return { 
    valid: true, 
    known, 
    role_type: trimmed, 
    message: known ? null : `Warning: "${trimmed}" is a custom role type. Known roles: ${knownRoles.join(", ")}` 
  };
}

/**
 * Validate team total share distribution including open listings.
 * Ensures: members + open listings ≤ 100% and leader keeps ≥ LEADER_MIN_KEEP_PCT.
 * 
 * @param teamId - Team to check
 * @param additionalPct - Additional share being proposed (e.g. new listing)
 * @returns Validation result with breakdown
 */
export async function validateTeamTotalShares(
  teamId: string,
  additionalPct: number = 0
): Promise<{
  valid: boolean;
  total_member_pct: number;
  open_listings_pct: number;
  additional_pct: number;
  grand_total_pct: number;
  leader_would_keep: number;
  issues: string[];
}> {
  const snapshot = await getTeamShareSnapshot(teamId);
  const issues: string[] = [];

  const totalMemberPct = snapshot.members.reduce((sum, m) => sum + m.revenue_share_pct, 0);

  // Total members must be exactly 100%
  // But open listings + additional cannot exceed what the leader can give away
  const nonLeaderPct = snapshot.members
    .filter(m => m.role !== "leader")
    .reduce((sum, m) => sum + m.revenue_share_pct, 0);

  const leaderWouldKeep = snapshot.leader_pct - snapshot.open_listings_pct - additionalPct;

  if (leaderWouldKeep < LEADER_MIN_KEEP_PCT) {
    issues.push(
      `Leader would only keep ${leaderWouldKeep}% (minimum ${LEADER_MIN_KEEP_PCT}%). ` +
      `Currently: ${nonLeaderPct}% to members, ${snapshot.open_listings_pct}% in open listings, ` +
      `${additionalPct}% proposed.`
    );
  }

  if (nonLeaderPct + snapshot.open_listings_pct + additionalPct > MAX_ALLOCATED_PCT) {
    issues.push(
      `Total allocated away from leader would be ${nonLeaderPct + snapshot.open_listings_pct + additionalPct}% ` +
      `(max ${MAX_ALLOCATED_PCT}%). Cannot allocate more than ${MAX_ALLOCATED_PCT}% of the prize.`
    );
  }

  if (additionalPct > 0 && additionalPct < LISTING_MIN_SHARE_PCT) {
    issues.push(`Proposed share ${additionalPct}% is below minimum ${LISTING_MIN_SHARE_PCT}%`);
  }

  return {
    valid: issues.length === 0,
    total_member_pct: totalMemberPct,
    open_listings_pct: snapshot.open_listings_pct,
    additional_pct: additionalPct,
    grand_total_pct: nonLeaderPct + snapshot.open_listings_pct + additionalPct,
    leader_would_keep: leaderWouldKeep,
    issues,
  };
}

/**
 * Check if a submission has a viable repo for judging.
 * A submission without a valid GitHub URL should NOT be sent to the judge.
 */
export function isViableSubmission(submission: {
  preview_url?: string | null;
  build_log?: string | null;
  status?: string | null;
}): { viable: boolean; reason: string } {
  if (submission.status !== "completed") {
    return { viable: false, reason: `Submission status is "${submission.status}", not "completed"` };
  }

  // Try to extract repo_url
  let repoUrl: string | null = null;

  if (submission.build_log) {
    try {
      const meta = JSON.parse(submission.build_log);
      repoUrl = meta.repo_url || meta.project_url || null;
    } catch { /* ignore */ }
  }

  if (!repoUrl && submission.preview_url) {
    repoUrl = submission.preview_url;
  }

  if (!repoUrl) {
    return { viable: false, reason: "No repository URL found in submission" };
  }

  if (!isValidGitHubUrl(repoUrl)) {
    return { viable: false, reason: `Invalid GitHub URL: ${repoUrl}` };
  }

  return { viable: true, reason: "Submission has a valid GitHub URL" };
}

/**
 * Generate a cost warning for agents based on prize pool vs estimated token costs.
 * Helps agents make informed decisions about spending tokens.
 */
export function generateCostWarning(params: {
  prizePool: number;
  agentSharePct: number;
  estimatedCostUsd: number;
}): {
  warning: boolean;
  severity: "none" | "info" | "caution" | "danger";
  message: string | null;
  agent_potential_prize: number;
  estimated_cost: number;
  roi_ratio: number;
} {
  const agentPrize = (params.prizePool * params.agentSharePct) / 100;
  const ratio = agentPrize > 0 ? agentPrize / params.estimatedCostUsd : 0;

  if (params.estimatedCostUsd <= 0) {
    return { warning: false, severity: "none", message: null, agent_potential_prize: agentPrize, estimated_cost: 0, roi_ratio: Infinity };
  }

  if (ratio < 1) {
    return {
      warning: true,
      severity: "danger",
      message: `⚠️ COST EXCEEDS PRIZE: Your potential prize share is $${agentPrize.toFixed(2)} but estimated cost is $${params.estimatedCostUsd.toFixed(2)}. You would LOSE money even if you win.`,
      agent_potential_prize: agentPrize,
      estimated_cost: params.estimatedCostUsd,
      roi_ratio: ratio,
    };
  }

  if (ratio < 2) {
    return {
      warning: true,
      severity: "caution",
      message: `⚠️ LOW ROI: Your potential prize share is $${agentPrize.toFixed(2)} vs estimated cost $${params.estimatedCostUsd.toFixed(2)}. ROI ratio: ${ratio.toFixed(1)}x — consider if this is worth the tokens.`,
      agent_potential_prize: agentPrize,
      estimated_cost: params.estimatedCostUsd,
      roi_ratio: ratio,
    };
  }

  if (ratio < 5) {
    return {
      warning: true,
      severity: "info",
      message: `💡 Prize share: $${agentPrize.toFixed(2)}, estimated cost: $${params.estimatedCostUsd.toFixed(2)}. ROI ratio: ${ratio.toFixed(1)}x.`,
      agent_potential_prize: agentPrize,
      estimated_cost: params.estimatedCostUsd,
      roi_ratio: ratio,
    };
  }

  return { warning: false, severity: "none", message: null, agent_potential_prize: agentPrize, estimated_cost: params.estimatedCostUsd, roi_ratio: ratio };
}

/**
 * Validate that a share percentage is not zero and within acceptable bounds.
 * Used for both listings and member shares.
 */
export function validateSharePct(sharePct: unknown, context: "listing" | "member"): {
  valid: boolean;
  value: number;
  message: string | null;
} {
  const num = Number(sharePct);
  
  if (!Number.isFinite(num)) {
    return { valid: false, value: 0, message: "share_pct must be a valid number" };
  }

  if (num <= 0) {
    return { valid: false, value: 0, message: `share_pct cannot be zero or negative. Every ${context === "listing" ? "role" : "team member"} must have a meaningful stake.` };
  }

  const min = context === "listing" ? LISTING_MIN_SHARE_PCT : MEMBER_MIN_SHARE_PCT;
  const max = context === "listing" ? LISTING_MAX_SHARE_PCT : 100;

  if (num < min) {
    return { valid: false, value: num, message: `share_pct must be at least ${min}% for a ${context}` };
  }

  if (num > max) {
    return { valid: false, value: num, message: `share_pct cannot exceed ${max}% for a ${context}` };
  }

  return { valid: true, value: Math.round(num), message: null };
}

/**
 * Prevent agents from joining hackathons where they're also listed as marketplace roles.
 * An agent can't be both browsing for roles AND already on a team in the same hackathon
 * (unless they joined via marketplace).
 */
export async function checkAgentNotAlreadyInHackathon(
  agentId: string,
  hackathonId: string
): Promise<{ alreadyIn: boolean; teamId: string | null; role: string | null }> {
  const db = getDb();

  const existing = await db
    .select({ team_id: schema.teamMembers.teamId, role: schema.teamMembers.role })
    .from(schema.teamMembers)
    .innerJoin(schema.teams, eq(schema.teamMembers.teamId, schema.teams.id))
    .where(and(eq(schema.teamMembers.agentId, agentId), eq(schema.teams.hackathonId, hackathonId)))
    .limit(1);

  if (existing.length > 0) {
    return { alreadyIn: true, teamId: existing[0].team_id, role: existing[0].role };
  }
  return { alreadyIn: false, teamId: null, role: null };
}
