import { v4 as uuid } from "uuid";
import { and, count, eq, max } from "drizzle-orm";
import { formatUnits } from "viem";
import { getContractPrizePool } from "./chain";
import { getDb, schema } from "./db";
import { telegramTeamCreated } from "./telegram";
import type { Agent } from "./types";

const META_VERSION = "buildersclaw-mvp-v1";
const TEAM_COLORS = ["#00c2a8", "#ff8a00", "#ff5c7a", "#5b8cff", "#7a5cff", "#17b26a"];

type JsonObject = Record<string, unknown>;

const hackathonSelect = {
  id: schema.hackathons.id,
  title: schema.hackathons.title,
  description: schema.hackathons.description,
  brief: schema.hackathons.brief,
  rules: schema.hackathons.rules,
  entry_type: schema.hackathons.entryType,
  entry_fee: schema.hackathons.entryFee,
  prize_pool: schema.hackathons.prizePool,
  platform_fee_pct: schema.hackathons.platformFeePct,
  max_participants: schema.hackathons.maxParticipants,
  team_size_min: schema.hackathons.teamSizeMin,
  team_size_max: schema.hackathons.teamSizeMax,
  build_time_seconds: schema.hackathons.buildTimeSeconds,
  challenge_type: schema.hackathons.challengeType,
  status: schema.hackathons.status,
  created_by: schema.hackathons.createdBy,
  starts_at: schema.hackathons.startsAt,
  ends_at: schema.hackathons.endsAt,
  judging_criteria: schema.hackathons.judgingCriteria,
  github_repo: schema.hackathons.githubRepo,
  created_at: schema.hackathons.createdAt,
  updated_at: schema.hackathons.updatedAt,
};

const teamSelect = {
  id: schema.teams.id,
  hackathon_id: schema.teams.hackathonId,
  name: schema.teams.name,
  color: schema.teams.color,
  floor_number: schema.teams.floorNumber,
  status: schema.teams.status,
  telegram_chat_id: schema.teams.telegramChatId,
  created_by: schema.teams.createdBy,
  created_at: schema.teams.createdAt,
};

const submissionSelect = {
  id: schema.submissions.id,
  team_id: schema.submissions.teamId,
  hackathon_id: schema.submissions.hackathonId,
  html_content: schema.submissions.htmlContent,
  preview_url: schema.submissions.previewUrl,
  build_log: schema.submissions.buildLog,
  status: schema.submissions.status,
  files: schema.submissions.files,
  project_type: schema.submissions.projectType,
  file_count: schema.submissions.fileCount,
  languages: schema.submissions.languages,
  started_at: schema.submissions.startedAt,
  completed_at: schema.submissions.completedAt,
  created_at: schema.submissions.createdAt,
};

const teamMemberSelect = {
  id: schema.teamMembers.id,
  team_id: schema.teamMembers.teamId,
  agent_id: schema.teamMembers.agentId,
  role: schema.teamMembers.role,
  revenue_share_pct: schema.teamMembers.revenueSharePct,
  joined_via: schema.teamMembers.joinedVia,
  status: schema.teamMembers.status,
  joined_at: schema.teamMembers.joinedAt,
};

export interface HackathonMeta {
  chain_id: number | null;
  contract_address: string | null;
  sponsor_address: string | null;
  token_address: string | null;
  token_symbol: string | null;
  token_decimals: number | null;
  criteria_text: string | null;
  judge_method: string | null;
  genlayer_status: string | null;
  genlayer_contract: string | null;
  genlayer_reasoning: string | null;
  genlayer_result: Record<string, unknown> | null;
  winner_agent_id: string | null;
  winner_team_id: string | null;
  winners: Array<{ agent_id: string; wallet: string; share_bps: number }> | null;
  finalization_notes: string | null;
  finalized_at: string | null;
  finalize_tx_hash: string | null;
  scores: unknown;
}

export interface SubmissionMeta {
  project_url: string | null;
  repo_url: string | null;
  notes: string | null;
  submitted_by_agent_id: string | null;
}

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function sanitizeString(value: unknown, maxLen: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  return value.trim().slice(0, maxLen) || null;
}

export function sanitizeUrl(value: unknown, maxLen = 1024): string | null {
  const raw = sanitizeString(value, maxLen);
  if (!raw) return null;

  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function parseHackathonMeta(raw: unknown): HackathonMeta {
  const base: HackathonMeta = {
    chain_id: null,
    contract_address: null,
    sponsor_address: null,
    token_address: null,
    token_symbol: null,
    token_decimals: null,
    criteria_text: null,
    judge_method: null,
    genlayer_status: null,
    genlayer_contract: null,
    genlayer_reasoning: null,
    genlayer_result: null,
    winner_agent_id: null,
    winner_team_id: null,
    winners: null,
    finalization_notes: null,
    finalized_at: null,
    finalize_tx_hash: null,
    scores: null,
  };

  if (!raw) return base;

  // Handle JSONB (object) or text (string)
  let parsed: Record<string, unknown>;
  if (typeof raw === "string") {
    if (!raw.trim()) return base;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ...base, criteria_text: raw };
    }
  } else if (isObject(raw)) {
    parsed = raw as Record<string, unknown>;
  } else {
    return base;
  }

  if (!isObject(parsed)) {
    return base;
  }

  return {
    chain_id: typeof parsed.chain_id === "number" ? parsed.chain_id : null,
    contract_address: sanitizeString(parsed.contract_address, 128),
    sponsor_address: sanitizeString(parsed.sponsor_address, 128),
    token_address: sanitizeString(parsed.token_address, 128),
    token_symbol: sanitizeString(parsed.token_symbol, 32),
    token_decimals: typeof parsed.token_decimals === "number" ? parsed.token_decimals : null,
    criteria_text: sanitizeString(parsed.criteria_text, 4000),
    judge_method: sanitizeString(parsed.judge_method, 64),
    genlayer_status: sanitizeString(parsed.genlayer_status, 64),
    genlayer_contract: sanitizeString(parsed.genlayer_contract, 128),
    genlayer_reasoning: sanitizeString(parsed.genlayer_reasoning, 4000),
    genlayer_result: isObject(parsed.genlayer_result) ? parsed.genlayer_result as Record<string, unknown> : null,
    winner_agent_id: sanitizeString(parsed.winner_agent_id, 64),
    winner_team_id: sanitizeString(parsed.winner_team_id, 64),
    winners: Array.isArray(parsed.winners) ? parsed.winners as HackathonMeta["winners"] : null,
    finalization_notes: sanitizeString(parsed.finalization_notes, 4000),
    finalized_at: sanitizeString(parsed.finalized_at, 128),
    finalize_tx_hash: sanitizeString(parsed.finalize_tx_hash, 256),
    scores: parsed.scores ?? null,
  };
}

export function serializeHackathonMeta(meta: Partial<HackathonMeta>): string {
  return JSON.stringify({
    _format: META_VERSION,
    chain_id: meta.chain_id ?? null,
    contract_address: meta.contract_address ?? null,
    sponsor_address: meta.sponsor_address ?? null,
    token_address: meta.token_address ?? null,
    token_symbol: meta.token_symbol ?? null,
    token_decimals: meta.token_decimals ?? null,
    criteria_text: meta.criteria_text ?? null,
    judge_method: meta.judge_method ?? null,
    genlayer_status: meta.genlayer_status ?? null,
    genlayer_contract: meta.genlayer_contract ?? null,
    genlayer_reasoning: meta.genlayer_reasoning ?? null,
    genlayer_result: meta.genlayer_result ?? null,
    winner_agent_id: meta.winner_agent_id ?? null,
    winner_team_id: meta.winner_team_id ?? null,
    winners: meta.winners ?? null,
    finalization_notes: meta.finalization_notes ?? null,
    finalized_at: meta.finalized_at ?? null,
    finalize_tx_hash: meta.finalize_tx_hash ?? null,
    scores: meta.scores ?? null,
  });
}

export function parseSubmissionMeta(raw: unknown, previewUrl?: unknown): SubmissionMeta {
  const base: SubmissionMeta = {
    project_url: typeof previewUrl === "string" ? previewUrl : null,
    repo_url: null,
    notes: null,
    submitted_by_agent_id: null,
  };

  if (typeof raw !== "string" || !raw.trim()) return base;

  try {
    const parsed = JSON.parse(raw);
    if (!isObject(parsed)) return base;

    return {
      project_url: sanitizeUrl(parsed.project_url, 1024) ?? base.project_url,
      repo_url: sanitizeUrl(parsed.repo_url, 1024),
      notes: sanitizeString(parsed.notes, 4000),
      submitted_by_agent_id: sanitizeString(parsed.submitted_by_agent_id, 64),
    };
  } catch {
    return base;
  }
}

export function serializeSubmissionMeta(meta: Partial<SubmissionMeta>): string {
  return JSON.stringify({
    project_url: meta.project_url ?? null,
    repo_url: meta.repo_url ?? null,
    notes: meta.notes ?? null,
    submitted_by_agent_id: meta.submitted_by_agent_id ?? null,
  });
}

export function toPublicHackathonStatus(status: unknown): "open" | "judging" | "closed" | "finalized" {
  if (status === "open" || status === "in_progress") return "open";
  if (status === "judging") return "judging";
  if (status === "completed") return "finalized";
  return "closed";
}

export function toInternalHackathonStatus(status: unknown): string | null {
  if (status === "scheduled") return "scheduled";
  if (status === "open") return "open";
  if (status === "closed") return "judging";
  if (status === "finalized") return "completed";
  return null;
}

export function formatHackathon(hackathon: JsonObject) {
  const meta = parseHackathonMeta(hackathon.judging_criteria);

  return {
    ...hackathon,
    internal_status: hackathon.status,
    status: toPublicHackathonStatus(hackathon.status),
    judging_criteria: meta.criteria_text,
    contract_address: meta.contract_address,
    chain_id: meta.chain_id,
    winner: meta.winner_agent_id
      ? {
          agent_id: meta.winner_agent_id,
          team_id: meta.winner_team_id,
          winners: meta.winners,
          notes: meta.finalization_notes,
          scores: meta.scores,
          finalized_at: meta.finalized_at,
          finalize_tx_hash: meta.finalize_tx_hash,
          claim_instructions: meta.contract_address
            ? "Each winning team member calls claim() independently from their wallet. See GET /api/v1/hackathons/:id/contract for ABI and details."
            : null,
        }
      : null,
    genlayer: meta.genlayer_contract
      ? {
          contract_address: meta.genlayer_contract,
          judge_method: meta.judge_method,
          reasoning: meta.genlayer_reasoning,
          result: meta.genlayer_result,
        }
      : null,
  };
}

/**
 * Calculate the dynamic prize pool for a hackathon.
 * Prize = (entry_fee × participant_count) − 10% platform cut.
 */
export async function calculatePrizePool(hackathonId: string): Promise<{
  entry_fee: number;
  participant_count: number;
  total_pot: number;
  platform_cut_pct: number;
  platform_cut: number;
  prize_pool: number;
  sponsored: boolean;
  currency?: string;
}> {
  const db = getDb();
  const [hackathon] = await db
    .select({ entry_fee: schema.hackathons.entryFee, judging_criteria: schema.hackathons.judgingCriteria })
    .from(schema.hackathons)
    .where(eq(schema.hackathons.id, hackathonId))
    .limit(1);

  const entryFee = hackathon?.entry_fee ?? 0;

  const [participantCountRow] = await db
    .select({ count: count() })
    .from(schema.teams)
    .where(eq(schema.teams.hackathonId, hackathonId));

  const participantCount = participantCountRow?.count || 0;

  // Sponsored mode: entry_fee is 0 and contract holds the bounty
  if (entryFee === 0) {
    const meta = parseHackathonMeta(hackathon?.judging_criteria);
    let prizePool = 0;
    if (meta.contract_address) {
      try {
        const balanceUnits = await getContractPrizePool(meta.contract_address);
        prizePool = Number(formatUnits(balanceUnits, meta.token_decimals ?? Number(process.env.USDC_DECIMALS || 18)));
      } catch {
        // Fallback to DB prize_pool if chain is unreachable
      }
    }
    return {
      entry_fee: 0,
      participant_count: participantCount,
      total_pot: prizePool,
      platform_cut_pct: 0,
      platform_cut: 0,
      prize_pool: prizePool,
      sponsored: true,
      currency: meta.token_symbol || process.env.USDC_SYMBOL || "USDC",
    };
  }

  // Paid mode: prize = entry fees minus 10% platform cut
  const totalPot = entryFee * participantCount;
  const platformCutPct = 0.10;
  const platformCut = totalPot * platformCutPct;
  const prizePool = totalPot - platformCut;

  return {
    entry_fee: entryFee,
    participant_count: participantCount,
    total_pot: totalPot,
    platform_cut_pct: platformCutPct,
    platform_cut: platformCut,
    prize_pool: Math.max(0, prizePool),
    sponsored: false,
  };
}

function extractNumericScore(value: unknown): number | null {
  const score = Number(value);
  if (Number.isNaN(score)) return null;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function resolveManualScore(
  scores: unknown,
  identifiers: { teamId?: string | null; agentId?: string | null; submissionId?: string | null }
) {
  if (!scores) return null;

  const matches = (entry: unknown) => {
    if (!isObject(entry)) return null;

    const score = extractNumericScore(entry.total_score ?? entry.score);
    const notes = sanitizeString(entry.notes ?? entry.feedback, 4000);
    const entryTeamId = sanitizeString(entry.team_id, 64);
    const entryAgentId = sanitizeString(entry.agent_id, 64);
    const entrySubmissionId = sanitizeString(entry.submission_id, 64);

    const matched = [
      identifiers.submissionId && entrySubmissionId === identifiers.submissionId,
      identifiers.teamId && entryTeamId === identifiers.teamId,
      identifiers.agentId && entryAgentId === identifiers.agentId,
    ].some(Boolean);

    return matched ? { total_score: score, notes, raw: entry } : null;
  };

  if (Array.isArray(scores)) {
    for (const entry of scores) {
      const matched = matches(entry);
      if (matched) return matched;
    }
    return null;
  }

  if (isObject(scores)) {
    const keyedEntries = [identifiers.submissionId, identifiers.teamId, identifiers.agentId]
      .filter(Boolean)
      .map((key) => (key ? scores[key] : null));

    for (const entry of keyedEntries) {
      if (entry === null || entry === undefined) continue;
      if (typeof entry === "number") {
        return { total_score: extractNumericScore(entry), notes: null, raw: entry };
      }
      const matched = matches(entry);
      if (matched) return matched;
    }
  }

  return null;
}

function pickTeamColor(agentId: string) {
  const checksum = agentId.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return TEAM_COLORS[checksum % TEAM_COLORS.length];
}

export async function createSingleAgentTeam(options: {
  hackathonId: string;
  agent: Agent;
  name?: string | null;
  color?: string | null;
  wallet?: string | null;
  txHash?: string | null;
}) {
  const { hackathonId, agent, wallet, txHash } = options;
  const db = getDb();

  const [existingTeam] = await db
    .select(teamSelect)
    .from(schema.teamMembers)
    .innerJoin(schema.teams, eq(schema.teamMembers.teamId, schema.teams.id))
    .where(and(eq(schema.teamMembers.agentId, agent.id), eq(schema.teams.hackathonId, hackathonId)))
    .limit(1);

  if (existingTeam) {
    return {
      team: existingTeam,
      existed: true,
    };
  }

  const { team, teamName, teamId, hackathonTitle } = await db.transaction(async (tx) => {
    const [maxFloorData] = await tx
      .select({ floor_number: max(schema.teams.floorNumber) })
      .from(schema.teams)
      .where(eq(schema.teams.hackathonId, hackathonId));

    const floorNumber = (maxFloorData?.floor_number || 0) + 1;
    const teamId = uuid();
    const teamName =
      sanitizeString(options.name, 120) ||
      sanitizeString(agent.display_name, 120) ||
      sanitizeString(agent.name, 120) ||
      `participant-${floorNumber}`;

    const [team] = await tx
      .insert(schema.teams)
      .values({
        id: teamId,
        hackathonId,
        name: teamName,
        color: sanitizeString(options.color, 32) || pickTeamColor(agent.id),
        floorNumber,
        status: "ready",
        createdBy: agent.id,
      })
      .returning(teamSelect);

    await tx.insert(schema.teamMembers).values({
      id: uuid(),
      teamId,
      agentId: agent.id,
      role: "leader",
      revenueSharePct: 100,
      joinedVia: "direct",
    });

    if (wallet) {
      await tx.update(schema.agents).set({ walletAddress: wallet }).where(eq(schema.agents.id, agent.id));
    }

    await tx.insert(schema.activityLog).values({
      id: uuid(),
      hackathonId,
      teamId,
      agentId: agent.id,
      eventType: "hackathon_joined",
      eventData: {
        team_name: teamName,
        wallet: wallet ?? agent.wallet_address ?? null,
        tx_hash: txHash ?? null,
      },
    });

    const [hackathonData] = await tx
      .select({ title: schema.hackathons.title })
      .from(schema.hackathons)
      .where(eq(schema.hackathons.id, hackathonId))
      .limit(1);

    return { team, teamName, teamId, hackathonTitle: hackathonData?.title || "Hackathon" };
  });

  telegramTeamCreated({
    teamId,
    teamName,
    hackathonTitle,
    hackathonId,
    leaderName: agent.display_name || agent.name,
  }).catch((err) => console.error("[TELEGRAM] Auto-topic failed:", err));

  return { team, existed: false };
}

export async function loadHackathonLeaderboard(hackathonId: string) {
  const db = getDb();
  const [hackathon] = await db
    .select(hackathonSelect)
    .from(schema.hackathons)
    .where(eq(schema.hackathons.id, hackathonId))
    .limit(1);

  if (!hackathon) return null;

  const meta = parseHackathonMeta(hackathon.judging_criteria);

  const teams = await db
    .select(teamSelect)
    .from(schema.teams)
    .where(eq(schema.teams.hackathonId, hackathonId))
    .orderBy(schema.teams.floorNumber);

  const ranked = await Promise.all(
    teams.map(async (team) => {
      const [submission] = await db
        .select(submissionSelect)
        .from(schema.submissions)
        .where(and(eq(schema.submissions.teamId, team.id), eq(schema.submissions.hackathonId, hackathonId)))
        .limit(1);

      const members = await db
        .select({
          ...teamMemberSelect,
          agent_name: schema.agents.name,
          agent_display_name: schema.agents.displayName,
          agent_avatar_url: schema.agents.avatarUrl,
        })
        .from(schema.teamMembers)
        .leftJoin(schema.agents, eq(schema.teamMembers.agentId, schema.agents.id))
        .where(eq(schema.teamMembers.teamId, team.id))
        .orderBy(schema.teamMembers.joinedAt);

      const flatMembers: Array<JsonObject & { agent_id?: string }> = members.map((member) => {
        return {
          ...member,
          agents: undefined,
        };
      });

      const primaryAgentId = typeof flatMembers[0]?.agent_id === "string" ? flatMembers[0].agent_id : null;
      const submissionMeta = parseSubmissionMeta(submission?.build_log, submission?.preview_url);
      
      let aiScore = null;
      let rawResponse = null;
      if (submission?.id) {
        const [evalData] = await db
          .select({
            total_score: schema.evaluations.totalScore,
            judge_feedback: schema.evaluations.judgeFeedback,
            raw_response: schema.evaluations.rawResponse,
          })
          .from(schema.evaluations)
          .where(eq(schema.evaluations.submissionId, submission.id))
          .limit(1);
        if (evalData) {
          aiScore = evalData;
          try {
             rawResponse = typeof evalData.raw_response === "string" ? JSON.parse(evalData.raw_response) : evalData.raw_response;
          } catch { /* ignore */ }
        }
      }

      const manualScore = resolveManualScore(meta.scores, {
        submissionId: submission?.id ?? null,
        teamId: team.id,
        agentId: primaryAgentId,
      });

      const isWinner =
        meta.winner_team_id === team.id ||
        (!!primaryAgentId && meta.winner_agent_id === primaryAgentId) ||
        (!!submission?.id && meta.winner_agent_id && flatMembers.some((member) => member.agent_id === meta.winner_agent_id));

      const isJudgingComplete = hackathon.status === "completed" || hackathon.status === "finalized";
      const totalScore = isJudgingComplete ? (manualScore?.total_score ?? aiScore?.total_score ?? null) : null;
      
      let feedback = manualScore?.notes ?? aiScore?.judge_feedback ?? null;
      let evidence = null;
      let warnings = null;

      if (!isJudgingComplete) {
        if (hackathon.status === "judging") {
          // Provide coarse judging progress
          feedback = "Judging in progress...";
          if (meta.genlayer_status === "queued" || meta.genlayer_status === "deploying" || meta.genlayer_status === "submitting" || meta.genlayer_status === "finalizing") {
             feedback = "GenLayer on-chain consensus in progress...";
          }
        } else {
          feedback = null;
        }
      } else {
        // Expose evidence and warnings when completed
        if (rawResponse && typeof rawResponse === "object") {
          evidence = (rawResponse as Record<string, unknown>).finalist_evidence ?? null;
          warnings = (evidence as Record<string, unknown>)?.warnings ?? null;
        }
      }

      return {
        team_id: team.id,
        team_name: team.name,
        team_color: team.color,
        floor_number: team.floor_number,
        status: team.status,
        members: flatMembers,
        submission_id: submission?.id ?? null,
        submission_status: submission?.status ?? null,
        total_score: totalScore,
        judge_feedback: feedback,
        evidence,
        warnings,
        winner: isJudgingComplete ? isWinner : false,
        project_url: submissionMeta.project_url,
        repo_url: submissionMeta.repo_url,
        github_repo: hackathon.github_repo ?? null,
        team_slug: team.name ? team.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) : null,
        submission_notes: submissionMeta.notes,
      };
    })
  );

  ranked.sort((a, b) => {
    if (a.winner && !b.winner) return -1;
    if (!a.winner && b.winner) return 1;
    if (a.total_score !== null && b.total_score !== null) return b.total_score - a.total_score;
    if (a.total_score !== null) return -1;
    if (b.total_score !== null) return 1;
    return (a.floor_number ?? 0) - (b.floor_number ?? 0);
  });

  return ranked.map((entry, index) => ({ ...entry, rank: index + 1 }));
}
