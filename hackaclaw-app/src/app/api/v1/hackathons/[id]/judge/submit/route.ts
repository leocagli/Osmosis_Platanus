import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { error, notFound, success, unauthorized } from "@/lib/responses";
import { hashToken, extractToken, validateApiKey } from "@/lib/auth";
import { loadHackathonLeaderboard } from "@/lib/hackathons";
import { telegramHackathonFinalized } from "@/lib/telegram";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/hackathons/:id/judge/submit
 *
 * Custom judge endpoint — allows the enterprise's own judge agent to submit
 * evaluation scores for all submissions in a hackathon.
 *
 * Auth: The hackathon must have judge_type="custom" and the request must include
 * the judge_api_key that was generated when the hackathon was created.
 *
 * Body: {
 *   scores: [
 *     {
 *       team_id: "uuid",
 *       functionality_score: 0-100,
 *       brief_compliance_score: 0-100,
 *       code_quality_score: 0-100,
 *       architecture_score: 0-100,
 *       innovation_score: 0-100,
 *       completeness_score: 0-100,
 *       documentation_score: 0-100,
 *       testing_score: 0-100,
 *       security_score: 0-100,
 *       deploy_readiness_score: 0-100,
 *       judge_feedback: "Detailed feedback string"
 *     },
 *     ...
 *   ],
 *   winner_team_id: "uuid" (optional — auto-picks highest if omitted)
 * }
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id: hackathonId } = await params;

  // ── Auth: verify judge key ──
  const token = extractToken(req.headers.get("authorization"));
  if (!token) return unauthorized("Judge API key required. Use 'Authorization: Bearer judge_...' header.");

  const { data: hackathon } = await supabaseAdmin
    .from("hackathons")
    .select("*")
    .eq("id", hackathonId)
    .single();

  if (!hackathon) return notFound("Hackathon");

  // Parse judging_criteria for judge config
  let judgingMeta: Record<string, unknown> = {};
  try {
    judgingMeta = typeof hackathon.judging_criteria === "string"
      ? JSON.parse(hackathon.judging_criteria)
      : (hackathon.judging_criteria || {});
  } catch { /* ignore */ }

  // Verify this hackathon uses a custom judge
  if (judgingMeta.judge_type !== "custom") {
    return error("This hackathon does not use a custom judge. It uses the BuildersClaw AI judge.", 403);
  }

  // Verify the judge key
  const storedHash = judgingMeta.judge_key_hash as string | undefined;
  if (!storedHash) {
    return error("Custom judge not properly configured for this hackathon.", 500);
  }

  const providedHash = hashToken(token);
  if (providedHash !== storedHash) {
    return error("Invalid judge API key.", 401);
  }

  // ── Parse body ──
  const body = await req.json().catch(() => ({}));
  const scores = body.scores;

  if (!Array.isArray(scores) || scores.length === 0) {
    return error("scores array is required with at least one entry.", 400);
  }

  // ── Validate and upsert scores ──
  const evaluationsToUpsert = [];

  for (const entry of scores) {
    if (!entry.team_id) {
      return error("Each score entry must have a team_id.", 400);
    }

    // Find the submission for this team
    const { data: submission } = await supabaseAdmin
      .from("submissions")
      .select("id")
      .eq("team_id", entry.team_id)
      .eq("hackathon_id", hackathonId)
      .single();

    if (!submission) {
      return error(`No submission found for team_id ${entry.team_id}. Teams must submit before being judged.`, 400);
    }

    const clamp = (v: unknown) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));

    const scores = {
      functionality_score: clamp(entry.functionality_score),
      brief_compliance_score: clamp(entry.brief_compliance_score),
      code_quality_score: clamp(entry.code_quality_score),
      architecture_score: clamp(entry.architecture_score),
      innovation_score: clamp(entry.innovation_score),
      completeness_score: clamp(entry.completeness_score),
      documentation_score: clamp(entry.documentation_score),
      testing_score: clamp(entry.testing_score),
      security_score: clamp(entry.security_score),
      deploy_readiness_score: clamp(entry.deploy_readiness_score),
    };

    // Weighted total (same weights as the platform judge)
    const weights: Record<string, number> = {
      functionality_score: 1.5,
      brief_compliance_score: 2.0,
      code_quality_score: 1.0,
      architecture_score: 1.0,
      innovation_score: 0.8,
      completeness_score: 1.2,
      documentation_score: 0.6,
      testing_score: 0.8,
      security_score: 0.8,
      deploy_readiness_score: 0.7,
    };

    const weightedSum = Object.entries(weights).reduce((sum, [key, weight]) => {
      return sum + (scores as Record<string, number>)[key] * weight;
    }, 0);
    const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
    const total_score = Math.round(weightedSum / totalWeight);

    evaluationsToUpsert.push({
      submission_id: submission.id,
      ...scores,
      total_score,
      judge_feedback: typeof entry.judge_feedback === "string" ? entry.judge_feedback.slice(0, 10000) : null,
      raw_response: JSON.stringify(entry),
    });
  }

  // Upsert all evaluations
  if (evaluationsToUpsert.length > 0) {
    const { error: upsertErr } = await supabaseAdmin
      .from("evaluations")
      .upsert(evaluationsToUpsert, { onConflict: "submission_id" });

    if (upsertErr) {
      console.error("Failed to upsert evaluations:", upsertErr);
      return error("Failed to save scores.", 500);
    }
  }

  // ── Pick winner ──
  let winnerTeamId = body.winner_team_id;

  if (!winnerTeamId) {
    // Auto-pick highest score
    evaluationsToUpsert.sort((a, b) => b.total_score - a.total_score);
    const winningEval = evaluationsToUpsert[0];
    const { data: winningSub } = await supabaseAdmin
      .from("submissions")
      .select("team_id")
      .eq("id", winningEval.submission_id)
      .single();
    winnerTeamId = winningSub?.team_id;
  }

  // Get winner agent
  let winnerAgentId: string | null = null;
  if (winnerTeamId) {
    const { data: teamMember } = await supabaseAdmin
      .from("team_members")
      .select("agent_id")
      .eq("team_id", winnerTeamId)
      .eq("role", "leader")
      .single();
    winnerAgentId = teamMember?.agent_id || null;
  }

  // ── Finalize hackathon ──
  judgingMeta.winner_team_id = winnerTeamId;
  judgingMeta.winner_agent_id = winnerAgentId;
  judgingMeta.finalized_at = new Date().toISOString();
  judgingMeta.notes = "Judged by custom enterprise judge agent.";

  await supabaseAdmin
    .from("hackathons")
    .update({
      status: "completed",
      internal_status: "completed",
      judging_criteria: JSON.stringify(judgingMeta),
    })
    .eq("id", hackathonId);

  const leaderboard = await loadHackathonLeaderboard(hackathonId);

  // Notify Telegram (fire-and-forget)
  try {
    let winnerName: string | null = null;
    if (winnerAgentId) {
      const { data: agent } = await supabaseAdmin
        .from("agents").select("display_name, name").eq("id", winnerAgentId).single();
      winnerName = agent?.display_name || agent?.name || null;
    }
    telegramHackathonFinalized({
      id: hackathonId,
      title: hackathon.title,
      winner_name: winnerName,
      total_submissions: evaluationsToUpsert.length,
    }).catch(() => {});
  } catch { /* best-effort */ }

  return success({
    message: "Custom judge scores submitted. Hackathon finalized.",
    winner_team_id: winnerTeamId,
    winner_agent_id: winnerAgentId,
    submissions_judged: evaluationsToUpsert.length,
    leaderboard,
  });
}

/**
 * GET /api/v1/hackathons/:id/judge/submit
 *
 * Returns info about what the custom judge needs to evaluate.
 * Auth: judge_api_key required.
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  const { id: hackathonId } = await params;

  const token = extractToken(req.headers.get("authorization"));
  if (!token) return unauthorized("Judge API key required.");

  const { data: hackathon } = await supabaseAdmin
    .from("hackathons")
    .select("*")
    .eq("id", hackathonId)
    .single();

  if (!hackathon) return notFound("Hackathon");

  let judgingMeta: Record<string, unknown> = {};
  try {
    judgingMeta = typeof hackathon.judging_criteria === "string"
      ? JSON.parse(hackathon.judging_criteria)
      : (hackathon.judging_criteria || {});
  } catch { /* ignore */ }

  if (judgingMeta.judge_type !== "custom") {
    return error("This hackathon does not use a custom judge.", 403);
  }

  const storedHash = judgingMeta.judge_key_hash as string | undefined;
  if (!storedHash || hashToken(token) !== storedHash) {
    return error("Invalid judge API key.", 401);
  }

  // Get all submissions
  const { data: submissions } = await supabaseAdmin
    .from("submissions")
    .select("id, team_id, preview_url, build_log, status, completed_at, teams(name)")
    .eq("hackathon_id", hackathonId);

  const parsed = (submissions || []).map((s) => {
    let meta: Record<string, unknown> = {};
    try { meta = JSON.parse(s.build_log || "{}"); } catch { /* ignore */ }
    const teamData = s.teams as { name?: string } | null;
    return {
      submission_id: s.id,
      team_id: s.team_id,
      team_name: teamData?.name || null,
      repo_url: meta.repo_url || meta.project_url || s.preview_url,
      notes: meta.notes || null,
      submitted_at: s.completed_at,
    };
  });

  return success({
    hackathon_id: hackathonId,
    title: hackathon.title,
    brief: hackathon.brief,
    rules: hackathon.rules,
    challenge_type: hackathon.challenge_type,
    ends_at: hackathon.ends_at,
    enterprise_problem: judgingMeta.enterprise_problem || null,
    enterprise_requirements: judgingMeta.enterprise_requirements || null,
    judging_priorities: judgingMeta.judging_priorities || null,
    submissions: parsed,
    scoring_criteria: [
      "functionality_score (0-100)",
      "brief_compliance_score (0-100) — MOST IMPORTANT, weighted 2x",
      "code_quality_score (0-100)",
      "architecture_score (0-100)",
      "innovation_score (0-100)",
      "completeness_score (0-100)",
      "documentation_score (0-100)",
      "testing_score (0-100)",
      "security_score (0-100)",
      "deploy_readiness_score (0-100)",
      "judge_feedback (string — detailed explanation)",
    ],
  });
}
