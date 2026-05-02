import { NextRequest } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { error, notFound, success, unauthorized } from "@buildersclaw/shared/responses";
import { hashToken, extractToken } from "@buildersclaw/shared/auth";
import { getDb, schema } from "@buildersclaw/shared/db";
import { loadHackathonLeaderboard } from "@buildersclaw/shared/hackathons";
import { telegramHackathonFinalized } from "@buildersclaw/shared/telegram";

type RouteParams = { params: Promise<{ id: string }> };

const hackathonSelect = {
  id: schema.hackathons.id,
  title: schema.hackathons.title,
  brief: schema.hackathons.brief,
  rules: schema.hackathons.rules,
  challenge_type: schema.hackathons.challengeType,
  ends_at: schema.hackathons.endsAt,
  judging_criteria: schema.hackathons.judgingCriteria,
};

type EvaluationUpsert = typeof schema.evaluations.$inferInsert & { submissionId: string; totalScore: number };

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
  const db = getDb();

  // ── Auth: verify judge key ──
  const token = extractToken(req.headers.get("authorization"));
  if (!token) return unauthorized("Judge API key required. Use 'Authorization: Bearer judge_...' header.");

  const [hackathon] = await db
    .select(hackathonSelect)
    .from(schema.hackathons)
    .where(eq(schema.hackathons.id, hackathonId))
    .limit(1);

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
  const evaluationsToUpsert: EvaluationUpsert[] = [];

  for (const entry of scores) {
    if (!entry.team_id) {
      return error("Each score entry must have a team_id.", 400);
    }

    // Find the submission for this team
    const [submission] = await db
      .select({ id: schema.submissions.id })
      .from(schema.submissions)
      .where(and(eq(schema.submissions.teamId, entry.team_id), eq(schema.submissions.hackathonId, hackathonId)))
      .limit(1);

    if (!submission) {
      return error(`No submission found for team_id ${entry.team_id}. Teams must submit before being judged.`, 400);
    }

    const clamp = (v: unknown) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));

    const scoreValues = {
      functionalityScore: clamp(entry.functionality_score),
      briefComplianceScore: clamp(entry.brief_compliance_score),
      codeQualityScore: clamp(entry.code_quality_score),
      architectureScore: clamp(entry.architecture_score),
      innovationScore: clamp(entry.innovation_score),
      completenessScore: clamp(entry.completeness_score),
      documentationScore: clamp(entry.documentation_score),
      testingScore: clamp(entry.testing_score),
      securityScore: clamp(entry.security_score),
      deployReadinessScore: clamp(entry.deploy_readiness_score),
    };

    // Weighted total (same weights as the platform judge)
    const weights: Record<string, number> = {
      functionalityScore: 1.5,
      briefComplianceScore: 2.0,
      codeQualityScore: 1.0,
      architectureScore: 1.0,
      innovationScore: 0.8,
      completenessScore: 1.2,
      documentationScore: 0.6,
      testingScore: 0.8,
      securityScore: 0.8,
      deployReadinessScore: 0.7,
    };

    const weightedSum = Object.entries(weights).reduce((sum, [key, weight]) => {
      return sum + (scoreValues as Record<string, number>)[key] * weight;
    }, 0);
    const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
    const totalScore = Math.round(weightedSum / totalWeight);

    evaluationsToUpsert.push({
      submissionId: submission.id,
      ...scoreValues,
      totalScore,
      judgeFeedback: typeof entry.judge_feedback === "string" ? entry.judge_feedback.slice(0, 10000) : null,
      rawResponse: JSON.stringify(entry),
    });
  }

  // Upsert all evaluations
  if (evaluationsToUpsert.length > 0) {
    try {
      await db
        .insert(schema.evaluations)
        .values(evaluationsToUpsert)
        .onConflictDoUpdate({
          target: schema.evaluations.submissionId,
          set: {
            functionalityScore: sql`excluded.functionality_score`,
            briefComplianceScore: sql`excluded.brief_compliance_score`,
            codeQualityScore: sql`excluded.code_quality_score`,
            architectureScore: sql`excluded.architecture_score`,
            innovationScore: sql`excluded.innovation_score`,
            completenessScore: sql`excluded.completeness_score`,
            documentationScore: sql`excluded.documentation_score`,
            testingScore: sql`excluded.testing_score`,
            securityScore: sql`excluded.security_score`,
            deployReadinessScore: sql`excluded.deploy_readiness_score`,
            totalScore: sql`excluded.total_score`,
            judgeFeedback: sql`excluded.judge_feedback`,
            rawResponse: sql`excluded.raw_response`,
          },
        });
    } catch (err) {
      console.error("Failed to upsert evaluations:", err);
      return error("Failed to save scores.", 500);
    }
  }

  // ── Pick winner ──
  let winnerTeamId = body.winner_team_id;

  if (!winnerTeamId) {
    // Auto-pick highest score
    evaluationsToUpsert.sort((a, b) => b.totalScore - a.totalScore);
    const winningEval = evaluationsToUpsert[0];
    const [winningSub] = await db
      .select({ team_id: schema.submissions.teamId })
      .from(schema.submissions)
      .where(eq(schema.submissions.id, winningEval.submissionId))
      .limit(1);
    winnerTeamId = winningSub?.team_id;
  }

  // Get winner agent
  let winnerAgentId: string | null = null;
  if (winnerTeamId) {
    const [teamMember] = await db
      .select({ agent_id: schema.teamMembers.agentId })
      .from(schema.teamMembers)
      .where(and(eq(schema.teamMembers.teamId, winnerTeamId), eq(schema.teamMembers.role, "leader")))
      .limit(1);
    winnerAgentId = teamMember?.agent_id || null;
  }

  // ── Finalize hackathon ──
  judgingMeta.winner_team_id = winnerTeamId;
  judgingMeta.winner_agent_id = winnerAgentId;
  judgingMeta.finalized_at = new Date().toISOString();
  judgingMeta.notes = "Judged by custom enterprise judge agent.";

  await db
    .update(schema.hackathons)
    .set({
      status: "completed",
      judgingCriteria: JSON.stringify(judgingMeta),
    })
    .where(eq(schema.hackathons.id, hackathonId));

  const leaderboard = await loadHackathonLeaderboard(hackathonId);

  // Notify Telegram (fire-and-forget)
  try {
    let winnerName: string | null = null;
    if (winnerAgentId) {
      const [agent] = await db
        .select({ display_name: schema.agents.displayName, name: schema.agents.name })
        .from(schema.agents)
        .where(eq(schema.agents.id, winnerAgentId))
        .limit(1);
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
  const db = getDb();

  const token = extractToken(req.headers.get("authorization"));
  if (!token) return unauthorized("Judge API key required.");

  const [hackathon] = await db
    .select(hackathonSelect)
    .from(schema.hackathons)
    .where(eq(schema.hackathons.id, hackathonId))
    .limit(1);

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
  const submissions = await db
    .select({
      id: schema.submissions.id,
      team_id: schema.submissions.teamId,
      preview_url: schema.submissions.previewUrl,
      build_log: schema.submissions.buildLog,
      completed_at: schema.submissions.completedAt,
      teams: { name: schema.teams.name },
    })
    .from(schema.submissions)
    .leftJoin(schema.teams, eq(schema.submissions.teamId, schema.teams.id))
    .where(eq(schema.submissions.hackathonId, hackathonId));

  const parsed = submissions.map((s) => {
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
