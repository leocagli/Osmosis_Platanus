import { v4 as uuid } from "uuid";
import { supabaseAdmin } from "@/lib/supabase";
import type { Agent } from "@/lib/types";

const META_VERSION = "hackaclaw-mvp-v1";
const TEAM_COLORS = ["#00c2a8", "#ff8a00", "#ff5c7a", "#5b8cff", "#7a5cff", "#17b26a"];

type JsonObject = Record<string, unknown>;

export interface HackathonMeta {
  chain_id: number | null;
  contract_address: string | null;
  criteria_text: string | null;
  winner_agent_id: string | null;
  winner_team_id: string | null;
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
    criteria_text: null,
    winner_agent_id: null,
    winner_team_id: null,
    finalization_notes: null,
    finalized_at: null,
    finalize_tx_hash: null,
    scores: null,
  };

  if (typeof raw !== "string" || !raw.trim()) return base;

  try {
    const parsed = JSON.parse(raw);
    if (!isObject(parsed) || parsed._format !== META_VERSION) {
      return { ...base, criteria_text: raw };
    }

    return {
      chain_id: typeof parsed.chain_id === "number" ? parsed.chain_id : null,
      contract_address: sanitizeString(parsed.contract_address, 128),
      criteria_text: sanitizeString(parsed.criteria_text, 4000),
      winner_agent_id: sanitizeString(parsed.winner_agent_id, 64),
      winner_team_id: sanitizeString(parsed.winner_team_id, 64),
      finalization_notes: sanitizeString(parsed.finalization_notes, 4000),
      finalized_at: sanitizeString(parsed.finalized_at, 128),
      finalize_tx_hash: sanitizeString(parsed.finalize_tx_hash, 256),
      scores: parsed.scores ?? null,
    };
  } catch {
    return { ...base, criteria_text: raw };
  }
}

export function serializeHackathonMeta(meta: Partial<HackathonMeta>): string {
  return JSON.stringify({
    _format: META_VERSION,
    chain_id: meta.chain_id ?? null,
    contract_address: meta.contract_address ?? null,
    criteria_text: meta.criteria_text ?? null,
    winner_agent_id: meta.winner_agent_id ?? null,
    winner_team_id: meta.winner_team_id ?? null,
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

export function toPublicHackathonStatus(status: unknown): "open" | "closed" | "finalized" {
  if (status === "open") return "open";
  if (status === "completed") return "finalized";
  return "closed";
}

export function toInternalHackathonStatus(status: unknown): string | null {
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
    winner: meta.winner_agent_id
      ? {
          agent_id: meta.winner_agent_id,
          team_id: meta.winner_team_id,
          notes: meta.finalization_notes,
          scores: meta.scores,
          finalized_at: meta.finalized_at,
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
}> {
  const { data: hackathon } = await supabaseAdmin
    .from("hackathons").select("entry_fee").eq("id", hackathonId).single();

  const entryFee = hackathon?.entry_fee ?? 0;

  const { count } = await supabaseAdmin
    .from("teams")
    .select("*", { count: "exact", head: true })
    .eq("hackathon_id", hackathonId);

  const participantCount = count || 0;
  const totalPot = entryFee * participantCount;
  const platformCutPct = 0.10; // 10% platform cut on prize
  const platformCut = totalPot * platformCutPct;
  const prizePool = totalPot - platformCut;

  return {
    entry_fee: entryFee,
    participant_count: participantCount,
    total_pot: totalPot,
    platform_cut_pct: platformCutPct,
    platform_cut: platformCut,
    prize_pool: Math.max(0, prizePool),
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

  const { data: existingMembership } = await supabaseAdmin
    .from("team_members")
    .select("team_id, teams!inner(*)")
    .eq("agent_id", agent.id)
    .eq("teams.hackathon_id", hackathonId)
    .single();

  if (existingMembership) {
    const existingTeamValue = existingMembership.teams as unknown;
    const existingTeam = Array.isArray(existingTeamValue)
      ? (existingTeamValue[0] as JsonObject | undefined) ?? null
      : (existingTeamValue as JsonObject | null);
    return {
      team: existingTeam,
      existed: true,
    };
  }

  const { data: maxFloorData } = await supabaseAdmin
    .from("teams")
    .select("floor_number")
    .eq("hackathon_id", hackathonId)
    .order("floor_number", { ascending: false })
    .limit(1);

  const floorNumber = (maxFloorData?.[0]?.floor_number || 0) + 1;
  const teamId = uuid();
  const teamName =
    sanitizeString(options.name, 120) ||
    sanitizeString(agent.display_name, 120) ||
    sanitizeString(agent.name, 120) ||
    `participant-${floorNumber}`;

  await supabaseAdmin.from("teams").insert({
    id: teamId,
    hackathon_id: hackathonId,
    name: teamName,
    color: sanitizeString(options.color, 32) || pickTeamColor(agent.id),
    floor_number: floorNumber,
    status: "ready",
    created_by: agent.id,
  });

  await supabaseAdmin.from("team_members").insert({
    id: uuid(),
    team_id: teamId,
    agent_id: agent.id,
    role: "leader",
    revenue_share_pct: 100,
    joined_via: "direct",
  });

  if (wallet) {
    await supabaseAdmin.from("agents").update({ wallet_address: wallet }).eq("id", agent.id);
  }

  await supabaseAdmin.from("activity_log").insert({
    id: uuid(),
    hackathon_id: hackathonId,
    team_id: teamId,
    agent_id: agent.id,
    event_type: "hackathon_joined",
    event_data: {
      team_name: teamName,
      wallet: wallet ?? agent.wallet_address ?? null,
      tx_hash: txHash ?? null,
    },
  });

  const { data: team } = await supabaseAdmin.from("teams").select("*").eq("id", teamId).single();
  return { team, existed: false };
}

export async function loadHackathonLeaderboard(hackathonId: string) {
  const { data: hackathon } = await supabaseAdmin
    .from("hackathons")
    .select("*")
    .eq("id", hackathonId)
    .single();

  if (!hackathon) return null;

  const meta = parseHackathonMeta(hackathon.judging_criteria);

  const { data: teams } = await supabaseAdmin
    .from("teams")
    .select("*")
    .eq("hackathon_id", hackathonId)
    .order("floor_number", { ascending: true });

  const ranked = await Promise.all(
    (teams || []).map(async (team) => {
      const { data: submission } = await supabaseAdmin
        .from("submissions")
        .select("*")
        .eq("team_id", team.id)
        .eq("hackathon_id", hackathonId)
        .single();

      const { data: members } = await supabaseAdmin
        .from("team_members")
        .select("*, agents(name, display_name, avatar_url)")
        .eq("team_id", team.id)
        .order("joined_at", { ascending: true });

      const flatMembers: Array<JsonObject & { agent_id?: string }> = (members || []).map((member: JsonObject) => {
        const linkedAgent = member.agents as JsonObject | null;
        return {
          ...member,
          agents: undefined,
          agent_name: linkedAgent?.name,
          agent_display_name: linkedAgent?.display_name,
          agent_avatar_url: linkedAgent?.avatar_url,
        };
      });

      const primaryAgentId = typeof flatMembers[0]?.agent_id === "string" ? flatMembers[0].agent_id : null;
      const submissionMeta = parseSubmissionMeta(submission?.build_log, submission?.preview_url);
      
      let aiScore = null;
      if (submission?.id) {
        const { data: evalData } = await supabaseAdmin
          .from("evaluations")
          .select("total_score, judge_feedback")
          .eq("submission_id", submission.id)
          .single();
        if (evalData) aiScore = evalData;
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

      return {
        team_id: team.id,
        team_name: team.name,
        team_color: team.color,
        floor_number: team.floor_number,
        status: team.status,
        members: flatMembers,
        submission_id: submission?.id ?? null,
        submission_status: submission?.status ?? null,
        total_score: manualScore?.total_score ?? aiScore?.total_score ?? null,
        judge_feedback: manualScore?.notes ?? aiScore?.judge_feedback ?? null,
        winner: isWinner,
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
