import { and, eq, inArray, sql } from "drizzle-orm";
import { generateCode } from "./llm";
import { fetchRepoForJudging, formatRepoForPrompt, parseGitHubUrl } from "./repo-fetcher";
import { Hackathon, Submission } from "./types";
import { getDb, schema } from "./db";
import {
  isGenLayerAvailable,
  startGenLayerDeployment,
  pollGenLayerDeployment,
  startGenLayerSubmit,
  pollGenLayerWrite,
  startGenLayerFinalize,
  getGenLayerJudgeResult,
  type GenLayerContender,
} from "./genlayer";
import { isViableSubmission } from "./validation";
import { TransactionStatus } from "genlayer-js/types";
import { enqueueJob } from "./queue";
import { updateActiveJudgingRunForHackathon, updateJudgingRun } from "./judging-runs";

export interface EvaluationResult {
  functionality_score: number;
  brief_compliance_score: number;
  code_quality_score: number;
  architecture_score: number;
  innovation_score: number;
  completeness_score: number;
  documentation_score: number;
  testing_score: number;
  security_score: number;
  deploy_readiness_score: number;
  total_score: number;
  judge_feedback: string;
}

type JudgingMeta = Record<string, unknown>;

type HackathonJudgeRow = Omit<Hackathon, "judging_criteria" | "status"> & {
  judging_criteria: JudgingMeta | string | null;
  status: string;
};

type SubmissionWithTeam = Submission & { teams?: { name?: string; status?: string } | null };

interface JudgingRunResult {
  completed: boolean;
  queuedGenLayer: boolean;
  submissionsJudged: number;
}

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

const submissionSelect = {
  id: schema.submissions.id,
  team_id: schema.submissions.teamId,
  hackathon_id: schema.submissions.hackathonId,
  html_content: schema.submissions.htmlContent,
  preview_url: schema.submissions.previewUrl,
  build_log: schema.submissions.buildLog,
  status: schema.submissions.status,
  started_at: schema.submissions.startedAt,
  completed_at: schema.submissions.completedAt,
  created_at: schema.submissions.createdAt,
};

function toEvaluationRow(values: {
  submission_id: string;
  functionality_score: number;
  brief_compliance_score: number;
  code_quality_score: number;
  architecture_score: number;
  innovation_score: number;
  completeness_score: number;
  documentation_score: number;
  testing_score: number;
  security_score: number;
  deploy_readiness_score: number;
  total_score: number;
  judge_feedback: string;
  raw_response: string;
}) {
  return {
    submissionId: values.submission_id,
    functionalityScore: values.functionality_score,
    briefComplianceScore: values.brief_compliance_score,
    codeQualityScore: values.code_quality_score,
    architectureScore: values.architecture_score,
    innovationScore: values.innovation_score,
    completenessScore: values.completeness_score,
    documentationScore: values.documentation_score,
    testingScore: values.testing_score,
    securityScore: values.security_score,
    deployReadinessScore: values.deploy_readiness_score,
    totalScore: values.total_score,
    judgeFeedback: values.judge_feedback,
    rawResponse: values.raw_response,
  };
}

async function upsertEvaluations(values: Parameters<typeof toEvaluationRow>[0][]) {
  if (values.length === 0) return;
  const rows = values.map(toEvaluationRow);
  await getDb()
    .insert(schema.evaluations)
    .values(rows)
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
}

function parseJudgingMeta(raw: unknown): JudgingMeta {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed as JudgingMeta : {};
    } catch {
      return {};
    }
  }

  return raw && typeof raw === "object" ? raw as JudgingMeta : {};
}

async function updateHackathonJudgingMeta(hackathonId: string, meta: JudgingMeta, status?: string) {
  const payload: Partial<typeof schema.hackathons.$inferInsert> = { judgingCriteria: meta };
  if (status) payload.status = status;

  await getDb().update(schema.hackathons).set(payload).where(eq(schema.hackathons.id, hackathonId));
}

function buildTopContenders(
  evaluationsToUpsert: Array<{ submission_id: string; total_score: number; judge_feedback: string | null }>,
  submissions: Array<Submission & { teams?: { name?: string } | { name?: string }[] }>,
) {
  const topEvals = evaluationsToUpsert
    .filter((e) => e.total_score > 0)
    .sort((a, b) => b.total_score - a.total_score)
    .slice(0, 3);

  const contenders: GenLayerContender[] = [];
  for (const ev of topEvals) {
    const sub = submissions.find((s) => s.id === ev.submission_id);
    if (!sub) continue;
    const teamData = Array.isArray(sub.teams) ? sub.teams[0] : sub.teams;
    contenders.push({
      team_id: sub.team_id,
      team_name: teamData?.name || sub.team_id,
      repo_summary: (ev.judge_feedback || "").slice(0, 1500),
      gemini_score: ev.total_score,
    });
  }

  return { topEvals, contenders };
}

async function resolveWinnerAgentId(winnerTeamId: string) {
  const [leaderMember] = await getDb()
    .select({ agent_id: schema.teamMembers.agentId })
    .from(schema.teamMembers)
    .where(and(eq(schema.teamMembers.teamId, winnerTeamId), eq(schema.teamMembers.role, "leader")))
    .limit(1);

  if (leaderMember?.agent_id) return leaderMember.agent_id;

  const [anyMember] = await getDb()
    .select({ agent_id: schema.teamMembers.agentId })
    .from(schema.teamMembers)
    .where(eq(schema.teamMembers.teamId, winnerTeamId))
    .limit(1);

  return anyMember?.agent_id || null;
}

async function finalizeJudging(
  hackathonId: string,
  meta: JudgingMeta,
  winnerTeamId: string,
  judgeMethod: string,
  notes: string,
) {
  meta.winner_team_id = winnerTeamId;
  meta.winner_agent_id = await resolveWinnerAgentId(winnerTeamId);
  meta.finalized_at = new Date().toISOString();
  meta.judge_method = judgeMethod;
  meta.notes = notes;

  await updateHackathonJudgingMeta(hackathonId, meta, "completed");
}

async function finalizeGeminiFallback(hackathonId: string, meta: JudgingMeta, reason?: string) {
  const fallbackTeamId = typeof meta.genlayer_fallback_team_id === "string"
    ? meta.genlayer_fallback_team_id
    : typeof meta.winner_team_id === "string"
      ? meta.winner_team_id
      : null;

  if (!fallbackTeamId) {
    throw new Error("No Gemini fallback winner available")
  }

  meta.genlayer_status = reason ? "failed" : meta.genlayer_status;
  if (reason) meta.genlayer_last_error = reason;

  await finalizeJudging(
    hackathonId,
    meta,
    fallbackTeamId,
    "gemini",
    reason
      ? `GenLayer fallback to Gemini winner after error: ${reason}`
      : "Automatically judged by Gemini AI. Code repositories were analyzed.",
  );
}

async function persistGenLayerVerdict(hackathonId: string, meta: JudgingMeta) {
  const contractAddress = typeof meta.genlayer_contract === "string" ? meta.genlayer_contract : null;
  if (!contractAddress) return false;

  const result = await getGenLayerJudgeResult(contractAddress, hackathonId);
  if (!result.finalized || !result.winner_team_id) {
    return false;
  }

  const enrichResult = {
    ...result,
    deploy_tx_hash: meta.genlayer_deploy_tx_hash,
    submit_tx_hash: meta.genlayer_submit_tx_hash,
    finalize_tx_hash: meta.genlayer_finalize_tx_hash,
  };

  meta.genlayer_status = "completed";
  meta.genlayer_result = enrichResult;
  meta.genlayer_reasoning = result.reasoning || null;

  if (result.final_score) {
    const [winnerSub] = await getDb()
      .select({ id: schema.submissions.id })
      .from(schema.submissions)
      .where(and(eq(schema.submissions.hackathonId, hackathonId), eq(schema.submissions.teamId, result.winner_team_id)))
      .limit(1);

    if (winnerSub?.id) {
      const [existingEval] = await getDb()
        .select({ raw_response: schema.evaluations.rawResponse })
        .from(schema.evaluations)
        .where(eq(schema.evaluations.submissionId, winnerSub.id))
        .limit(1);

      const glFeedback = `🔗 GenLayer On-Chain Verdict (5 validators):\nFinal Score: ${result.final_score}/100\n${result.reasoning || ""}`;

      let rawResponse: Record<string, unknown> = {};
      try {
        rawResponse = typeof existingEval?.raw_response === "string"
          ? JSON.parse(existingEval.raw_response)
          : {};
      } catch {
        rawResponse = {};
      }

      await getDb()
        .update(schema.evaluations)
        .set({
          totalScore: result.final_score,
          judgeFeedback: glFeedback,
          rawResponse: JSON.stringify({ ...rawResponse, genlayer_result: enrichResult }),
        })
        .where(eq(schema.evaluations.submissionId, winnerSub.id));
    }
  }

  await finalizeJudging(
    hackathonId,
    meta,
    result.winner_team_id,
    "gemini+genlayer",
    `Gemini pre-scored submissions. Top contenders went to GenLayer on-chain consensus. Winner verified by 5 independent validators.`,
  );

  return true;
}

export async function continueGenLayerJudging(hackathonId: string) {
  const [hackathon] = await getDb()
    .select({
      id: schema.hackathons.id,
      title: schema.hackathons.title,
      brief: schema.hackathons.brief,
      status: schema.hackathons.status,
      judging_criteria: schema.hackathons.judgingCriteria,
    })
    .from(schema.hackathons)
    .where(eq(schema.hackathons.id, hackathonId))
    .limit(1);

  if (!hackathon || hackathon.status !== "judging") return false;

  const meta = parseJudgingMeta(hackathon.judging_criteria);
  const status = typeof meta.genlayer_status === "string" ? meta.genlayer_status : null;
  const contenders = Array.isArray(meta.genlayer_contenders)
    ? meta.genlayer_contenders as GenLayerContender[]
    : [];

  if (!status) return false;

  try {
    if (status === "queued") {
      const deployment = await startGenLayerDeployment(hackathon.id, hackathon.title, hackathon.brief);
      meta.genlayer_status = "deploying";
      meta.genlayer_deploy_tx_hash = deployment.txHash;
      await updateHackathonJudgingMeta(hackathon.id, meta);
      return true;
    }

    if (status === "deploying") {
      const txHash = typeof meta.genlayer_deploy_tx_hash === "string" ? meta.genlayer_deploy_tx_hash : null;
      if (!txHash) throw new Error("Missing GenLayer deploy tx hash");
      const progress = await pollGenLayerDeployment(txHash);
      if (!progress.done || !progress.contractAddress) return false;

      meta.genlayer_contract = progress.contractAddress;
      const submit = await startGenLayerSubmit(progress.contractAddress, contenders);
      meta.genlayer_submit_tx_hash = submit.txHash;
      meta.genlayer_status = "submitting";
      await updateHackathonJudgingMeta(hackathon.id, meta);
      return true;
    }

    if (status === "submitting") {
      const txHash = typeof meta.genlayer_submit_tx_hash === "string" ? meta.genlayer_submit_tx_hash : null;
      const contractAddress = typeof meta.genlayer_contract === "string" ? meta.genlayer_contract : null;
      if (!txHash || !contractAddress) throw new Error("Missing GenLayer submit state");
      const progress = await pollGenLayerWrite(txHash, TransactionStatus.ACCEPTED);
      if (!progress.done) return false;

      const finalize = await startGenLayerFinalize(contractAddress);
      meta.genlayer_finalize_tx_hash = finalize.txHash;
      meta.genlayer_status = "finalizing";
      await updateHackathonJudgingMeta(hackathon.id, meta);
      return true;
    }

    if (status === "finalizing") {
      const txHash = typeof meta.genlayer_finalize_tx_hash === "string" ? meta.genlayer_finalize_tx_hash : null;
      if (!txHash) throw new Error("Missing GenLayer finalize tx hash");
      const progress = await pollGenLayerWrite(txHash, TransactionStatus.FINALIZED);
      if (!progress.done) return false;

      meta.genlayer_status = "reading_result";
      await updateHackathonJudgingMeta(hackathon.id, meta);
      return true;
    }

    if (status === "reading_result") {
      const completed = await persistGenLayerVerdict(hackathon.id, meta);
      if (completed) await updateActiveJudgingRunForHackathon(hackathon.id, "completed");
      return completed;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`continueGenLayerJudging(${hackathon.id}) failed:`, msg);
    await finalizeGeminiFallback(hackathon.id, meta, msg);
    await updateActiveJudgingRunForHackathon(hackathon.id, "completed", { metadata: { genlayer_fallback: true } });
    return true;
  }

  return false;
}

/**
 * Build a judge system prompt that is fully personalized to the enterprise's
 * problem description, judging criteria, rules, and challenge type.
 */
function buildJudgeSystemPrompt(hackathon: Hackathon): string {
  // Parse enterprise context from judging_criteria (may contain JSON with enterprise context)
  let enterpriseContext = "";
  let customCriteria = "";

  if (hackathon.judging_criteria) {
    try {
      const parsed = JSON.parse(hackathon.judging_criteria);
      if (parsed.enterprise_problem) {
        enterpriseContext = `\nORIGINAL ENTERPRISE PROBLEM:\n${parsed.enterprise_problem}\n`;
      }
      if (parsed.enterprise_requirements) {
        enterpriseContext += `\nENTERPRISE REQUIREMENTS:\n${parsed.enterprise_requirements}\n`;
      }
      if (parsed.criteria_text) {
        customCriteria = `\nCUSTOM JUDGING CRITERIA:\n${parsed.criteria_text}\n`;
      }
    } catch {
      // Not JSON — treat as plain text criteria
      customCriteria = `\nCUSTOM JUDGING CRITERIA:\n${hackathon.judging_criteria}\n`;
    }
  }

  return `You are an elite software engineering judge for an AI agent hackathon on BuildersClaw.

YOUR MISSION: Evaluate a code repository submission. You will receive the FULL source code of the submitted project. You must analyze the actual code quality, architecture, and whether it genuinely solves the stated problem.

═══ HACKATHON CONTEXT ═══
Title: ${hackathon.title}
Challenge Type: ${hackathon.challenge_type || "general"}
${enterpriseContext}
CHALLENGE BRIEF (what the enterprise/organizer asked for):
${hackathon.brief}

${hackathon.description ? `ADDITIONAL DESCRIPTION:\n${hackathon.description}\n` : ""}
${hackathon.rules ? `RULES & CONSTRAINTS:\n${hackathon.rules}\n` : ""}
${customCriteria}

═══ EVALUATION CRITERIA ═══
Score each criterion 0-100. Be strict and fair. 100 = exceptional, 70 = good, 50 = mediocre, below 30 = failing.

1. **functionality_score**: Does the code actually work? Does it implement the core features described in the brief?
2. **brief_compliance_score**: How well does the submission address the specific problem/requirements stated in the challenge brief? This is the MOST IMPORTANT criterion.
3. **code_quality_score**: Clean code, proper naming, no obvious bugs, follows language idioms and best practices.
4. **architecture_score**: Good project structure, separation of concerns, appropriate patterns, scalability considerations.
5. **innovation_score**: Creative approaches, clever solutions, use of modern tools/techniques, going beyond minimum requirements.
6. **completeness_score**: Is the project complete or half-done? Are there TODOs, placeholder code, missing features?
7. **documentation_score**: README quality, code comments where needed, setup instructions, API docs if applicable.
8. **testing_score**: Are there tests? Test coverage? Do they test meaningful scenarios?
9. **security_score**: No hardcoded secrets, input validation, proper auth patterns, no obvious vulnerabilities.
10. **deploy_readiness_score**: Could this be deployed? Proper configs, environment handling, build scripts, CI/CD?

═══ OUTPUT FORMAT ═══
Return ONLY a valid JSON object (no markdown fences, no commentary).
IMPORTANT: All string values must be single-line JSON strings. Do not include literal newlines inside strings. Avoid double quotes inside the feedback text.
{
  "functionality_score": <0-100>,
  "brief_compliance_score": <0-100>,
  "code_quality_score": <0-100>,
  "architecture_score": <0-100>,
  "innovation_score": <0-100>,
  "completeness_score": <0-100>,
  "documentation_score": <0-100>,
  "testing_score": <0-100>,
  "security_score": <0-100>,
  "deploy_readiness_score": <0-100>,
  "judge_feedback": "One concise paragraph with strengths, weaknesses, and next steps. No line breaks."
}`;
}

/**
 * Build the user prompt with the actual repository content.
 */
function buildJudgeUserPrompt(repoContent: string, submission: Submission): string {
  const parts: string[] = [];

  parts.push("═══ SUBMISSION TO EVALUATE ═══\n");

  if (submission.preview_url) {
    parts.push(`Submitted Repo URL: ${submission.preview_url}`);
  }

  // Parse build_log for repo_url and notes
  try {
    const meta = JSON.parse(submission.build_log || "{}");
    if (meta.repo_url) parts.push(`Repository URL: ${meta.repo_url}`);
    if (meta.notes) parts.push(`Submitter Notes: ${meta.notes}`);
  } catch { /* ignore */ }

  parts.push("\n═══ REPOSITORY SOURCE CODE ═══\n");
  parts.push(repoContent);
  parts.push("\n═══ END OF SUBMISSION ═══");
  parts.push("\nEvaluate this submission now. Return ONLY the JSON object.");

  return parts.join("\n");
}

/**
 * Extract the repo URL from a submission.
 * Priority: build_log.repo_url > build_log.project_url > preview_url
 */
function getSubmissionRepoUrl(submission: Submission): string | null {
  // Try build_log first
  try {
    const meta = JSON.parse(submission.build_log || "{}");
    if (meta.repo_url && parseGitHubUrl(meta.repo_url)) return meta.repo_url;
    if (meta.project_url && parseGitHubUrl(meta.project_url)) return meta.project_url;
  } catch { /* ignore */ }

  // Try preview_url
  if (submission.preview_url && parseGitHubUrl(submission.preview_url)) {
    return submission.preview_url;
  }

  return null;
}

export async function judgeSubmission(
  submission: Submission,
  hackathon: Hackathon,
): Promise<EvaluationResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not configured for platform judging");
  }

  // ── Fetch repository code ──
  const repoUrl = getSubmissionRepoUrl(submission);
  let repoContent: string;

  if (repoUrl) {
    const analysis = await fetchRepoForJudging(repoUrl, 40, 200_000);
    repoContent = formatRepoForPrompt(analysis);
  } else if (submission.html_content) {
    // Fallback: inline HTML content (legacy submissions)
    repoContent = `[LEGACY SUBMISSION - Inline HTML Only]\n\n\`\`\`html\n${submission.html_content}\n\`\`\``;
  } else {
    repoContent = "[ERROR] No repository URL or code content provided in this submission.";
  }

  // ── Build prompts contextualized to the enterprise's problem ──
  const systemPrompt = buildJudgeSystemPrompt(hackathon);
  const userPrompt = buildJudgeUserPrompt(repoContent, submission);

  try {
    let parsed: Omit<EvaluationResult, "total_score"> | null = null;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const result = await generateCode({
          provider: "gemini",
          apiKey,
          systemPrompt,
          userPrompt,
          maxTokens: 2048,
          temperature: 0, // Force deterministic judging output as much as possible
        });

        const jsonStr = result.text.replace(/```json/g, "").replace(/```/g, "").trim();
        parsed = JSON.parse(jsonStr) as Omit<EvaluationResult, "total_score">;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
          continue;
        }
      }
    }

    if (!parsed) {
      throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "Unknown Gemini judging failure"));
    }

    // Weighted total score: brief_compliance is worth 2x
    const weights = {
      functionality_score: 1.5,
      brief_compliance_score: 2.0,  // Most important
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
      const score = (parsed as unknown as Record<string, number>)[key] || 0;
      return sum + score * weight;
    }, 0);

    const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
    const total_score = Math.round(weightedSum / totalWeight);

    return { ...parsed, total_score };
  } catch (error: unknown) {
    console.error("Judging failed for submission", submission.id, error);
    const errMsg = error instanceof Error ? error.message : String(error);

    return {
      functionality_score: 0,
      brief_compliance_score: 0,
      code_quality_score: 0,
      architecture_score: 0,
      innovation_score: 0,
      completeness_score: 0,
      documentation_score: 0,
      testing_score: 0,
      security_score: 0,
      deploy_readiness_score: 0,
      total_score: 0,
      judge_feedback: "Error evaluating submission: " + errMsg,
    };
  }
}

export async function judgeHackathon(hackathonId: string, judgingRunId?: string) {
  await updateJudgingRun(judgingRunId, "running");
  const [hackathon] = await getDb()
    .select(hackathonSelect)
    .from(schema.hackathons)
    .where(eq(schema.hackathons.id, hackathonId))
    .limit(1) as HackathonJudgeRow[];

  if (!hackathon) throw new Error("Hackathon not found");

  // ── Concurrency guard: atomically claim "judging" status ──
  if (hackathon.status === "completed") {
    await updateJudgingRun(judgingRunId, "completed");
    return true;
  }

  // Try to claim — works from open, in_progress, OR judging (retry after failure)
  const [locked] = await getDb()
    .update(schema.hackathons)
    .set({ status: "judging" })
    .where(and(eq(schema.hackathons.id, hackathonId), inArray(schema.hackathons.status, ["open", "in_progress", "judging"])))
    .returning({ id: schema.hackathons.id });

  if (!locked) return true;

  // Parse existing judging metadata
  let updatedMeta: Record<string, unknown> = {};
  if (hackathon.judging_criteria) {
    try {
      updatedMeta = typeof hackathon.judging_criteria === "string"
        ? JSON.parse(hackathon.judging_criteria)
        : hackathon.judging_criteria;
    } catch { /* ignore */ }
  }

  try {
    const submissionRows = await getDb()
      .select({ ...submissionSelect, team_name: schema.teams.name, team_status: schema.teams.status })
      .from(schema.submissions)
      .leftJoin(schema.teams, eq(schema.submissions.teamId, schema.teams.id))
      .where(eq(schema.submissions.hackathonId, hackathonId));

    const allSubmissions: SubmissionWithTeam[] = submissionRows.map(({ team_name, team_status, ...submission }) => ({
      ...submission,
      status: submission.status as Submission["status"],
      teams: team_name ? { name: team_name, status: team_status ?? undefined } : null,
    }));

    if (allSubmissions.length === 0) {
      updatedMeta.notes = "Ended with 0 submissions.";
      updatedMeta.finalized_at = new Date().toISOString();
      await updateHackathonJudgingMeta(hackathonId, updatedMeta, "completed");
      await updateJudgingRun(judgingRunId, "completed", { metadata: { submissions_judged: 0 } });
      return true;
    }

    // ── SECURITY: Filter out non-viable submissions ──
    // Only judge submissions that have a valid repo URL and are completed.
    // Teams that never submitted (or submitted garbage) should not waste judge tokens.
    const viableSubmissions: typeof allSubmissions = [];
    const skippedSubmissions: Array<{ team_id: string; reason: string }> = [];

    for (const sub of allSubmissions) {
      const check = isViableSubmission(sub);
      if (check.viable) {
        viableSubmissions.push(sub);
      } else {
        skippedSubmissions.push({ team_id: sub.team_id, reason: check.reason });
        console.warn(
          `[JUDGE] Skipping submission ${sub.id} (team ${sub.team_id}): ${check.reason}`
        );

        // Record a zero-score evaluation for skipped submissions
        await upsertEvaluations([
          {
            submission_id: sub.id,
            functionality_score: 0, brief_compliance_score: 0, code_quality_score: 0,
            architecture_score: 0, innovation_score: 0, completeness_score: 0,
            documentation_score: 0, testing_score: 0, security_score: 0,
            deploy_readiness_score: 0, total_score: 0,
            judge_feedback: `Submission skipped: ${check.reason}. Teams must submit a valid GitHub repository URL to be judged.`,
            raw_response: JSON.stringify({ skipped: true, reason: check.reason }),
          },
        ]);
      }
    }

    if (viableSubmissions.length === 0) {
      updatedMeta.notes = `Ended with ${allSubmissions.length} submissions but none had viable repos. ${skippedSubmissions.map(s => s.reason).join("; ")}`;
      updatedMeta.finalized_at = new Date().toISOString();
      updatedMeta.skipped_submissions = skippedSubmissions;
      await updateHackathonJudgingMeta(hackathonId, updatedMeta, "completed");
      await updateJudgingRun(judgingRunId, "completed", { metadata: { submissions_judged: 0, skipped_submissions: skippedSubmissions } });
      return true;
    }

    const submissions = viableSubmissions;
    if (skippedSubmissions.length > 0) {
      updatedMeta.skipped_submissions = skippedSubmissions;
      console.log(`[JUDGE] ${viableSubmissions.length} viable / ${skippedSubmissions.length} skipped out of ${allSubmissions.length} total submissions`);
    }

    // Judge all submissions (with per-submission error handling)
    const evaluationsToUpsert = [];
    for (const submission of submissions) {
      try {
        const result = await judgeSubmission(submission, hackathon as Hackathon);

        evaluationsToUpsert.push({
          submission_id: submission.id,
          functionality_score: result.functionality_score,
          brief_compliance_score: result.brief_compliance_score,
          code_quality_score: result.code_quality_score,
          architecture_score: result.architecture_score,
          innovation_score: result.innovation_score,
          completeness_score: result.completeness_score,
          documentation_score: result.documentation_score,
          testing_score: result.testing_score,
          security_score: result.security_score,
          deploy_readiness_score: result.deploy_readiness_score,
          total_score: result.total_score,
          judge_feedback: result.judge_feedback,
          raw_response: JSON.stringify(result),
        });
      } catch (subErr: unknown) {
        const msg = subErr instanceof Error ? subErr.message : String(subErr);
        console.error(`Judge error for submission ${submission.id}:`, msg);
        evaluationsToUpsert.push({
          submission_id: submission.id,
          functionality_score: 0, brief_compliance_score: 0, code_quality_score: 0,
          architecture_score: 0, innovation_score: 0, completeness_score: 0,
          documentation_score: 0, testing_score: 0, security_score: 0,
          deploy_readiness_score: 0, total_score: 0,
          judge_feedback: `Evaluation failed: ${msg}`,
          raw_response: JSON.stringify({ error: msg }),
        });
      }
    }

    if (evaluationsToUpsert.length > 0) {
      await upsertEvaluations(evaluationsToUpsert);
    }

    // Determine winner: top Gemini contenders can be escalated to GenLayer.
    evaluationsToUpsert.sort((a, b) => b.total_score - a.total_score);
    const { topEvals, contenders } = buildTopContenders(
      evaluationsToUpsert,
      submissions as Array<Submission & { teams?: { name?: string } | { name?: string }[] }>,
    );

    let winnerTeamId: string | null = null;
    let winnerAgentId: string | null = null;
    const genlayerUsed = false;

    // Only use GenLayer if there are 2+ viable contenders and GenLayer is reachable
    if (topEvals.length >= 2 && (await isGenLayerAvailable())) {
      if (contenders.length >= 2) {
        console.log(`GenLayer: queued ${contenders.length} top contenders for cron-driven on-chain judging`);
        updatedMeta.genlayer_status = "queued";
        updatedMeta.genlayer_contenders = contenders;
        updatedMeta.genlayer_fallback_team_id = contenders[0].team_id;
        updatedMeta.judge_method = "gemini_pending_genlayer";
        updatedMeta.notes = `Gemini pre-scored ${submissions.length} submissions. Top ${contenders.length} contenders are queued for GenLayer on-chain consensus.`;
        await updateHackathonJudgingMeta(hackathonId, updatedMeta, "judging");
        await updateJudgingRun(judgingRunId, "waiting_genlayer", {
          metadata: { submissions_judged: submissions.length },
        });
        await enqueueJob({
          type: "continue_genlayer_judging",
          payload: { hackathon_id: hackathonId },
          runAt: new Date(Date.now() + 60_000),
          maxAttempts: 20,
        });
        return {
          completed: false,
          queuedGenLayer: true,
          submissionsJudged: submissions.length,
        } satisfies JudgingRunResult;
      }
    }

    // Fallback: if GenLayer didn't run or failed, use Gemini's top scorer
    if (!winnerTeamId) {
      const winningEval = evaluationsToUpsert[0];
      const winningSub = submissions.find((s) => s.id === winningEval.submission_id);
      if (winningSub && winningEval.total_score > 0) {
        winnerTeamId = winningSub.team_id;
      }
    }

    // Resolve winner agent
    if (winnerTeamId) {
      winnerAgentId = await resolveWinnerAgentId(winnerTeamId);
      updatedMeta.winner_team_id = winnerTeamId;
      if (winnerAgentId) updatedMeta.winner_agent_id = winnerAgentId;
    }

    if (!winnerTeamId) {
      throw new Error("No winner could be determined from the submission evaluations");
    }

    updatedMeta.finalized_at = new Date().toISOString();
    updatedMeta.judge_method = genlayerUsed ? "gemini+genlayer" : "gemini";
    updatedMeta.notes = genlayerUsed
      ? `Gemini pre-scored ${submissions.length} submissions. Top ${topEvals.length} went to GenLayer on-chain consensus. Winner verified by 5 independent validators.`
      : submissions.length === 1
        ? "Won by default (only participant). Judged for feedback."
        : "Automatically judged by Gemini AI. Code repositories were analyzed.";

    await updateHackathonJudgingMeta(hackathonId, updatedMeta, "completed");
    await updateJudgingRun(judgingRunId, "completed", {
      metadata: { submissions_judged: submissions.length },
    });

    return {
      completed: true,
      queuedGenLayer: false,
      submissionsJudged: submissions.length,
    } satisfies JudgingRunResult;
  } catch (err) {
    // On unexpected failure, revert to in_progress so cron can retry
    console.error(`judgeHackathon(${hackathonId}) fatal error, reverting status:`, err);
    await getDb()
      .update(schema.hackathons)
      .set({ status: "in_progress" })
      .where(and(eq(schema.hackathons.id, hackathonId), eq(schema.hackathons.status, "judging")));
    await updateJudgingRun(judgingRunId, "failed", { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}
